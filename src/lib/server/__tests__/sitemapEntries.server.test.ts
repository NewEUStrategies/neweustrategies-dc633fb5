// Co crawler dostaje w sitemapie serwisu - adres po adresie, sekcja po sekcji.
//
// CO TO DOWODZI. Ten plik decyduje, KTÓRE adresy serwisu w ogóle istnieją dla
// wyszukiwarki. Testy są nazwane po trzech skutkach, po jednym na klasę błędu,
// jaką kolektor sekcji może popełnić:
//   * ADRES BEZ TREŚCI - wpis, którego strona rodzicielska nie jest już
//     opublikowana, nie może wyjechać jako `/undefined/slug` ani `//slug`;
//     sitemapa z takim adresem produkuje w Search Console błąd 404 na własne
//     życzenie i zużywa budżet crawlowania na nieistniejące strony;
//   * TREŚĆ BEZ ADRESU - sekcja, która po cichu pominie wpisy (bo odczyt padł,
//     bo mapa ścieżek stron się nie zbudowała, bo odpowiedź się urwała na
//     domyślnym pułapie PostgREST), wypisuje serwis z indeksu, a plik XML jest
//     przy tym formalnie poprawny, więc nic nie alarmuje;
//   * ADRES, KTÓREGO NIE WOLNO REKLAMOWAĆ - strona z `seo_noindex`, wpis
//     w koszu (`deleted_at`), szkic sesji Q&A.
//
// JAK, I DLACZEGO TAK. Kolektory dostają klienta bazy PARAMETREM, więc test
// podaje PRAWDZIWEGO klienta `@supabase/supabase-js` z wstrzykniętym `fetch`.
// Dwie konsekwencje, obie zamierzone: (1) asercje idą po REALNYM zapytaniu
// PostgREST (`status=eq.published`, `deleted_at=is.null`, `select=…`), czyli po
// tym, co naprawdę pojedzie na serwer, a nie po atrapie własnego pomysłu;
// (2) nie ma ani jednego rzutowania typu klienta - `as unknown as
// SupabaseClient` w takim teście oznacza, że atrapa może się bezkarnie rozjechać
// z klientem. Sieci nie ma: `fetch` nigdy nie wychodzi z procesu.
//
// ZAKRES NAJEMCY JEST TUTAJ, NIE W BRAMCE (korekta 2026-10). Ten nagłówek
// twierdził, że filtr `.eq("tenant_id", …)` każdego zapytania pilnuje bramka
// statyczna `serviceRoleTenantScope.gate.test.ts`. Nie pilnuje: jej skan szuka
// `supabaseAdmin`, a kolektory dostają klienta PARAMETREM - sama bramka pisze
// wprost, że ten plik nie trafia do jej rejestru. Jedynym dowodem zakresu jest
// więc przegląd WSZYSTKICH zapytań jednego pełnego odczytu
// (`collectAllSitemapSections` niżej) - tak wyszły na jaw odczyty `profiles`
// i `author_profiles` sekcji `experts` bez filtra najemcy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * PODZIAŁU NA SHARDY, nazw plików i limitu 25 000 adresów dowodzi
//     `src/lib/seo/__tests__/sitemapIndex.test.ts`; RENDERU `<urlset>`,
//     escapowania i klastra hreflang - `sitemapXml.test.ts`. Ten plik kończy się
//     na LIŚCIE wpisów - dalej nie zagląda;
//   * PARYTETU adresu wpisu z feedami (`/rss.xml`, `/live/rss.xml`, feedy
//     taksonomii) dowodzi JEDEN test w `publishedContent.server.test.ts`, bo
//     reguła „adres wpisu = ścieżka rodzica + slug" jest jedna, a jej kopii
//     jest kilka;
//   * izolacja najemca-najemca w samej bazie (RLS) należy do pgTAP-a.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SITEMAP_SECTIONS, shardCountFor } from "@/lib/seo/sitemapIndex";
import {
  SITEMAP_SECTION_BUDGET_MS,
  collectAllSitemapSections,
  collectSitemapSection,
  coreSitemapEntries,
  collectSitemapSectionResult,
  type SitemapEntry,
} from "../sitemapEntries.server";

const TENANT = "t-nes";
const ORIGIN = "https://nes.example";
/** Data bazowa całego pliku - żaden test nie czyta zegara systemowego. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";

// --------------------------------------------------------------------------
// Atrapa granicy HTTP: prawdziwy klient Supabase, podstawiony `fetch`.
// --------------------------------------------------------------------------

/** Jedno zapytanie, które klient naprawdę wysłał. */
interface ZapisaneZadanie {
  /** Segment po `/rest/v1/` - nazwa tabeli albo `rpc/<funkcja>`. */
  readonly tabela: string;
  readonly metoda: string;
  readonly params: URLSearchParams;
  readonly body: string;
}

/** Odmowa PostgREST w kształcie, w jakim klient wkłada ją do `error`. */
interface Odmowa {
  message: string;
  code: string;
}

type Odpowiedz = { wiersze: unknown } | { odmowa: Odmowa };
/**
 * Połączenie, które nigdy nie odpowiada - zawieszony PostgREST, który nie
 * rzuca, tylko czeka (stan, przed którym bronią budżety czasu).
 */
const ZAWIESZONE = "zawieszone" as const;
type PlanTabeli = Odpowiedz | typeof ZAWIESZONE | ((zadanie: ZapisaneZadanie) => Odpowiedz);
type Plan = Record<string, PlanTabeli>;

/** Tabele odpytane bez zaplanowanej odpowiedzi - `afterEach` robi z tego błąd. */
let brakiPlanu: string[] = [];

/**
 * Licznik atrap - każda dostaje własny klucz magazynu sesji (patrz niżej).
 * NIE zerujemy go między testami: klient Supabase pamięta instancje globalnie,
 * więc powtórzony klucz wróciłby jako ostrzeżenie w konsoli.
 */
let licznikAtrap = 0;

function jestOdmowa(odpowiedz: Odpowiedz): odpowiedz is { odmowa: Odmowa } {
  return "odmowa" in odpowiedz;
}

/**
 * `_page_ids` z ciała wywołania RPC. Strażnik zawężający w runtime, nie
 * rzutowanie: ciało jest stringiem z granicy HTTP, więc test nie ma prawa
 * zakładać jego kształtu.
 */
function pageIdsZCiala(body: string): string[] {
  if (!body) return [];
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("_page_ids" in parsed)) return [];
  const wartosc: unknown = parsed._page_ids;
  return Array.isArray(wartosc) && wartosc.every((id) => typeof id === "string") ? wartosc : [];
}

interface AtrapaAdmina {
  admin: SupabaseClient<Database>;
  zadania: ZapisaneZadanie[];
  /** Zapytania do jednej tabeli (albo `rpc/<funkcja>`). */
  dla(tabela: string): ZapisaneZadanie[];
}

function atrapaAdmina(plan: Plan): AtrapaAdmina {
  const zadania: ZapisaneZadanie[] = [];
  licznikAtrap += 1;
  const admin = createClient<Database>("https://stub.invalid", "klucz-testowy", {
    // Własny klucz magazynu sesji na atrapę: przy wspólnym kluczu klient
    // Supabase woła `console.warn("Multiple GoTrueClient instances…")`, a tym
    // samym kanałem mierzymy degradację odczytu - ostrzeżenie klienta udawałoby
    // ślad awarii sekcji.
    auth: { persistSession: false, autoRefreshToken: false, storageKey: `atrapa-${licznikAtrap}` },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const zadanie: ZapisaneZadanie = {
          tabela: url.pathname.replace("/rest/v1/", ""),
          metoda: init?.method ?? "GET",
          params: url.searchParams,
          body: typeof init?.body === "string" ? init.body : "",
        };
        zadania.push(zadanie);
        const wpis = plan[zadanie.tabela];
        if (wpis === undefined) {
          // Cichy `[]` udawałby poprawny odczyt tabeli, której test nie
          // zaplanował - ta sama zasada, co w `@/test/supabaseChain`.
          brakiPlanu.push(zadanie.tabela);
          return Promise.resolve(odpowiedzHttp({ wiersze: [] }));
        }
        if (wpis === ZAWIESZONE) return new Promise<Response>(() => undefined);
        return Promise.resolve(
          odpowiedzHttp(typeof wpis === "function" ? wpis(zadanie) : wpis, url.searchParams),
        );
      },
    },
  });
  return {
    admin,
    zadania,
    dla: (tabela) => zadania.filter((z) => z.tabela === tabela),
  };
}

