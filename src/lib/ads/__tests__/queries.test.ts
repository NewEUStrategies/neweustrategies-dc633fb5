// Warstwa DOBORU reklam: `src/lib/ads/queries.ts` (useAdPlacements).
//
// PO CO TEN PLIK ISTNIEJE. To jest JEDYNE wejście danych całego frontu reklam -
// `AdZone`, `AdSlotView`, `FooterSlideup`, `MidPostAds` i `useInFeedAds` nie
// pytają bazy same, tylko biorą listę stąd. Wszystko, co decyduje o tym, czy
// czytelnik zobaczy kreację - pozycja, typ strony, konkretna strona, okno emisji,
// wstrzymanie slotu, targeting językowy i treściowy - jest sklejone w tej jednej
// funkcji, a mierzone pokrycie linii wynosiło 6,7%. Reklama pokazana POZA oknem
// emisji to niezafakturowana emisja i spór z reklamodawcą; reklama NIEPOKAZANA
// mimo poprawnej konfiguracji to strata przychodu, której nikt nie zauważy, bo
// nie ma po niej żadnego śladu w logu.
//
// DLACZEGO ASERCJE NA KSZTAŁCIE ŁAŃCUCHA, A NIE TYLKO NA WYNIKU. Filtry
// `active`, `slot.status`, `starts_at`, `ends_at` egzekwuje PostgREST po stronie
// serwera - żaden test jednostkowy nie „przepuści" wygasłego wiersza, bo baza go
// nie odda. Jedyne, co można tu udowodnić, to że kod NAPRAWDĘ wysyła te warunki.
// Skasowanie `.eq("active", true)` nie zmieniłoby ani jednej asercji na danych,
// a wpuściłoby na stronę placementy wyłączone w panelu - dlatego łańcuch jest
// przedmiotem dowodu na równi z wynikiem.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE: klienta Supabase (sieć/baza) i i18n (źródło
// języka dla targetingu). Cała logika `queries.ts` oraz `types.ts`
// (parseAdTargeting/matchesAdTargeting) biegnie PRAWDZIWA - to ona jest
// przedmiotem dowodu, a nie jej atrapa.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const lang = vi.hoisted(() => ({ value: "pl" }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub(() => lang.value);
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

import { QueryClient } from "@tanstack/react-query";

import {
  adPlacementsQueryOptions,
  prefetchAdPlacementQueries,
  useAdPlacements,
} from "@/lib/ads/queries";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import type {
  AdPageType,
  AdPlacementWithSlot,
  AdPosition,
  AdSlot,
  AdSlotKind,
} from "@/lib/ads/types";

const from = () => stubs.from as SupabaseFromStub;

const TENANT = "aaaaaaaa-0000-0000-0000-00000000000a";

