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
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * ZAKRESU NAJEMCY (czy każde zapytanie ma `.eq("tenant_id", …)`) pilnuje
//     bramka statyczna `serviceRoleTenantScope.gate.test.ts` - tu nie ma ani
//     jednego testu „czy jest filtr tenanta", choć filtr widać w asercjach
//     zapytań jako tło;
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
import { SITEMAP_SECTIONS } from "@/lib/seo/sitemapIndex";
import {
  collectAllSitemapSections,
  collectSitemapSection,
  coreSitemapEntries,
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
type PlanTabeli = Odpowiedz | ((zadanie: ZapisaneZadanie) => Odpowiedz);
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
}

/** Plan dla `pages` + `page_full_paths` (mapa ścieżek buduje się z obu). */
function planStron(strony: Record<string, StronaPlan>): Plan {
  return {
    pages: {
      wiersze: Object.entries(strony).map(([id, s]) => ({ id, seo_noindex: s.noindex === true })),
    },
    "rpc/page_full_paths": (zadanie) => {
      return {
        wiersze: pageIdsZCiala(zadanie.body).map((id) => ({
          page_id: id,
          full_path: strony[id]?.sciezka ?? null,
        })),
      };
    },
  };
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

describe("sekcja core - huby serwisu bez udziału bazy", () => {
  it("wypisuje wszystkie huby serwisu i nie wysyła ani jednego zapytania", async () => {
    const db = atrapaAdmina({});
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "core");
    expect(db.zadania).toEqual([]);
    expect(locs(wpisy)).toEqual([
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
      `${ORIGIN}/people`,
      `${ORIGIN}/experts`,
      `${ORIGIN}/contribute`,
      `${ORIGIN}/sitemap`,
    ]);
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
      planStron({ "p-1": { sciezka: "analizy" }, "p-2": { sciezka: "analizy/prawo" } }),
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

  it("czyta wyłącznie strony opublikowane i nieusunięte", async () => {
    const db = atrapaAdmina(planStron({ "p-1": { sciezka: "analizy" } }));
    await collectSitemapSection(db.admin, TENANT, ORIGIN, "pages");
    const params = db.dla("pages")[0].params;
    expect(params.get("status")).toBe("eq.published");
    expect(params.get("deleted_at")).toBe("is.null");
    expect(params.get("select")).toBe("id,seo_noindex");
  });

  it("brak stron to pusta sekcja - i ani jednego ostrzeżenia w logu", async () => {
    const db = atrapaAdmina({ pages: { wiersze: [] } });
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

describe("sekcja taxonomy - archiwa kategorii i tagów", () => {
  it("daje kategoriom i tagom osobne prefiksy, priorytety i lastmod", async () => {
    const db = atrapaAdmina({
      categories: { wiersze: [{ slug: "prawo", created_at: "2026-01-05T10:00:00.000Z" }] },
      tags: { wiersze: [{ slug: "ai-act", created_at: null }] },
    });
    const wpisy = await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy");
    expect(wpisy).toEqual([
      {
        loc: `${ORIGIN}/category/prawo`,
        lastmod: "2026-01-05",
        changefreq: "weekly",
        priority: "0.6",
      },
      { loc: `${ORIGIN}/tag/ai-act`, lastmod: undefined, changefreq: "weekly", priority: "0.5" },
    ]);
  });

  it("brak taksonomii to pusta sekcja, nie błąd", async () => {
    const db = atrapaAdmina({ categories: { wiersze: [] }, tags: { wiersze: [] } });
    expect(await collectSitemapSection(db.admin, TENANT, ORIGIN, "taxonomy")).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
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
    const mapa = await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    for (const sekcja of SITEMAP_SECTIONS) {
      if (sekcja === "core") continue;
      expect(mapa.get(sekcja)).toEqual([]);
    }
    expect(mapa.get("core")).toHaveLength(14);
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
    posts: { wiersze: [wierszWpisu()] },
    categories: { wiersze: [{ slug: "prawo", created_at: null }] },
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
    const mapa = await collectAllSitemapSections(db.admin, null, ORIGIN);
    expect([...mapa.keys()]).toEqual(["core"]);
    expect(mapa.get("core")).toHaveLength(14);
    expect(db.zadania).toEqual([]);
  });

  it("zwraca KAŻDĄ sekcję rejestru - indeks liczy shardy z tej mapy", async () => {
    const db = atrapaAdmina(pelnyPlan());
    const mapa = await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    expect([...mapa.keys()].sort()).toEqual([...SITEMAP_SECTIONS].sort());
    expect(locs(mapa.get("posts") ?? [])).toEqual([`${ORIGIN}/analizy/akt-o-uslugach`]);
    expect(locs(mapa.get("pages") ?? [])).toEqual([`${ORIGIN}/analizy`]);
  });

  it("mapa ścieżek stron powstaje RAZ na całe wywołanie, nie raz na sekcję", async () => {
    const db = atrapaAdmina(pelnyPlan());
    await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    // `pages` potrzebują jej sekcje `pages` i `posts` - odczyt jest jeden.
    expect(db.dla("pages")).toHaveLength(1);
  });

  it("awaria jednej sekcji nie zabiera adresów pozostałym", async () => {
    const db = atrapaAdmina({ ...pelnyPlan(), posts: { wiersze: { slug: "nie-tablica" } } });
    const mapa = await collectAllSitemapSections(db.admin, TENANT, ORIGIN);
    expect(mapa.get("posts")).toEqual([]);
    expect(locs(mapa.get("taxonomy") ?? [])).toEqual([`${ORIGIN}/category/prawo`]);
    expect(mapa.get("core")).toHaveLength(14);
    expect(ostrzezenia).toHaveBeenCalledWith(
      '[seo] sitemap section "posts" read failed:',
      expect.any(TypeError),
    );
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