function odpowiedzHttp(odpowiedz: Odpowiedz, params = new URLSearchParams()): Response {
  if (jestOdmowa(odpowiedz)) {
    return new Response(JSON.stringify({ ...odpowiedz.odmowa, details: null, hint: null }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  const rows = odpowiedz.wiersze;
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? (Array.isArray(rows) ? rows.length : 0));
  return new Response(
    JSON.stringify(Array.isArray(rows) ? rows.slice(offset, offset + limit) : rows),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": `*/${Array.isArray(rows) ? rows.length : 0}`,
      },
    },
  );
}

/** Strona w planie: wynik `page_full_paths` + własna flaga noindex. */
interface StronaPlan {
  sciezka: string | null;
  noindex?: boolean;
  /** `pages.updated_at` - źródło `lastmod` sekcji `pages`. */
  zmiana?: string;
  /**
   * `pages.parent_id`. Brak = strona najwyższego poziomu. Rodzic SPOZA planu
   * to przodek, którego odczyt stron nie zwrócił - szkic, kosz albo obcy
   * najemca, czyli dokładnie stan stron `test-*` na produkcji.
   */
  rodzic?: string;
  /** `pages.slug` - domyślnie ostatni segment ścieżki. */
  slug?: string;
}

/**
 * Plan dla `pages` + `page_full_paths` (mapa ścieżek buduje się z obu) oraz
 * `site_settings` (sekcja `pages` czyta ustawienia czytania, żeby nie wypisać
 * strony głównej drugi raz). Atrapa RPC oddaje ścieżkę BEZ względu na status
 * przodków - tak jak prawdziwa funkcja, której ta luka dotyczyła.
 */
function planStron(
  strony: Record<string, StronaPlan>,
  czytanie: PlanTabeli = { wiersze: [] },
): Plan {
  return {
    pages: {
      wiersze: Object.entries(strony).map(([id, s]) => ({
        id,
        slug: s.slug ?? s.sciezka?.split("/").at(-1) ?? id,
        parent_id: s.rodzic ?? null,
        seo_noindex: s.noindex === true,
        updated_at: s.zmiana ?? null,
      })),
    },
    "rpc/page_full_paths": (zadanie) => {
      return {
        wiersze: pageIdsZCiala(zadanie.body).map((id) => ({
          page_id: id,
          full_path: strony[id]?.sciezka ?? null,
        })),
      };
    },
    site_settings: czytanie,
  };
}

/** Wiersz `site_settings["reading"]` w kształcie odpowiedzi PostgREST. */
function czytanie(wartosc: unknown): PlanTabeli {
  return { wiersze: [{ value: wartosc }] };
}

const locs = (wpisy: readonly SitemapEntry[]): string[] => wpisy.map((w) => w.loc);
const wpisO = (wpisy: readonly SitemapEntry[], loc: string): SitemapEntry | undefined =>
  wpisy.find((w) => w.loc === loc);

let ostrzezenia: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  brakiPlanu = [];
  ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  // Odpytanie tabeli bez zaplanowanej odpowiedzi to błąd testu, nie „pusto".
  expect(brakiPlanu).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Pełny, uporządkowany szkielet sekcji `core`. Jedno źródło prawdy dla testu
 * listy hubów i dla testów degradacji ("core zostaje nietknięty") - zamiast
 * magicznej liczby wpisów, która przy każdej zmianie listy psuła się bez
 * wskazania, KTÓREGO adresu brakuje.
 *
 * Katalogu osób `/people` tu NIE MA (zmiana 2026-09-24, podział People/Author).
 * Trasa `people.index.tsx` jest wyłącznie dla zalogowanych i zawsze wysyła
 * `robots: noindex, nofollow`, a profile członków `/people/<slug>` również są
 * noindex - sitemapa nie może reklamować adresów, które meta robots każe
 * crawlerowi pominąć (w Search Console: "Przesłany URL oznaczony jako noindex").
 */
const HUBY_CORE: readonly string[] = [
  `${ORIGIN}/`,
  `${ORIGIN}/blog`,
  `${ORIGIN}/podcasts`,
  `${ORIGIN}/web-stories`,
  `${ORIGIN}/live`,
  `${ORIGIN}/events`,
  `${ORIGIN}/qa`,
  `${ORIGIN}/polls`,
  `${ORIGIN}/tracker`,
  `${ORIGIN}/programs`,
  `${ORIGIN}/experts`,
  `${ORIGIN}/contribute`,
  `${ORIGIN}/sitemap`,
  // Pakiet zgodności 2026-09 - dokumenty prawne renderowane z tras React,
  // niewidoczne dla kolektora `pages` (ten czyta tabelę `pages`).
  `${ORIGIN}/rodo`,
  `${ORIGIN}/zarzadzanie-polityka-prywatnosci`,
  `${ORIGIN}/polityka-przetwarzania-danych`,
  `${ORIGIN}/komunikacja-i-marketing`,
  `${ORIGIN}/regulamin-klubow-dyskusyjnych`,
  `${ORIGIN}/moderacja-komentarzy`,
  `${ORIGIN}/regulamin-wydarzen-i-biletow`,
  `${ORIGIN}/regulamin-subskrypcji-i-zakupow`,
  `${ORIGIN}/przejrzystosc-ai`,
  `${ORIGIN}/statut`,
];

describe("sekcja core - huby serwisu bez udziału bazy", () => {
  it("wypisuje wszystkie huby serwisu i nie wysyła ani jednego zapytania", async () => {
    const db = atrapaAdmina({});
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "core");
    expect(db.zadania).toEqual([]);
    expect(locs(wpisy)).toEqual(HUBY_CORE);
  });

  it("nie reklamuje katalogu osób ani profili członków - obie trasy są noindex", () => {
    const sciezki = coreSitemapEntries(ORIGIN).map((w) => w.loc.slice(ORIGIN.length));
    expect(sciezki).not.toContain("/people");
    expect(sciezki.filter((s) => s.startsWith("/people/"))).toEqual([]);
  });

  it("daje stronie głównej najwyższy priorytet, a mapie serwisu najniższy", () => {
    const wpisy = coreSitemapEntries(ORIGIN);
    expect(wpisO(wpisy, `${ORIGIN}/`)).toMatchObject({ changefreq: "daily", priority: "1.0" });
    expect(wpisO(wpisy, `${ORIGIN}/sitemap`)?.priority).toBe("0.3");
    expect(wpisO(wpisy, `${ORIGIN}/experts`)?.priority).toBe("0.7");
  });

  it("nie zgłasza lastmod dla hubów - data z zegara byłaby zmyślona", () => {
    for (const wpis of coreSitemapEntries(ORIGIN)) {
      expect(wpis.lastmod).toBeUndefined();
      expect(wpis.loc.startsWith(`${ORIGIN}/`)).toBe(true);
      // Podwójny ukośnik w ścieżce = adres, którego trasa nie obsłuży.
      expect(wpis.loc.slice(ORIGIN.length)).not.toContain("//");
    }
  });
});