function slot(over: Partial<AdSlot> = {}): AdSlot {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    tenant_id: TENANT,
    name: "Kreacja testowa",
    kind: "image",
    status: "active",
    html: null,
    script: null,
    image_url: "https://cdn.example.com/kreacja.png",
    image_link: null,
    image_alt: "Kreacja testowa",
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

let seq = 0;
function placement(over: Partial<AdPlacementWithSlot> = {}): AdPlacementWithSlot {
  seq += 1;
  return {
    id: `66666666-7777-8888-9999-${String(seq).padStart(12, "0")}`,
    tenant_id: TENANT,
    slot_id: slot().id,
    position: "sidebar",
    page_type: "all",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    slot: slot(),
    ...over,
  };
}

/** Ustawia odpowiedź tabeli `ad_placements` na podaną listę wierszy. */
function respondWith(rows: AdPlacementWithSlot[]): void {
  from().setResponse("ad_placements", ok(rows));
}

function chain(): RecordedChain {
  const last = from().lastChain("ad_placements");
  if (!last) throw new Error("test: kod nie odpytał tabeli ad_placements");
  return last;
}

/** Argument pojedynczego ogniwa `.eq(kolumna, wartość)` z zapisanego łańcucha. */
function eqArg(column: string): unknown {
  const call = chain().calls.find((c) => c.method === "eq" && c.args[0] === column);
  return call?.args[1];
}

/**
 * Argument pojedynczego ogniwa `.in(kolumna, wartości)` - PO KOLUMNIE, a nie
 * „pierwsze `in` w łańcuchu". Od rozgrzewki wielopozycyjnej (2026-09-21) filtr
 * pozycji też jedzie `in`, więc `argsOf("in")` oddawałoby raz `position`, raz
 * `page_type` - zależnie od kolejności ogniw, a nie od przedmiotu dowodu.
 */
function inArg(column: string): unknown {
  const call = chain().calls.find((c) => c.method === "in" && c.args[0] === column);
  return call?.args[1];
}

/** Wszystkie argumenty ogniw `.or(...)` w kolejności wywołania. */
function orArgs(): string[] {
  return chain()
    .calls.filter((c) => c.method === "or")
    .map((c) => String(c.args[0]));
}

async function loadPlacements(
  position: AdPosition,
  pageType: AdPageType,
  pageId?: string | null,
  content?: { categorySlugs?: string[]; tagSlugs?: string[] },
) {
  const { result } = renderHookWithQueryClient(() =>
    useAdPlacements(position, pageType, pageId, content),
  );
  await waitFor(() => expect(result.current.isPending).toBe(false));
  return result;
}

beforeEach(() => {
  from().reset();
  lang.value = "pl";
});

// ---------------------------------------------------------------------------
describe("dobór placementów: pozycja, typ strony, identyfikator strony", () => {
  it("pyta o DOKŁADNIE jedną pozycję - strefa nie zaciąga cudzych kreacji", async () => {
    respondWith([]);

    await loadPlacements("footer_slideup", "post", null);

    expect(inArg("position")).toEqual(["footer_slideup"]);
  });

  it("dopuszcza placementy 'all' OBOK placementów danego typu strony", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "category", null);

    // Bez "all" w liście każda kampania ogólnositeowa zniknęłaby ze stron
    // kategorii; bez "category" znikałyby kampanie zawężone do kategorii.
    expect(inArg("page_type")).toEqual(["all", "category"]);
  });

  it.each<AdPageType>(["home", "post", "page", "category", "tag", "archive", "search"])(
    "typ strony %s trafia do filtra page_type razem z 'all'",
    async (pageType) => {
      respondWith([]);

      await loadPlacements("header_banner", pageType, null);

      expect(inArg("page_type")).toEqual(["all", pageType]);
    },
  );

  it("dla typu 'all' nie duplikuje wartości w filtrze", async () => {
    respondWith([]);

    await loadPlacements("header_banner", "all", null);

    expect(inArg("page_type")).toEqual(["all", "all"]);
  });

  it("placement przypięty do INNEJ strony nie wchodzi do wyniku", async () => {
    const mine = placement({ page_id: "post-1" });
    const foreign = placement({ page_id: "post-2" });
    respondWith([mine, foreign]);

    const result = await loadPlacements("sidebar", "post", "post-1");

    expect(result.current.data?.map((p) => p.id)).toEqual([mine.id]);
  });

  it("placement bez page_id (kampania ogólna) wchodzi na KAŻDEJ stronie", async () => {
    const general = placement({ page_id: null });
    respondWith([general]);

    const result = await loadPlacements("sidebar", "post", "dowolny-post");

    expect(result.current.data?.map((p) => p.id)).toEqual([general.id]);
  });

  it("bez identyfikatora strony placement przypięty do strony NIE wchodzi", async () => {
    respondWith([placement({ page_id: "post-1" })]);

    const result = await loadPlacements("sidebar", "post", undefined);

    expect(result.current.data).toEqual([]);
  });

  it("sortuje po sort_order - kolejność kampanii w strefie ustala redakcja", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "post", null);

    expect(chain().argsOf("order")).toEqual(["sort_order"]);
  });

  it("klucz cache pomija język i kontekst treści - fetch jest współdzielony", async () => {
    respondWith([]);
    const { queryClient } = renderHookWithQueryClient(() =>
      useAdPlacements("sidebar", "post", "post-1", { categorySlugs: ["ue"], tagSlugs: ["nato"] }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryData(["ad_placements", "sidebar", "post", "post-1"]),
      ).toBeDefined(),
    );
  });
});

