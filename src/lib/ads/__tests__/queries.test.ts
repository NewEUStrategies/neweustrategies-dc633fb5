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

import { useAdPlacements } from "@/lib/ads/queries";
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

    expect(eqArg("position")).toBe("footer_slideup");
  });

  it("dopuszcza placementy 'all' OBOK placementów danego typu strony", async () => {
    respondWith([]);

    await loadPlacements("sidebar", "category", null);

    // Bez "all" w liście każda kampania ogólnositeowa zniknęłaby ze stron
    // kategorii; bez "category" znikałyby kampanie zawężone do kategorii.
    expect(chain().argsOf("in")).toEqual(["page_type", ["all", "category"]]);
  });

  it.each<AdPageType>(["home", "post", "page", "category", "tag", "archive", "search"])(
    "typ strony %s trafia do filtra page_type razem z 'all'",
    async (pageType) => {
      respondWith([]);

      await loadPlacements("header_banner", pageType, null);

      expect(chain().argsOf("in")).toEqual(["page_type", ["all", pageType]]);
    },
  );

  it("dla typu 'all' nie duplikuje wartości w filtrze", async () => {
    respondWith([]);

    await loadPlacements("header_banner", "all", null);

    expect(chain().argsOf("in")).toEqual(["page_type", ["all", "all"]]);
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
  // DEFEKT - test celowo oznaczony `it.fails`, kod produkcyjny NIE jest zmieniany.
  //
  // CO JEST ZŁE. `queries.ts` trzyma prywatną listę `DB_AD_PAGE_TYPES` opisaną
  // komentarzem „wartości `ad_page_type`, które baza zna DZISIAJ (bez `event`)".
  // To „dzisiaj" skończyło się 2026-08-23: migracja
  // `20260823170000_event_front_binding.sql` wykonuje
  // `ALTER TYPE public.ad_page_type ADD VALUE IF NOT EXISTS 'event'`, a
  // wygenerowane typy (`Database["public"]["Enums"]["ad_page_type"]`) mają już
  // wariant `event`. Lista w `queries.ts` została stara, więc `dbPageTypes("event")`
  // zwraca `["all"]` zamiast `["all", "event"]`.
  //
  // DLACZEGO TO RYZYKO. Wszystkie trzy pozostałe ogniwa łańcucha SĄ gotowe:
  // `adPageTypeForLocation` zwraca "event" dla `/events/*` (pageType.ts:35),
  // panel `PlacementsPanel` oferuje „Wydarzenie" w selektorze (renderuje
  // `AD_PAGE_TYPE_LABEL_KEYS`, w którym `event` jest), a baza wartość przyjmie.
  // Redaktor sprzeda więc kampanię na stronę wydarzenia, zapisze placement bez
  // żadnego ostrzeżenia - i ta kampania NIE WYEMITUJE SIĘ ANI RAZU. Awaria jest
  // całkowicie niema: brak reklamy wygląda identycznie jak „nikt nie kupił",
  // nie ma błędu w konsoli, nie ma pustego wyniku do zauważenia, a raport
  // wyświetleń pokaże zero, które wszyscy przypiszą klientowi.
  //
  // DLACZEGO NIE NAPRAWIAM. Zadanie zabrania zmian w kodzie produkcyjnym.
  // Poprawka jest jednoliniowa (dopisać `"event"` do `DB_AD_PAGE_TYPES`), ale
  // wymaga też decyzji, czy lista ma dalej być pisana ręcznie, czy brana z
  // `Constants.public.Enums.ad_page_type` z wygenerowanych typów - druga opcja
  // sprawia, że ten rozjazd nie może się powtórzyć. To zmiana projektowa,
  // a nie test.
  it.fails("typ strony 'event' trafia do filtra page_type (DEFEKT: nie trafia)", async () => {
    respondWith([]);

    await loadPlacements("header_banner", "event", null);

    expect(chain().argsOf("in")).toEqual(["page_type", ["all", "event"]]);
  });
});