describe("sekcja pages - adresy stron z drzewa", () => {
  it("adresuje stronę pełną ścieżką drzewa, nie samym slugiem", async () => {
    const db = atrapaAdmina(
      planStron({
        "p-1": { sciezka: "analizy" },
        "p-2": { sciezka: "analizy/prawo", rodzic: "p-1" },
      }),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy).sort()).toEqual([`${ORIGIN}/analizy`, `${ORIGIN}/analizy/prawo`]);
    expect(wpisO(wpisy, `${ORIGIN}/analizy`)).toMatchObject({
      changefreq: "weekly",
      priority: "0.6",
    });
  });

  it("strona z seo_noindex nie dostaje własnego adresu, ale nadal jest rodzicem wpisów", async () => {
    const db = atrapaAdmina({
      ...planStron({ "p-tag": { sciezka: "wewnetrzne", noindex: true } }),
      posts: { wiersze: [wierszWpisu({ parent_page_id: "p-tag" })] },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages")).toEqual([]);
    // Ta sama mapa ścieżek, inna sekcja: wpis pod stroną noindex ma własne
    // `seo_noindex=false`, więc jego adres JEST indeksowalny.
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/wewnetrzne/akt-o-uslugach`]);
  });

  it("strona przesłonięta trasą kodową z `noindex` nie trafia do mapy (audyt GSC 2026-10)", async () => {
    // Produkcja: strony CMS `login` i `club` są opublikowane bez seo_noindex,
    // ale pod ich adresem renderuje się trasa logowania i katalog klubów -
    // obie z `noindex`. GSC: „Przesłany URL oznaczony tagiem noindex".
    const db = atrapaAdmina(
      planStron({
        "p-login": { sciezka: "login" },
        "p-club": { sciezka: "club" },
        "p-kontakt": { sciezka: "kontakt" },
        "p-pomoc": { sciezka: "kontakt/login", rodzic: "p-kontakt" },
      }),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    // Ta sama nazwa GŁĘBIEJ w drzewie to zwykła strona - liczy się cały adres.
    expect(locs(wpisy).sort()).toEqual([`${ORIGIN}/kontakt`, `${ORIGIN}/kontakt/login`]);
  });

  it("czyta wyłącznie strony opublikowane i nieusunięte", async () => {
    const db = atrapaAdmina(planStron({ "p-1": { sciezka: "analizy" } }));
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    const params = db.dla("pages")[0].params;
    expect(params.get("status")).toBe("eq.published");
    expect(params.get("deleted_at")).toBe("is.null");
    // `slug` i `parent_id`: łańcuch przodków i rozstrzygnięcie strony głównej.
    expect(params.get("select")).toBe("id,slug,parent_id,seo_noindex,updated_at");
  });

  it("brak stron to pusta sekcja - i ani jednego ostrzeżenia w logu", async () => {
    const db = atrapaAdmina({ pages: { wiersze: [] }, site_settings: { wiersze: [] } });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages")).toEqual([]);
    expect(db.dla("rpc/page_full_path")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("strona z pustą ścieżką nie powiela strony głównej", async () => {
    const db = atrapaAdmina(planStron({ "p-korzen": { sciezka: "" } }));
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).not.toContain(`${ORIGIN}/`);
  });

  it("strona, dla której RPC nie zwrócił ścieżki, wypada z mapy (bez adresu /null)", async () => {
    const db = atrapaAdmina(
      planStron({ "p-1": { sciezka: "analizy" }, "p-znikla": { sciezka: null } }),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/analizy`]);
  });
});