// ---------------------------------------------------------------------------
describe("okno emisji starts_at / ends_at", () => {
  it("wysyła OBA warunki okna czasowego - także dla zalogowanej redakcji", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "post", null);

    const [startsCond, endsCond] = orArgs();
    // Dwa osobne `.or()` łączą się w PostgREST koniunkcją: (start OK) AND (koniec OK).
    expect(startsCond).toMatch(/^starts_at\.is\.null,starts_at\.lte\./);
    expect(endsCond).toMatch(/^ends_at\.is\.null,ends_at\.gte\./);
  });

  it("porównuje z CZASEM WYWOŁANIA, nie ze stałą z modułu", async () => {
    respondWith([]);
    const before = new Date().toISOString();

    await loadPlacements("sidebar", "post", null);

    const after = new Date().toISOString();
    const stamp = orArgs()[0].split("starts_at.lte.")[1];
    // Zamrożony znacznik (np. policzony raz przy imporcie modułu) emitowałby
    // kampanie wygasłe od startu procesu - w SSR proces żyje godzinami.
    expect(stamp >= before).toBe(true);
    expect(stamp <= after).toBe(true);
  });

  it("oba warunki niosą TEN SAM znacznik czasu - okno jest spójne", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "post", null);

    const [starts, ends] = orArgs();
    expect(starts.split("starts_at.lte.")[1]).toBe(ends.split("ends_at.gte.")[1]);
  });
});

// ---------------------------------------------------------------------------
describe("placement nieaktywny i slot wstrzymany", () => {
  it("żąda wyłącznie AKTYWNYCH placementów", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "post", null);

    expect(eqArg("active")).toBe(true);
  });

  it("żąda wyłącznie slotów o statusie active - slot wstrzymany gaśnie wszędzie", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "post", null);

    // Wstrzymanie slotu w panelu (`status = 'paused'`) to awaryjny wyłącznik
    // kampanii: musi zadziałać JEDNYM przełącznikiem, bez ruszania placementów.
    expect(eqArg("slot.status")).toBe("active");
  });

  it("dołącza slot ZŁĄCZENIEM WEWNĘTRZNYM - inaczej filtr statusu byłby pozorny", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "post", null);

    // Bez `!inner` PostgREST zwróciłby placement z `slot: null` zamiast go
    // odrzucić, a `p.slot.targeting` w selektorze wywróciłby cały render.
    expect(chain().argsOf("select")).toEqual(["*, slot:ad_slots!inner(*)"]);
  });
});

// ---------------------------------------------------------------------------
describe("pusty wynik i błąd zapytania", () => {
  it("pusta lista to pusta lista, a nie błąd", async () => {
    respondWith([]);

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("NULL z PostgREST (brak wierszy) daje pustą listę, nie wywrotkę", async () => {
    from().setResponse("ad_placements", { data: null, error: null });

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("błąd zapytania trafia do stanu zapytania, a nie do ciszy", async () => {
    from().setResponse("ad_placements", fail("permission denied for table ad_placements", "42501"));

    const result = await loadPlacements("sidebar", "post", null);

    // Awaria odczytu MUSI być widoczna: strefa reklamowa, która po błędzie
    // udaje „brak kampanii", ukrywa wygaszenie przychodu na całym serwisie.
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toMatchObject({ code: "42501" });
    expect(result.current.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("targeting slotu: język, kategorie, tagi", () => {
  it("slot bez targetingu emituje się zawsze", async () => {
    respondWith([placement({ slot: slot({ targeting: {} }) })]);

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.data).toHaveLength(1);
  });

  it("slot zawężony do 'en' nie pokazuje się czytelnikowi polskiej wersji", async () => {
    lang.value = "pl";
    respondWith([placement({ slot: slot({ targeting: { languages: ["en"] } }) })]);

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.data).toEqual([]);
  });

  it("slot zawężony do 'en' pokazuje się w wersji angielskiej", async () => {
    lang.value = "en";
    respondWith([placement({ slot: slot({ targeting: { languages: ["en"] } }) })]);

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.data).toHaveLength(1);
  });

  it("nieznany kod języka interfejsu jest traktowany jak polski", async () => {
    // `i18n.language` bywa regionalne ("en-GB") albo ustawione na język, którego
    // serwis nie ma; kod mapuje wszystko poza "en" na "pl".
    lang.value = "de";
    respondWith([
      placement({ id: "pl-only", slot: slot({ targeting: { languages: ["pl"] } }) }),
      placement({ id: "en-only", slot: slot({ targeting: { languages: ["en"] } }) }),
    ]);

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.data?.map((p) => p.id)).toEqual(["pl-only"]);
  });

  it("slot zawężony do kategorii wchodzi tylko na pasującej treści", async () => {
    respondWith([placement({ slot: slot({ targeting: { categorySlugs: ["energetyka"] } }) })]);

    const hit = await loadPlacements("sidebar", "post", "post-1", {
      categorySlugs: ["energetyka"],
      tagSlugs: [],
    });

    expect(hit.current.data).toHaveLength(1);
  });

  it("slot zawężony do kategorii NIE wchodzi na treści bez tej kategorii", async () => {
    respondWith([placement({ slot: slot({ targeting: { categorySlugs: ["energetyka"] } }) })]);

    const miss = await loadPlacements("sidebar", "post", "post-1", {
      categorySlugs: ["kultura"],
      tagSlugs: [],
    });

    expect(miss.current.data).toEqual([]);
  });

  it("kategorie i tagi działają ALTERNATYWĄ - trafienie w tag wystarczy", async () => {
    respondWith([
      placement({
        slot: slot({ targeting: { categorySlugs: ["energetyka"], tagSlugs: ["nato"] } }),
      }),
    ]);

    const result = await loadPlacements("sidebar", "post", "post-1", {
      categorySlugs: ["kultura"],
      tagSlugs: ["nato"],
    });

    expect(result.current.data).toHaveLength(1);
  });

  it("BEZ kontekstu treści slot z targetingiem treściowym nie jest emitowany", async () => {
    respondWith([placement({ slot: slot({ targeting: { categorySlugs: ["energetyka"] } }) })]);

    // Strefy poza stroną wpisu (header, archiwum) nie podają kontekstu - slot
    // zawężony do kategorii musi tam milczeć, a nie trafiać wszędzie.
    const result = await loadPlacements("header_banner", "archive", null);

    expect(result.current.data).toEqual([]);
  });

  it("uszkodzony jsonb targetingu nie wywraca strefy, tylko znosi zawężenie", async () => {
    respondWith([
      placement({ id: "smieci", slot: slot({ targeting: { languages: "en", categorySlugs: 7 } }) }),
    ]);

    const result = await loadPlacements("sidebar", "post", null);

    expect(result.current.data?.map((p) => p.id)).toEqual(["smieci"]);
  });

  it("targeting filtruje PO obserwatorze - ta sama odpowiedź, dwa wyniki", async () => {
    respondWith([
      placement({ id: "pl-only", slot: slot({ targeting: { languages: ["pl"] } }) }),
      placement({ id: "en-only", slot: slot({ targeting: { languages: ["en"] } }) }),
    ]);

    lang.value = "pl";
    const plResult = await loadPlacements("sidebar", "post", null);
    lang.value = "en";
    const enResult = await loadPlacements("sidebar", "post", null);

    expect(plResult.current.data?.map((p) => p.id)).toEqual(["pl-only"]);
    expect(enResult.current.data?.map((p) => p.id)).toEqual(["en-only"]);
  });
});

// ---------------------------------------------------------------------------
// BRAMKA PARYTETU: wartości enuma `ad_page_type` w bazie vs lista, którą klient
// wysyła w filtrze. Wzorzec z `src/lib/events/__tests__/dbEnumParity.test.ts`,
// tylko że tutaj stała po stronie klienta (`DB_AD_PAGE_TYPES` w queries.ts) jest
// PRYWATNA - jedynym uczciwym pomiarem jest to, co kod NAPRAWDĘ wysyła do
// PostgREST, więc parytet sprawdzamy zachowaniem, nie odczytem stałej.
// ---------------------------------------------------------------------------
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Wartości enuma po odtworzeniu całego łańcucha migracji (CREATE TYPE + ALTER TYPE). */
function enumValues(name: string): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const values: string[] = [];
  const create = new RegExp(
    `CREATE\\s+TYPE\\s+public\\.${name}\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)`,
    "i",
  );
  const add = new RegExp(
    `ALTER\\s+TYPE\\s+public\\.${name}\\s+ADD\\s+VALUE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+'([^']+)'`,
    "gi",
  );
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const created = sql.match(create);
    if (created) {
      for (const raw of created[1].split(",")) {
        const value = raw.trim().replace(/^'|'$/g, "");
        if (value.length > 0) values.push(value);
      }
    }
    for (const m of sql.matchAll(add)) {
      if (!values.includes(m[1])) values.push(m[1]);
    }
  }
  return values;
}

const DB_PAGE_TYPES = enumValues("ad_page_type");
const DB_POSITIONS = enumValues("ad_position");
const DB_SLOT_KINDS = enumValues("ad_slot_kind");

describe("bramka: typy stron znane bazie a filtr wysyłany przez klienta", () => {
  it("czyta enumy z migracji (test nie jest próżny)", () => {
    expect(DB_PAGE_TYPES).toContain("all");
    expect(DB_PAGE_TYPES).toContain("event");
    expect(DB_POSITIONS).toContain("footer_slideup");
    expect(DB_SLOT_KINDS).toEqual(["html", "script", "image"]);
  });

  it("unia AdPageType w typach klienta pokrywa się z enumem bazy", () => {
    const clientPageTypes: AdPageType[] = [
      "all",
      "home",
      "post",
      "page",
      "category",
      "tag",
      "archive",
      "search",
      "event",
    ];
    expect([...clientPageTypes].sort()).toEqual([...DB_PAGE_TYPES].sort());
  });

  it("unia AdPosition w typach klienta pokrywa się z enumem bazy", () => {
    const clientPositions: AdPosition[] = [
      "header_banner",
      "top_of_post",
      "mid_post",
      "bottom_of_post",
      "sidebar",
      "in_feed",
      "footer_slideup",
    ];
    expect([...clientPositions].sort()).toEqual([...DB_POSITIONS].sort());
  });

  it("unia AdSlotKind w typach klienta pokrywa się z enumem bazy", () => {
    const clientKinds: AdSlotKind[] = ["html", "script", "image"];
    expect([...clientKinds].sort()).toEqual([...DB_SLOT_KINDS].sort());
  });

  // -------------------------------------------------------------------------
  // DEFEKT NAPRAWIONY (08.2026) - test biegnie normalnie.
  //
  // CO BYŁO ZŁE. `queries.ts` trzymał prywatną listę `DB_AD_PAGE_TYPES` opisaną
  // komentarzem „wartości `ad_page_type`, które baza zna DZISIAJ (bez `event`)".
  // To „dzisiaj" skończyło się 2026-08-23: migracja
  // `20260823170000_event_front_binding.sql` wykonuje
  // `ALTER TYPE public.ad_page_type ADD VALUE IF NOT EXISTS 'event'`, a
  // wygenerowane typy (`Database["public"]["Enums"]["ad_page_type"]`) miały już
  // wariant `event`. Lista w `queries.ts` została stara, więc `dbPageTypes("event")`
  // zwracało `["all"]` zamiast `["all", "event"]`.
  //
  // DLACZEGO TO BYŁO RYZYKO. Wszystkie trzy pozostałe ogniwa łańcucha BYŁY gotowe:
  // `adPageTypeForLocation` zwraca "event" dla `/events/*` (pageType.ts:35),
  // panel `PlacementsPanel` oferuje „Wydarzenie" w selektorze (renderuje
  // `AD_PAGE_TYPE_LABEL_KEYS`, w którym `event` jest), a baza wartość przyjmie.
  // Redaktor sprzedawał więc kampanię na stronę wydarzenia, zapisywał placement
  // bez żadnego ostrzeżenia - i ta kampania NIE WYEMITOWAŁABY SIĘ ANI RAZU.
  // Awaria była całkowicie niema: brak reklamy wygląda identycznie jak „nikt nie
  // kupił", nie ma błędu w konsoli, nie ma pustego wyniku do zauważenia, a raport
  // wyświetleń pokazałby zero, które wszyscy przypisaliby klientowi.
  //
  // JAK NAPRAWIONE. Ręczna lista ustąpiła miejsca `Constants.public.Enums.ad_page_type`
  // z wygenerowanych typów - czyli temu samemu źródłu, z którego pochodzi typ
  // `DbAdPageType`. Wybrano tę opcję, a nie dopisanie `"event"` do listy, właśnie
  // dlatego, że rozjazd nie może się powtórzyć: następna wartość enuma wjeżdża tu
  // razem z regeneracją typów. Strażnik na nieznane wartości (`dbPageTypes`
  // odsiewa typ strony spoza enuma) zostaje - chroni przed odwrotnym rozjazdem,
  // w którym klient zna wartość, a baza jeszcze nie.
  it("typ strony 'event' trafia do filtra page_type", async () => {
    respondWith([]);

    await loadPlacements("header_banner", "event", null);

    expect(inArg("page_type")).toEqual(["all", "event"]);
  });
});

// ---------------------------------------------------------------------------
// ROZGRZEWKA SSR KILKU POZYCJI ZA JEDEN ROUND-TRIP.
//
// PO CO OSOBNY BLOK. Trasa łapiąca wszystko (`src/routes/$.tsx`) grzeje dwie
// pozycje naraz - baner nagłówka i slot nad treścią - a jej fala wtórna ma
// sufit 6 równoległych odnóg (`check:ssr-budgets`; twardy limit 6 podżądań
// runtime Cloudflare Workers). Dowód musi więc obejmować OBIE własności naraz:
// że round-trip jest JEDEN i że rozgrzane klucze to DOKŁADNIE te, które czyta
// `useAdPlacements` - rozgrzewka pod innym kluczem kosztuje zapytanie i nie
// zdejmuje ani jednego skoku układu.
// ---------------------------------------------------------------------------
describe("prefetchAdPlacementQueries - rozgrzewka SSR", () => {
  it("pyta bazę RAZ o wszystkie pozycje, a nie raz na pozycję", async () => {
    respondWith([]);
    const qc = new QueryClient();

    await prefetchAdPlacementQueries(
      qc,
      [{ position: "top_of_post", pageId: "post-1" }, { position: "header_banner" }],
      "post",
    );

    expect(from().chainsFor("ad_placements")).toHaveLength(1);
    expect(inArg("position")).toEqual(["header_banner", "top_of_post"]);
    expect(inArg("page_type")).toEqual(["all", "post"]);
  });

  it("zasiewa DOKŁADNIE te klucze, spod których czyta widok", async () => {
    const banner = placement({ position: "header_banner", page_id: null });
    const above = placement({ position: "top_of_post", page_id: "post-1" });
    respondWith([banner, above]);
    const qc = new QueryClient();

    await prefetchAdPlacementQueries(
      qc,
      [{ position: "top_of_post", pageId: "post-1" }, { position: "header_banner" }],
      "post",
    );

    // Klucze biorą się z tej samej fabryki, co w `useAdPlacements` - gdyby
    // rozgrzewka budowała literał u siebie, każdy jej wpis byłby osobnym
    // wpisem cache'u i komponent i tak poszedłby po dane po hydratacji.
    expect(
      qc.getQueryData(adPlacementsQueryOptions("top_of_post", "post", "post-1").queryKey),
    ).toEqual([above]);
    expect(qc.getQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey)).toEqual([
      banner,
    ]);
  });

  it("każda pozycja dostaje WŁASNĄ projekcję page_id z tej samej odpowiedzi", async () => {
    // Na tym stoi współdzielenie jednego round-tripu: klucz banera nie zna
    // identyfikatora strony, klucz slotu nad treścią - zna. Placement przypięty
    // do tej strony należy więc WYŁĄCZNIE do tego drugiego.
    const pinned = placement({ position: "header_banner", page_id: "post-1" });
    const general = placement({ position: "header_banner", page_id: null });
    respondWith([pinned, general]);
    const qc = new QueryClient();

    await prefetchAdPlacementQueries(
      qc,
      [{ position: "header_banner" }, { position: "header_banner", pageId: "post-1" }],
      "post",
    );

    expect(qc.getQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey)).toEqual([
      general,
    ]);
    expect(
      qc.getQueryData(adPlacementsQueryOptions("header_banner", "post", "post-1").queryKey),
    ).toEqual([pinned, general]);
  });

  it("wiersz CUDZEJ pozycji nie wchodzi do klucza sąsiada", async () => {
    // Jedno zapytanie oddaje wiersze OBU pozycji - rozdziela je kod, nie baza.
    // Bez filtra po `position` baner nagłówka dostałby kreację slotu nad
    // treścią (i odwrotnie), czyli emisję sprzedaną na inne miejsce.
    const above = placement({ position: "top_of_post", page_id: null });
    respondWith([above]);
    const qc = new QueryClient();

    await prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post");

    expect(qc.getQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey)).toEqual([]);
  });

  it("awaria bazy NIE rzuca - slot wraca do fetchu po hydratacji", async () => {
    from().setResponse("ad_placements", fail("permission denied for table ad_placements", "42501"));
    const qc = new QueryClient();

    await expect(
      prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post"),
    ).resolves.toBeUndefined();

    // Rozgrzewka reklamy NIE ma prawa zdjąć wspólnego cache'u dokumentu, więc
    // nie zgłasza degradacji ani nie odrzuca - a brak wpisu znaczy tyle, że
    // przeglądarka pobierze listę sama, jak przed tą rozgrzewką.
    expect(
      qc.getQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey),
    ).toBeUndefined();
  });

  it("pusta lista pozycji nie kosztuje round-tripu", async () => {
    respondWith([]);
    const qc = new QueryClient();

    await prefetchAdPlacementQueries(qc, [], "post");

    expect(from().chainsFor("ad_placements")).toHaveLength(0);
  });
});