// NAPRAWA 2026-10 (audyt GSC) - ADRES TYLKO PRZEZ OPUBLIKOWANYCH PRZODKÓW.
//
// `sitemaps/pages.xml` wypisywał 10 adresów `/test/test-*` (PL+EN), które
// kończyły się 404: pięć opublikowanych stron wisiało pod NIEopublikowanym
// rodzicem, a `page_full_paths` składa ścieżkę po `parent_id` bez względu na
// status przodków. Publiczny `resolve_path` schodzi od korzenia i wymaga
// opublikowanej, nieusuniętej strony na KAŻDYM poziomie.
describe("sekcja pages - strona osiągalna tylko przez opublikowanych przodków", () => {
  /** Stan produkcji: rodzic `a4d270b1...` nie wrócił z odczytu opublikowanych. */
  const DZIECI_SZKICU = {
    "p-o-nas": { sciezka: "o-nas" },
    "p-agenda": { sciezka: "test/test-agenda", rodzic: "p-test-szkic" },
    "p-prelegenci": { sciezka: "test/test-prelegenci", rodzic: "p-test-szkic" },
  } satisfies Record<string, StronaPlan>;

  it("dziecko nieopublikowanego rodzica nie dostaje adresu (to byłoby 404)", async () => {
    const db = atrapaAdmina(planStron(DZIECI_SZKICU));
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/o-nas`]);
    expect(locs(wpisy).join(" ")).not.toContain("/test/");
  });

  it("RPC ścieżek dostaje WYŁĄCZNIE strony osiągalne", async () => {
    const db = atrapaAdmina(planStron(DZIECI_SZKICU));
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(db.dla("rpc/page_full_paths").map((z) => pageIdsZCiala(z.body))).toEqual([["p-o-nas"]]);
  });

  it("brak osiągalnych stron nie woła RPC wcale", async () => {
    const db = atrapaAdmina(
      planStron({ "p-agenda": { sciezka: "test/test-agenda", rodzic: "p-test-szkic" } }),
    );
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages")).toEqual([]);
    expect(db.dla("rpc/page_full_paths")).toEqual([]);
  });

  it("wnuk opublikowanego dziecka pod szkicem też wypada - liczy się CAŁY łańcuch", async () => {
    const db = atrapaAdmina(
      planStron({
        "p-sekcja": { sciezka: "szkic/sekcja", rodzic: "p-szkic" },
        "p-wnuk": { sciezka: "szkic/sekcja/wnuk", rodzic: "p-sekcja" },
        "p-zdrowa": { sciezka: "analizy" },
        "p-zdrowe-dziecko": { sciezka: "analizy/prawo", rodzic: "p-zdrowa" },
        "p-zdrowy-wnuk": { sciezka: "analizy/prawo/ai-act", rodzic: "p-zdrowe-dziecko" },
      }),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy).sort()).toEqual([
      `${ORIGIN}/analizy`,
      `${ORIGIN}/analizy/prawo`,
      `${ORIGIN}/analizy/prawo/ai-act`,
    ]);
  });

  it("wpis pod stroną bez opublikowanego łańcucha wypada z sekcji posts", async () => {
    // Ten sam adres `resolve_path` też odrzuca: wpis szuka rodzica po ścieżce
    // stron, a ta urywa się na szkicu.
    const db = atrapaAdmina({
      ...planStron(DZIECI_SZKICU),
      posts: {
        wiersze: [
          wierszWpisu({ slug: "zostaje", parent_page_id: "p-o-nas" }),
          wierszWpisu({ slug: "sierota-szkicu", parent_page_id: "p-agenda" }),
        ],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/o-nas/zostaje`]);
  });

  it("cykl w parent_id nie zawiesza odczytu i nie daje adresu", async () => {
    // Baza nie blokuje cyklu (FK sprawdza istnienie rodzica, nie acykliczność).
    const db = atrapaAdmina(
      planStron({
        "p-a": { sciezka: "a", rodzic: "p-b" },
        "p-b": { sciezka: "b", rodzic: "p-a" },
        "p-sam": { sciezka: "sam", rodzic: "p-sam" },
        "p-pod-cyklem": { sciezka: "a/b/pod", rodzic: "p-a" },
        "p-zdrowa": { sciezka: "zdrowa" },
      }),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/zdrowa`]);
  });

  it("łańcuch dłuższy niż 50 poziomów wypada - RPC ucięłoby mu ścieżkę", async () => {
    // `page_full_paths` rekurencją `c.depth < 50` składa najwyżej 50 segmentów;
    // głębsza strona dostałaby ścieżkę bez górnych segmentów, czyli 404.
    const strony: Record<string, StronaPlan> = {};
    for (let poziom = 1; poziom <= 52; poziom += 1) {
      strony[`p-${poziom}`] = {
        sciezka: `s${poziom}`,
        ...(poziom > 1 ? { rodzic: `p-${poziom - 1}` } : {}),
      };
    }
    const db = atrapaAdmina(planStron(strony));
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    const glebokosci = locs(wpisy).map((loc) => Number(loc.slice(`${ORIGIN}/s`.length)));
    expect(glebokosci.sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });
});

// NAPRAWA 2026-10 (audyt GSC) - STRONA GŁÓWNA TYLKO POD `/`.
//
// Ustawienia czytania produkcji: `{ homepage_mode: "static_page",
// homepage_page_slug: "main" }`. Strona `main` jest serwowana pod `/` (sekcja
// `core`), a sekcja `pages` wypisywała ją drugi raz jako `/main` i `/en/main`
// - duplikat strony głównej z własnym canonicalem.
describe("sekcja pages - strona główna nie dostaje drugiego adresu", () => {
  const STRONY = {
    "p-main": { sciezka: "main" },
    "p-home": { sciezka: "home" },
    "p-o-nas": { sciezka: "o-nas" },
    "p-pod-main": { sciezka: "main/zespol", rodzic: "p-main" },
  } satisfies Record<string, StronaPlan>;
  const PRODUKCJA = { homepage_mode: "static_page", homepage_page_slug: "main" };

  it("strona wskazana slugiem w ustawieniach czytania wypada z sekcji", async () => {
    const db = atrapaAdmina(planStron(STRONY, czytanie(PRODUKCJA)));
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy).sort()).toEqual([
      `${ORIGIN}/home`,
      `${ORIGIN}/main/zespol`,
      `${ORIGIN}/o-nas`,
    ]);
  });

  it("strona wskazana po id wypada, także gdy nie jest najwyższego poziomu", async () => {
    const db = atrapaAdmina(
      planStron(STRONY, czytanie({ homepage_mode: "static_page", homepage_page_id: "p-pod-main" })),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).not.toContain(`${ORIGIN}/main/zespol`);
    expect(locs(wpisy)).toContain(`${ORIGIN}/main`);
  });

  it("bez ustawień obowiązuje reguła zastana: wypada strona `home`", async () => {
    const db = atrapaAdmina(planStron(STRONY));
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).not.toContain(`${ORIGIN}/home`);
    expect(locs(wpisy)).toContain(`${ORIGIN}/main`);
  });

  it("tryb najnowszych wpisów: żadna strona nie jest stroną główną", async () => {
    const db = atrapaAdmina(planStron(STRONY, czytanie({ homepage_mode: "latest_posts" })));
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(locs(wpisy)).toHaveLength(4);
  });

  it("wpisy pod stroną główną zachowują własne adresy w sekcji posts", async () => {
    const db = atrapaAdmina({
      ...planStron(STRONY, czytanie(PRODUKCJA)),
      posts: { wiersze: [wierszWpisu({ slug: "komunikat", parent_page_id: "p-main" })] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/main/komunikat`]);
  });

  it("czyta ustawienia czytania WŁASNEGO najemcy, kluczem `reading`", async () => {
    const db = atrapaAdmina(planStron(STRONY, czytanie(PRODUKCJA)));
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    const [zadanie] = db.dla("site_settings");
    expect(zadanie.params.get("tenant_id")).toBe(`eq.${TENANT}`);
    expect(zadanie.params.get("key")).toBe("eq.reading");
    expect(zadanie.params.get("select")).toBe("value");
  });

  it("odmowa odczytu ustawień to AWARIA sekcji (503), a nie `/main` w pliku jak zdrowy", async () => {
    // Przegląd 2026-10: reguła zastana (`home`) przy produkcyjnej stronie
    // `main` wypisywała `/main` (301 na `/`) i shard szedł z pełnym TTL.
    const db = atrapaAdmina(
      planStron(STRONY, { odmowa: { message: "permission denied", code: "42501" } }),
    );
    const odczyt = await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "pages");
    expect(odczyt.failed).toBe(true);
    expect(odczyt.entries).toEqual([]);
  });

  it("zawieszony odczyt ustawień kończy sekcję awarią już po połowie budżetu", async () => {
    const db = atrapaAdmina(planStron(STRONY, ZAWIESZONE));
    const odczyt = collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "pages");
    await vi.advanceTimersByTimeAsync(SITEMAP_SECTION_BUDGET_MS / 2);
    const wynik = await odczyt;
    expect(wynik.failed).toBe(true);
    expect(wynik.entries).toEqual([]);
  });

  it("ustawienia w niespodziewanym kształcie dają regułę zastaną, nie wyjątek", async () => {
    for (const wartosc of ["static_page", ["main"], null]) {
      const db = atrapaAdmina(planStron(STRONY, czytanie(wartosc)));
      const odczyt = await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "pages");
      expect(odczyt.failed).toBe(false);
      expect(locs(odczyt.entries)).not.toContain(`${ORIGIN}/home`);
    }
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

/** Wiersz wpisu w kształcie, w jakim czyta go kolektor `posts`. */
function wierszWpisu(nadpisania: Record<string, unknown> = {}) {
  return {
    slug: "akt-o-uslugach",
    parent_page_id: "p-1",
    updated_at: "2026-08-19T08:30:00.000Z",
    published_at: "2026-08-10T06:00:00.000Z",
    ...nadpisania,
  };
}

describe("sekcja posts - adres wpisu i jego lastmod", () => {
  const strony = planStron({ "p-1": { sciezka: "analizy/prawo" } });

  it("składa adres ze ścieżki rodzica i sluga, z lastmod z ostatniej modyfikacji", async () => {
    const db = atrapaAdmina({ ...strony, posts: { wiersze: [wierszWpisu()] } });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/analizy/prawo/akt-o-uslugach`,
        lastmod: "2026-08-19",
        changefreq: "monthly",
        priority: "0.7",
      },
    ]);
  });

  it("lastmod spada na datę publikacji, a bez obu dat nie jest emitowany", async () => {
    const db = atrapaAdmina({
      ...strony,
      posts: {
        wiersze: [
          wierszWpisu({ slug: "bez-modyfikacji", updated_at: null }),
          wierszWpisu({ slug: "bez-dat", updated_at: null, published_at: null }),
          wierszWpisu({ slug: "pusty-string", updated_at: "", published_at: "2026-07-01" }),
        ],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(wpisy.map((w) => [w.loc.split("/").at(-1), w.lastmod])).toEqual([
      ["bez-modyfikacji", "2026-08-10"],
      ["bez-dat", undefined],
      ["pusty-string", "2026-07-01"],
    ]);
  });

  it("wpis, którego rodzica nie ma w mapie ścieżek, jest POMIJANY", async () => {
    // To jest realny stan bazy: strona wróciła do szkicu albo poszła do kosza,
    // a wpisy nadal na nią wskazują. Bez `continue` sitemapa reklamowałaby
    // `/undefined/slug` - adres, który zawsze kończy się 404.
    const db = atrapaAdmina({
      ...strony,
      posts: {
        wiersze: [
          wierszWpisu({ slug: "zostaje" }),
          wierszWpisu({ slug: "sierota", parent_page_id: "p-nieopublikowana" }),
        ],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/analizy/prawo/zostaje`]);
    expect(locs(wpisy).join(" ")).not.toContain("undefined");
  });

  it("pyta wyłącznie o treść opublikowaną, nieusuniętą i indeksowalną", async () => {
    const db = atrapaAdmina({ ...strony, posts: { wiersze: [] } });
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    const params = db.dla("posts")[0].params;
    expect(params.get("status")).toBe("eq.published");
    expect(params.get("deleted_at")).toBe("is.null");
    expect(params.get("seo_noindex")).toBe("eq.false");
    expect(params.get("select")).toBe("slug,parent_page_id,updated_at,published_at");
  });

  it("kolektor stronicuje odczyt wpisów", async () => {
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      posts: { wiersze: [wierszWpisu()] },
    });
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    const params = db.dla("posts")[0].params;
    expect(params.has("limit") || params.has("offset")).toBe(true);
  });
});

/** Wpis widziany przez kolektor `taxonomy`: daty + osadzone powiązania. */
function wpisTaksonomii(
  kategorie: readonly string[],
  tagi: readonly string[],
  daty: { updated_at?: string | null; published_at?: string | null } = {},
) {
  return {
    id: `post-${kategorie.join("-")}-${tagi.join("-")}`,
    updated_at: daty.updated_at ?? null,
    published_at: daty.published_at ?? null,
    post_categories: kategorie.map((category_id) => ({ category_id })),
    post_tags: tagi.map((tag_id) => ({ tag_id })),
  };
}

/** Czy zapytanie o `posts` to odczyt powiązań taksonomii (a nie sekcja `posts`). */
const toOdczytTaksonomii = (zadanie: ZapisaneZadanie): boolean =>
  (zadanie.params.get("select") ?? "").includes("post_categories(");

/**
 * Tabela `posts` czytana przez DWA kolektory: `posts` (adresy wpisów)
 * i `taxonomy` (które archiwa mają treść). Plan rozdziela je po liście
 * `select`, żeby każdy kolektor dostał wiersze w swoim kształcie.
 */
function planWpisow(plan: { wpisy?: Odpowiedz; taksonomia?: Odpowiedz }): PlanTabeli {
  return (zadanie) =>
    toOdczytTaksonomii(zadanie)
      ? (plan.taksonomia ?? { wiersze: [] })
      : (plan.wpisy ?? { wiersze: [] });
}

describe("sekcja taxonomy - archiwa kategorii i tagów", () => {
  it("daje kategoriom i tagom osobne prefiksy, priorytety i lastmod z najnowszego wpisu", async () => {
    const db = atrapaAdmina({
      categories: {
        wiersze: [{ id: "k-prawo", slug: "prawo", created_at: "2026-01-05T10:00:00.000Z" }],
      },
      tags: { wiersze: [{ id: "t-ai", slug: "ai-act", created_at: null }] },
      posts: {
        wiersze: [
          wpisTaksonomii(["k-prawo"], ["t-ai"], { updated_at: "2026-08-19T08:30:00.000Z" }),
          wpisTaksonomii(["k-prawo"], [], { published_at: "2026-09-02T06:00:00.000Z" }),
        ],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/category/prawo`,
        lastmod: "2026-09-02",
        changefreq: "weekly",
        priority: "0.6",
      },
      { loc: `${ORIGIN}/tag/ai-act`, lastmod: "2026-08-19", changefreq: "weekly", priority: "0.5" },
    ]);
  });

  it("term organizacji jedzie pod /organization/, a nie pod /category/", async () => {
    // Organizacja ma własną, kanoniczną stronę profilu. Stara trasa dalej
    // działa, ale wskazuje ją znacznikiem `canonical` - sitemapa reklamująca
    // oba adresy kazałaby crawlerowi pobrać stronę tylko po to, żeby dowiedzieć
    // się, że kanoniczny jest inny.
    const db = atrapaAdmina({
      categories: {
        wiersze: [
          { id: "k-nato", slug: "nato", kind: "organization", created_at: "2026-02-02T10:00Z" },
          { id: "k-prawo", slug: "prawo", kind: "category", created_at: null },
        ],
      },
      tags: { wiersze: [] },
      posts: { wiersze: [wpisTaksonomii(["k-prawo"], [])] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(wpisy.map((w) => w.loc)).toEqual([
      `${ORIGIN}/organization/nato`,
      `${ORIGIN}/category/prawo`,
    ]);
  });

  it("term bez rodzaju zostaje archiwum kategorii - brak danej nie tworzy profilu", async () => {
    const db = atrapaAdmina({
      categories: { wiersze: [{ id: "k-prawo", slug: "prawo", kind: null, created_at: null }] },
      tags: { wiersze: [] },
      posts: { wiersze: [wpisTaksonomii(["k-prawo"], [])] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(wpisy.map((w) => w.loc)).toEqual([`${ORIGIN}/category/prawo`]);
  });

  it("brak taksonomii to pusta sekcja, nie błąd", async () => {
    const db = atrapaAdmina({
      categories: { wiersze: [] },
      tags: { wiersze: [] },
      posts: { wiersze: [] },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

// NAPRAWA 2026-10 (audyt GSC) - PUSTE ARCHIWUM TO SOFT 404.
//
// `sitemaps/taxonomy.xml` wypisywał 39 archiwów kategorii, a 18 opublikowanych
// wpisów (import WordPressa) nie ma ani jednego wiersza w `post_categories` -
// każde archiwum i jego feed pokazywały „Brak opublikowanych wpisów.".
describe("sekcja taxonomy - tylko archiwa z treścią", () => {
  it("kategorie i tagi bez wpisów nie trafiają do mapy (stan produkcji)", async () => {
    const kategorie = Array.from({ length: 39 }, (_, i) => ({
      id: `k-${i}`,
      slug: `kategoria-${i}`,
      kind: "category",
      created_at: "2026-05-01T00:00:00Z",
    }));
    const db = atrapaAdmina({
      categories: { wiersze: kategorie },
      tags: { wiersze: [{ id: "t-1", slug: "pusty-tag", created_at: null }] },
      // 18 wpisów, zero powiązań - osadzone listy wracają puste.
      posts: { wiersze: Array.from({ length: 18 }, () => wpisTaksonomii([], [])) },
    });
    const odczyt = await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(odczyt).toEqual({ entries: [], failed: false });
  });

  it("profil organizacji zostaje bez wpisów - to strona bytu, nie lista", async () => {
    const db = atrapaAdmina({
      categories: {
        wiersze: [
          { id: "k-nato", slug: "nato", kind: "organization", created_at: "2026-02-02T10:00Z" },
          { id: "k-ue", slug: "ue", kind: "organization", created_at: "2026-02-03T10:00Z" },
        ],
      },
      tags: { wiersze: [] },
      posts: {
        wiersze: [wpisTaksonomii(["k-ue"], [], { updated_at: "2026-09-30T12:00:00Z" })],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    // Bez wpisów: data utworzenia termu; z wpisami: data najnowszego wpisu.
    expect(wpisy.map((w) => [w.loc, w.lastmod])).toEqual([
      [`${ORIGIN}/organization/nato`, "2026-02-02"],
      [`${ORIGIN}/organization/ue`, "2026-09-30"],
    ]);
  });

  it("wpisy bez dat nadal czynią archiwum niepustym - lastmod spada na datę termu", async () => {
    const db = atrapaAdmina({
      categories: { wiersze: [{ id: "k-1", slug: "prawo", created_at: "2026-01-05T10:00Z" }] },
      tags: { wiersze: [{ id: "t-1", slug: "ai-act", created_at: null }] },
      posts: { wiersze: [wpisTaksonomii(["k-1"], ["t-1"])] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(wpisy.map((w) => [w.loc, w.lastmod])).toEqual([
      [`${ORIGIN}/category/prawo`, "2026-01-05"],
      [`${ORIGIN}/tag/ai-act`, undefined],
    ]);
  });

  it("liczą się wyłącznie wpisy opublikowane, nieusunięte i indeksowalne najemcy", async () => {
    const db = atrapaAdmina({
      categories: { wiersze: [] },
      tags: { wiersze: [] },
      posts: { wiersze: [] },
    });
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    const [zadanie] = db.dla("posts");
    expect(zadanie.params.get("tenant_id")).toBe(`eq.${TENANT}`);
    expect(zadanie.params.get("status")).toBe("eq.published");
    expect(zadanie.params.get("deleted_at")).toBe("is.null");
    expect(zadanie.params.get("seo_noindex")).toBe("eq.false");
    // Powiązania OSADZONE przy wpisie: tabele łączące nie mają `tenant_id`,
    // więc zakres stawia filtr na `posts`. Literówka w nazwie osadzenia nie
    // jest błędem kompilacji - stąd asercja na dosłownym napisie.
    expect(zadanie.params.get("select")).toBe(
      "id,updated_at,published_at,post_categories(category_id),post_tags(tag_id)",
    );
    expect(zadanie.params.has("offset")).toBe(true);
    for (const tabela of ["categories", "tags"]) {
      expect(db.dla(tabela)[0].params.get("select")).toContain("id,slug");
    }
  });

  it("odczyt powiązań stronicuje ponad pułap PostgREST - term z 1203. wpisu nie ginie", async () => {
    const wiersze = Array.from({ length: 1203 }, (_, i) =>
      wpisTaksonomii(i === 1202 ? ["k-ostatnia"] : [], []),
    );
    const db = atrapaAdmina({
      categories: { wiersze: [{ id: "k-ostatnia", slug: "ostatnia", created_at: null }] },
      tags: { wiersze: [] },
      posts: { wiersze },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/category/ostatnia`]);
    expect(db.dla("posts")).toHaveLength(3);
  });

  it("odmowa odczytu powiązań to AWARIA sekcji, a nie pusta mapa", async () => {
    // Pusta sekcja z awarii wyglądałaby jak „żadne archiwum nie ma treści"
    // i indeks po cichu przestałby ogłaszać shard - stąd `failed`.
    const db = atrapaAdmina({
      categories: { wiersze: [{ id: "k-1", slug: "prawo", created_at: null }] },
      tags: { wiersze: [] },
      posts: { odmowa: { message: "permission denied for table posts", code: "42501" } },
    });
    expect(await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "taxonomy")).toEqual({
      entries: [],
      failed: true,
    });
  });

  it("indeks nie ogłasza shardu taksonomii, gdy żadne archiwum nie ma treści", async () => {
    // Indeks liczy shardy z TEJ mapy (`shardCountFor(urls.length)`), więc pusta
    // sekcja daje zero plików `taxonomy-*.xml` - a nie pusty <urlset>.
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      posts: planWpisow({
        wpisy: { wiersze: [wierszWpisu()] },
        taksonomia: { wiersze: [wpisTaksonomii([], [])] },
      }),
      categories: { wiersze: [{ id: "k-1", slug: "prawo", created_at: null }] },
      tags: { wiersze: [{ id: "t-1", slug: "ai-act", created_at: null }] },
      podcast_shows: { wiersze: [] },
      podcasts: { wiersze: [] },
      research_programs: { wiersze: [] },
      web_stories: { wiersze: [] },
      eu_policy_items: { wiersze: [] },
      events: { wiersze: [] },
      qa_sessions: { wiersze: [] },
      profile_badges: { wiersze: [] },
    });
    const { sections, failedSections } = await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    expect(sections.get("taxonomy")).toEqual([]);
    expect(failedSections).toEqual([]);
    expect(shardCountFor(sections.get("taxonomy")?.length ?? 0)).toBe(0);
    expect(shardCountFor(sections.get("posts")?.length ?? 0)).toBe(1);
  });
});

describe("sekcja podcasts - programy i odcinki razem", () => {
  it("adresuje program pod /podcasts/, a odcinek pod /podcast/", async () => {
    const db = atrapaAdmina({
      podcast_shows: { wiersze: [{ slug: "eurokompas", updated_at: "2026-08-01T00:00:00Z" }] },
      podcasts: {
        wiersze: [{ slug: "odcinek-12", updated_at: null, published_at: "2026-08-18T05:00:00Z" }],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "podcasts");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/podcasts/eurokompas`,
        lastmod: "2026-08-01",
        changefreq: "weekly",
        priority: "0.6",
      },
      {
        loc: `${ORIGIN}/podcast/odcinek-12`,
        lastmod: "2026-08-18",
        changefreq: "monthly",
        priority: "0.6",
      },
    ]);
  });

  it("pomija programy i odcinki w koszu", async () => {
    const db = atrapaAdmina({ podcast_shows: { wiersze: [] }, podcasts: { wiersze: [] } });
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "podcasts");
    for (const tabela of ["podcast_shows", "podcasts"]) {
      const params = db.dla(tabela)[0].params;
      expect(params.get("status")).toBe("eq.published");
      expect(params.get("deleted_at")).toBe("is.null");
    }
  });
});

describe("pozostałe sekcje treści - kompletność, prefiks, lastmod", () => {
  it("programy badawcze idą pod /programs/ z datą modyfikacji", async () => {
    const db = atrapaAdmina({
      research_programs: {
        wiersze: [{ slug: "rynek-cyfrowy", updated_at: null, created_at: "2026-03-02T00:00:00Z" }],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "programs");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/programs/rynek-cyfrowy`,
        lastmod: "2026-03-02",
        changefreq: "weekly",
        priority: "0.6",
      },
    ]);
    expect(db.dla("research_programs")[0].params.get("status")).toBe("eq.published");
  });

  it("web stories idą pod /web-stories/ z niższym priorytetem", async () => {
    const db = atrapaAdmina({
      web_stories: {
        wiersze: [{ slug: "szczyt-ue", updated_at: "2026-08-20T12:00:00Z", published_at: null }],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "stories");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/web-stories/szczyt-ue`,
        lastmod: "2026-08-20",
        changefreq: "monthly",
        priority: "0.5",
      },
    ]);
  });

  it("dossier trackera idą pod /tracker/", async () => {
    const db = atrapaAdmina({
      eu_policy_items: {
        wiersze: [{ slug: "ai-act", updated_at: "2026-08-21T09:00:00Z", created_at: null }],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "tracker");
    expect(locs(wpisy)).toEqual([`${ORIGIN}/tracker/ai-act`]);
    expect(wpisy[0].lastmod).toBe("2026-08-21");
  });

  it("wydarzenia idą pod /events/", async () => {
    const db = atrapaAdmina({
      events: { wiersze: [{ slug: "debata-9-9", updated_at: null, created_at: null }] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "events");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/events/debata-9-9`,
        lastmod: undefined,
        changefreq: "weekly",
        priority: "0.6",
      },
    ]);
  });

  it("sesje Q&A trafiają do mapy WSZYSTKIE poza szkicami", async () => {
    const db = atrapaAdmina({
      qa_sessions: {
        wiersze: [{ slug: "pytania-o-ai-act", updated_at: null, opens_at: "2026-09-01T08:00:00Z" }],
      },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "qa");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/qa/pytania-o-ai-act`,
        lastmod: "2026-09-01",
        changefreq: "weekly",
        priority: "0.5",
      },
    ]);
    // Filtr jest NEGATYWNY (`status != draft`), więc sesja zamknięta czy
    // zarchiwizowana zostaje w mapie - to decyzja produktowa, nie przypadek.
    expect(db.dla("qa_sessions")[0].params.get("status")).toBe("neq.draft");
  });
});

describe("sekcja experts - huby ekspertów", () => {
  const odznaka = { user_id: "u-1" };

  it("brak odznak eksperta kończy sekcję BEZ dalszych zapytań", async () => {
    const db = atrapaAdmina({ profile_badges: { wiersze: [] } });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "experts")).toEqual([]);
    expect(db.zadania.map((z) => z.tabela)).toEqual(["profile_badges"]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });

  it("publikuje hub eksperta z publicznym profilem autorskim", async () => {
    const db = atrapaAdmina({
      profile_badges: { wiersze: [odznaka, odznaka] },
      profiles: { wiersze: [{ id: "u-1", slug: "jan-kowalski", updated_at: "2026-08-15T00:00Z" }] },
      author_profiles: { wiersze: [{ user_id: "u-1", is_public: true }] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "experts");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/author/jan-kowalski`,
        lastmod: "2026-08-15",
        changefreq: "weekly",
        priority: "0.7",
      },
    ]);
    // Zduplikowana odznaka nie mnoży zapytań ani adresów.
    expect(db.dla("profiles")[0].params.get("id")).toBe("in.(u-1)");
    expect(db.dla("author_profiles")[0].params.get("user_id")).toBe("in.(u-1)");
    expect(db.dla("profile_badges")[0].params.get("badge")).toBe("eq.expert");
  });

  it("ekspert z prywatnym profilem autorskim nie ma huba w mapie", async () => {
    const db = atrapaAdmina({
      profile_badges: { wiersze: [odznaka] },
      profiles: { wiersze: [{ id: "u-1", slug: "jan-kowalski", updated_at: null }] },
      author_profiles: { wiersze: [{ user_id: "u-1", is_public: false }] },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "experts")).toEqual([]);
  });

  it("odmowa odczytu profili gasi hub eksperta, ale nie wywraca sekcji", async () => {
    const db = atrapaAdmina({
      profile_badges: { wiersze: [odznaka] },
      profiles: { odmowa: { message: "permission denied for table profiles", code: "42501" } },
      author_profiles: { odmowa: { message: "permission denied", code: "42501" } },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "experts")).toEqual([]);
  });

  it("ekspert bez sluga nie ma huba w mapie (adres /author/null nie istnieje)", async () => {
    const db = atrapaAdmina({
      profile_badges: { wiersze: [odznaka] },
      profiles: { wiersze: [{ id: "u-1", slug: null, updated_at: null }] },
      author_profiles: { wiersze: [{ user_id: "u-1", is_public: true }] },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "experts")).toEqual([]);
  });
});

describe("degradacja odczytu - pustka kontra awaria", () => {
  it("odpowiedź w kształcie, którego kolektor nie umie przejść, daje pustą sekcję i ślad w logu", async () => {
    // Jedyna droga, jaką ten plik naprawdę dochodzi do swojego `catch`:
    // `for (const row of data ?? [])` na odpowiedzi, która nie jest tablicą.
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      posts: { wiersze: { slug: "nie-tablica" } },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts")).toEqual([]);
    expect(ostrzezenia).toHaveBeenCalledWith(
      '[seo] sitemap section "posts" read failed:',
      expect.any(TypeError),
    );
  });

  it("odmowa bazy w KAŻDEJ sekcji daje pustą sekcję, a nie 500 na powierzchni crawlera", async () => {
    // Kontrakt nagłówka pliku: „awaria odczytu to pusta sekcja, nie zatruty
    // crawl". Tu sprawdzamy go dla wszystkich sekcji naraz - każda tabela
    // odmawia, żadna sekcja nie rzuca, `core` zostaje nietknięty.
    const odmowaWszedzie: Odmowa = { message: "permission denied", code: "42501" };
    const plan: Plan = {};
    for (const tabela of [
      "pages",
      "rpc/page_full_paths",
      "site_settings",
      "posts",
      "categories",
      "tags",
      "podcast_shows",
      "podcasts",
      "research_programs",
      "web_stories",
      "eu_policy_items",
      "events",
      "qa_sessions",
      "profile_badges",
    ]) {
      plan[tabela] = { odmowa: odmowaWszedzie };
    }
    const db = atrapaAdmina(plan);
    const { sections: mapa, failedSections } = await collectAllSitemapSections(
      db.admin,
      TENANT,
      ORIGIN,
    );
    for (const sekcja of SITEMAP_SECTIONS) {
      if (sekcja === "core") continue;
      expect(mapa.get(sekcja)).toEqual([]);
    }
    expect(locs(mapa.get("core") ?? [])).toEqual(HUBY_CORE);
    // Pustka z AWARII jest jawna: każda sekcja treści trafia na listę awarii,
    // `core` (bez bazy) - nigdy.
    expect([...failedSections].sort()).toEqual(
      SITEMAP_SECTIONS.filter((sekcja) => sekcja !== "core").sort(),
    );
  });

  it("odmowa bazy zostawia ślad z nazwą sekcji", async () => {
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      posts: { odmowa: { message: "permission denied for table posts", code: "42501" } },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts")).toEqual([]);
    expect(ostrzezenia).toHaveBeenCalledWith(
      '[seo] sitemap section "posts" read failed:',
      expect.anything(),
    );
  });
});

describe("collectAllSitemapSections - mapa dla indeksu", () => {
  const pelnyPlan = (): Plan => ({
    ...planStron({ "p-1": { sciezka: "analizy" } }),
    posts: planWpisow({
      wpisy: { wiersze: [wierszWpisu()] },
      taksonomia: { wiersze: [wpisTaksonomii(["k-prawo"], [])] },
    }),
    categories: { wiersze: [{ id: "k-prawo", slug: "prawo", created_at: null }] },
    tags: { wiersze: [] },
    podcast_shows: { wiersze: [] },
    podcasts: { wiersze: [] },
    research_programs: { wiersze: [] },
    web_stories: { wiersze: [] },
    eu_policy_items: { wiersze: [] },
    events: { wiersze: [] },
    qa_sessions: { wiersze: [] },
    profile_badges: { wiersze: [] },
  });

  it("bez tenanta zostaje sam szkielet core i ani jednego zapytania", async () => {
    const db = atrapaAdmina({});
    const { sections: mapa, failedSections } = await collectAllSitemapSections(
      db.admin,
      null,
      ORIGIN,
    );
    expect([...mapa.keys()]).toEqual(["core"]);
    expect(locs(mapa.get("core") ?? [])).toEqual(HUBY_CORE);
    expect(db.zadania).toEqual([]);
    // Żaden odczyt nie ruszył, więc nie ma awarii - o degradacji indeksu
    // rozstrzyga trasa po braku tenanta.
    expect(failedSections).toEqual([]);
  });

  it("zwraca KAŻDĄ sekcję rejestru - indeks liczy shardy z tej mapy", async () => {
    const db = atrapaAdmina(pelnyPlan());
    const { sections: mapa, failedSections } = await collectAllSitemapSections(
      db.admin,
      TENANT,
      ORIGIN,
    );
    expect([...mapa.keys()].sort()).toEqual([...SITEMAP_SECTIONS].sort());
    expect(locs(mapa.get("posts") ?? [])).toEqual([`${ORIGIN}/analizy/akt-o-uslugach`]);
    expect(locs(mapa.get("pages") ?? [])).toEqual([`${ORIGIN}/analizy`]);
    // Kontrola dodatnia listy awarii: sekcje LEGALNIE puste (tags, podcasts…)
    // nie są awarią - inaczej każdy tenant bez podcastów dostawałby TTL
    // zdegradowany.
    expect(failedSections).toEqual([]);
  });

  it("KAŻDE zapytanie pełnego odczytu niesie filtr najemcy - poza RPC ścieżek", async () => {
    // Odczyt service-role omija RLS, więc brak filtra to treść (albo adres)
    // obcego najemcy w mapie tego hosta. Odznaka eksperta jest tu po to, żeby
    // sekcja `experts` doszła do `profiles` i `author_profiles`.
    const db = atrapaAdmina({
      ...pelnyPlan(),
      profile_badges: { wiersze: [{ user_id: "u-1" }] },
      profiles: { wiersze: [] },
      author_profiles: { wiersze: [] },
    });
    const { failedSections } = await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    expect(failedSections).toEqual([]);
    // `page_full_paths` dostaje WYŁĄCZNIE id stron z odczytu `pages`
    // filtrowanego po najemcy, a granicę rekurencji stawia SQL funkcji
    // (`p.tenant_id = c.tenant_id`, pilnowane przez bramkę migracji).
    const bezFiltra = db.zadania
      .filter((z) => z.tabela !== "rpc/page_full_paths")
      .filter((z) => z.params.get("tenant_id") !== `eq.${TENANT}`)
      .map((z) => z.tabela);
    expect(bezFiltra).toEqual([]);
    // Kanarek zasięgu: przegląd widzi każdą tabelę rejestru - także odczyty
    // dopisane w 2026-10 (`site_settings`, drugi odczyt `posts` w `taxonomy`).
    expect([...new Set(db.zadania.map((z) => z.tabela))].sort()).toEqual(
      [
        "author_profiles",
        "categories",
        "eu_policy_items",
        "events",
        "pages",
        "podcast_shows",
        "podcasts",
        "posts",
        "profile_badges",
        "profiles",
        "qa_sessions",
        "research_programs",
        "rpc/page_full_paths",
        "site_settings",
        "tags",
        "web_stories",
      ].sort(),
    );
    expect(db.dla("posts")).toHaveLength(2);
  });

  it("mapa ścieżek stron powstaje RAZ na całe wywołanie, nie raz na sekcję", async () => {
    const db = atrapaAdmina(pelnyPlan());
    await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    // `pages` potrzebują jej sekcje `pages` i `posts` - odczyt jest jeden.
    expect(db.dla("pages")).toHaveLength(1);
  });

  it("awaria jednej sekcji nie zabiera adresów pozostałym", async () => {
    const db = atrapaAdmina({
      ...pelnyPlan(),
      posts: planWpisow({
        wpisy: { wiersze: { slug: "nie-tablica" } },
        taksonomia: { wiersze: [wpisTaksonomii(["k-prawo"], [])] },
      }),
    });
    const { sections: mapa, failedSections } = await collectAllSitemapSections(
      db.admin,
      TENANT,
      ORIGIN,
    );
    expect(mapa.get("posts")).toEqual([]);
    // CZĘŚCIOWA awaria jest odróżnialna od pustej sekcji - trasa indeksu
    // podaje na tej podstawie krótki TTL.
    expect(failedSections).toEqual(["posts"]);
    expect(locs(mapa.get("taxonomy") ?? [])).toEqual([`${ORIGIN}/category/prawo`]);
    expect(locs(mapa.get("core") ?? [])).toEqual(HUBY_CORE);
    expect(ostrzezenia).toHaveBeenCalledWith(
      '[seo] sitemap section "posts" read failed:',
      expect.any(TypeError),
    );
  });

  it("odmowa bazy w jednej sekcji trafia na listę awarii, zdrowe sekcje zostają", async () => {
    const db = atrapaAdmina({
      ...pelnyPlan(),
      categories: { odmowa: { message: "permission denied for table categories", code: "42501" } },
    });
    const { sections: mapa, failedSections } = await collectAllSitemapSections(
      db.admin,
      TENANT,
      ORIGIN,
    );
    expect(failedSections).toEqual(["taxonomy"]);
    expect(mapa.get("taxonomy")).toEqual([]);
    expect(locs(mapa.get("posts") ?? [])).toEqual([`${ORIGIN}/analizy/akt-o-uslugach`]);
  });

  it("awaria mapy ścieżek stron oznacza OBIE sekcje, które z niej korzystają", async () => {
    // `pages` i `posts` dzielą jeden odczyt ścieżek (`pagePathsOnce`) - jego
    // awaria zabiera adresy obu, więc obie muszą być na liście.
    const db = atrapaAdmina({
      ...pelnyPlan(),
      pages: { odmowa: { message: "permission denied for table pages", code: "42501" } },
    });
    const { failedSections } = await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    expect([...failedSections].sort()).toEqual(["pages", "posts"]);
  });

  it("mapa ścieżek korzysta z jednego wywołania wsadowego", async () => {
    const db = atrapaAdmina(
      planStron({
        "p-1": { sciezka: "a" },
        "p-2": { sciezka: "b" },
        "p-3": { sciezka: "c" },
      }),
    );
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(db.dla("rpc/page_full_paths")).toHaveLength(1);
    expect(db.dla("rpc/page_full_path")).toEqual([]);
  });
});

describe("large sitemap collections", () => {
  it("includes every post beyond the PostgREST row cap", async () => {
    const rows = Array.from({ length: 1203 }, (_, id) => wierszWpisu({ slug: `post-${id}` }));
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      posts: { wiersze: rows },
    });
    const entries = await collectSitemapSection(db.admin, TENANT, ORIGIN, "posts");
    expect(entries).toHaveLength(1203);
    expect(entries.at(-1)?.loc).toBe(`${ORIGIN}/analizy/post-1202`);
    expect(db.dla("posts").map((request) => request.params.get("offset"))).toEqual([
      "0",
      "500",
      "1000",
    ]);
  });

  it("paginates 1,203 parents and resolves paths in bounded batches", async () => {
    const pages = Object.fromEntries(
      Array.from({ length: 1203 }, (_, id) => [`p-${id}`, { sciezka: `page-${id}` }]),
    );
    const db = atrapaAdmina(planStron(pages));
    const entries = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(entries).toHaveLength(1203);
    expect(db.dla("pages")).toHaveLength(3);
    expect(
      db.dla("rpc/page_full_paths").map((request) => pageIdsZCiala(request.body).length),
    ).toEqual([500, 500, 203]);
    expect(db.dla("rpc/page_full_path")).toEqual([]);
  });
});

describe("shared parent-path boundary", () => {
  it("rejects a path RPC refusal with an observable section error", async () => {
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      "rpc/page_full_paths": { odmowa: { message: "path denied", code: "42501" } },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages")).toEqual([]);
    expect(ostrzezenia).toHaveBeenCalledWith(
      '[seo] sitemap section "pages" read failed:',
      expect.objectContaining({ message: "path denied" }),
    );
  });

  it("ignores missing RPC rows and paths outside the tenant-scoped request", async () => {
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      "rpc/page_full_paths": {
        wiersze: [
          { page_id: "foreign", full_path: "private" },
          { page_id: "p-1", full_path: "   " },
        ],
      },
    });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages")).toEqual([]);
    const empty = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      "rpc/page_full_paths": { wiersze: null },
    });
    expect(await collectSitemapSection(empty.admin, TENANT, ORIGIN, "pages")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
  });
});

// NAPRAWA 2026-10-10 - AWARIA ≠ PUSTKA, a odczyt ma termin.
//
// Trasa shardu zamieniała pustą listę w 404 „Unknown sitemap" - także wtedy,
// gdy lista była pusta, bo odczyt RZUCIŁ albo zawisł. Search Console czytał to
// jako „pliku nie ma" albo, przy zawieszonym połączeniu, jako „Ogólny błąd
// HTTP". `collectSitemapSectionResult` oddaje teraz flagę `failed` (trasa robi z niej
// 503 + Retry-After), a każdy kolektor ma budżet czasu.
describe("collectSitemapSectionResult - awaria odróżniona od pustki", () => {
  it("core: statyczne huby, zero zapytań, nigdy awaria", async () => {
    const db = atrapaAdmina({});
    const read = await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "core");
    expect(read.failed).toBe(false);
    expect(locs(read.entries)).toEqual(HUBY_CORE);
    expect(db.zadania).toEqual([]);
  });

  it("odmowa bazy: failed=true i ORYGINALNY błąd w logu (nie „[object Object]”)", async () => {
    const db = atrapaAdmina({
      ...planStron({ "p-1": { sciezka: "analizy" } }),
      "rpc/page_full_paths": { odmowa: { message: "path denied", code: "42501" } },
    });
    expect(await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "pages")).toEqual({
      entries: [],
      failed: true,
    });
    expect(ostrzezenia).toHaveBeenCalledWith(
      '[seo] sitemap section "pages" read failed:',
      expect.objectContaining({ message: "path denied", code: "42501" }),
    );
  });

  it("sekcja legalnie pusta to NIE awaria", async () => {
    const db = atrapaAdmina({ pages: { wiersze: [] }, site_settings: { wiersze: [] } });
    expect(await collectSitemapSectionResult(db.admin, TENANT, ORIGIN, "pages")).toEqual({
      entries: [],
      failed: false,
    });
  });

  it("odczyt, który nie mieści się w budżecie, jest awarią - nie wiszącym żądaniem", async () => {
    // Zawieszone połączenie PostgREST nie rzuca, tylko czeka - dokładnie ten
    // stan, którego `try/catch` nie łapał.
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "is", "in", "order"]) chain[method] = () => chain;
    chain.range = () => new Promise(() => undefined);
    const hanging = {
      from: () => chain,
      rpc: () => new Promise(() => undefined),
    } as unknown as SupabaseClient<Database>;

    const pending = collectSitemapSectionResult(hanging, TENANT, ORIGIN, "posts");
    await vi.advanceTimersByTimeAsync(SITEMAP_SECTION_BUDGET_MS);
    await expect(pending).resolves.toEqual({ entries: [], failed: true });
    expect(ostrzezenia).toHaveBeenCalledWith(
      `[seo] sitemap section "posts" read timed out after ${SITEMAP_SECTION_BUDGET_MS}ms`,
    );
  });

  it("collectAllSitemapSections: sekcja po terminie trafia do failedSections", async () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "is", "in", "order"]) chain[method] = () => chain;
    chain.range = () => new Promise(() => undefined);
    const hanging = {
      from: () => chain,
      rpc: () => new Promise(() => undefined),
    } as unknown as SupabaseClient<Database>;

    const pending = collectAllSitemapSections(hanging, TENANT, ORIGIN);
    await vi.advanceTimersByTimeAsync(SITEMAP_SECTION_BUDGET_MS);
    const { sections, failedSections } = await pending;
    expect([...failedSections].sort()).toEqual(
      SITEMAP_SECTIONS.filter((section) => section !== "core").sort(),
    );
    expect(locs(sections.get("core") ?? [])).toEqual(HUBY_CORE);
  });
});

describe("sekcja pages - lastmod z updated_at", () => {
  it("strona dostaje datę ostatniej zmiany (sam dzień), strona bez daty - bez lastmod", async () => {
    const db = atrapaAdmina(
      planStron({
        "p-1": { sciezka: "analizy", zmiana: "2026-08-19T14:30:00+00:00" },
        "p-2": { sciezka: "o-nas" },
      }),
    );
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    expect(wpisO(wpisy, `${ORIGIN}/analizy`)?.lastmod).toBe("2026-08-19");
    expect(wpisO(wpisy, `${ORIGIN}/o-nas`)).not.toHaveProperty("lastmod");
  });
});