describe("prefetchAdPlacementQueries - bramka świeżości", () => {
  it("NIE pyta bazy o klucz, który ma świeże dane - inaczej rozgrzewka odbierałaby `staleTime`", async () => {
    // `edgeTtlCache` jest w przeglądarce przezroczysty, więc bez tej bramki
    // każda nawigacja SPA płaciłaby round-trip po listę, którą react-query
    // trzyma jeszcze przez minutę.
    respondWith([]);
    const qc = new QueryClient();
    qc.setQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey, []);

    await prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post");

    expect(from().chainsFor("ad_placements")).toHaveLength(0);
  });

  it("cel ŚWIEŻY nie traci danych przez zapytanie wysłane po cel ZIMNY", async () => {
    // Jedno zapytanie idzie wtedy wyłącznie po zimne pozycje, więc odpowiedź
    // nie zawiera wierszy celu świeżego - nadpisanie go dałoby pustą listę.
    const banner = placement({ position: "header_banner", page_id: null });
    const above = placement({ position: "top_of_post", page_id: null });
    respondWith([above]);
    const qc = new QueryClient();
    qc.setQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey, [banner]);

    await prefetchAdPlacementQueries(
      qc,
      [{ position: "header_banner" }, { position: "top_of_post" }],
      "post",
    );

    expect(inArg("position")).toEqual(["top_of_post"]);
    expect(qc.getQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey)).toEqual([
      banner,
    ]);
    expect(qc.getQueryData(adPlacementsQueryOptions("top_of_post", "post").queryKey)).toEqual([
      above,
    ]);
  });

  it("wpis PRZETERMINOWANY (`updatedAt: 0`) liczy się jak zimny", async () => {
    // Zasiew fallbackowy rodzi się przeterminowany właśnie po to, żeby prawdziwe
    // dane go zastąpiły - rozgrzewka nie może go czytać jako „gotowe".
    respondWith([]);
    const qc = new QueryClient();
    qc.setQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey, [], {
      updatedAt: 0,
    });

    await prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post");

    expect(from().chainsFor("ad_placements")).toHaveLength(1);
  });
});
