// PROGRAMY BADAWCZE - co widzi czytelnik strony programu, gdy któraś z ośmiu
// granic danych odpowie inaczej niż szczęśliwie.
//
// CO TO DOWODZI. `src/lib/queries/programs.ts` czyta stronę programu z OŚMIU
// źródeł naraz (program, zespół przez RPC, projekty, partnerzy, kuratorowane
// pozycje, publikacje z kategorii, podcasty, wydarzenia) i skleja z nich jeden
// obiekt lądowania. Nie renderuje niczego - decyduje, jakie zapytania polecą, w
// jakiej kolejności ustawią się wyniki i CO SIĘ STANIE, gdy jedno z ośmiu
// źródeł odmówi. Przypadki są nazwane po skutku dla czytelnika i dla danych:
//
//   * DZIESIĘĆ MIEJSC, KTÓRE MUSZĄ RZUCIĆ. Ten moduł jest wzorowo szczelny:
//     `if (error) throw` stoi przy KAŻDYM z dziesięciu odczytów (linie 143,
//     161, 184-187, 220, 231, 243, 257, 269). Każde z nich ma tu własny
//     przypadek, bo połknięcie choćby jednego zamieniłoby awarię w „program bez
//     zespołu" / „program bez publikacji" - stan wyglądający na poprawny;
//   * JEDYNE POŁKNIĘCIE JEST W ADRESACH. `hydrateHref` (linia 118) czyta
//     `const { data }` bez `error`, a linia 124 domyka to `?? "blog"`. Ma to
//     widoczny skutek, więc obok przypadku przypinającego stan faktyczny stoi
//     `it.fails` z konsekwencją dla człowieka;
//   * KOLEJNOŚĆ KURATORA NIE JEST KOLEJNOŚCIĄ BAZY. `WHERE id IN (...)` oddaje
//     wiersze w dowolnej kolejności, więc raporty flagowe, podcasty i
//     wydarzenia są przestawiane wg `sort_order` z tabeli pozycji. Test podaje
//     wiersze W ODWROTNEJ kolejności niż kuratorska - inaczej nie dowodziłby
//     niczego;
//   * PUSTA KURACJA NIE PYTA BAZY. Program bez raportów flagowych nie może
//     wysłać zapytania po wpisy, program bez podcastów - po podcasty, program
//     bez powiązanej kategorii - po pivot kategorii. To asercje na BRAK
//     łańcucha, jedyna forma, w jakiej „zero zbędnych round-tripów" da się
//     dowieść;
//   * DWA OGNIWA `.order()` NA LIŚCIE PROGRAMÓW. `sort_order`, a potem
//     `name_pl` jako ROZSTRZYGNIĘCIE REMISÓW. Zgubione drugie ogniwo daje
//     losową kolejność programów o tej samej wadze między żądaniami, czyli
//     przeskakujące kafle na stronie indeksu;
//   * WIDEŁKI LIMITU. `Math.max(1, Math.min(limit, 100))` sprawdzam na
//     wartości domyślnej, na zerze i powyżej setki - limit 0 oznaczałby pustą
//     stronę indeksu przy pełnej bazie programów;
//   * IZOLACJA POZYCJI KURATOROWANYCH. Pozycja o właściwym typie, ale z pustym
//     `post_id`/`podcast_id`/`event_id` (osierocony wiersz po usunięciu treści)
//     NIE MOŻE wejść do listy id - zapytanie `.in()` z `null` w tablicy
//     zwróciłoby błąd albo cudze wiersze.
//
// JAK. Zaślepiona jest DOKŁADNIE jedna granica: klient Supabase (łańcuch
// PostgREST + rejestrator RPC ze wspólnego harnessu `@/test/supabase`). Zero
// sieci, zero sekretów, zero prawdziwego zegara (data bazowa 2026-08-21T10:00).
// `queryFn` uruchamiamy PRAWDZIWYM `QueryClient.fetchQuery`, więc nie ma tu ani
// jednego rzutowania funkcji; zawężenie wyniku do niepustego lądowania robi
// strażnik runtime.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `normalizeQuestions` i `orderByIds` jako czystych funkcji - pokrywa je
//     `src/lib/programs/__tests__/shape.test.ts`. Tutaj dowodzę tylko tego, że
//     warstwa danych je WOŁA: że uszkodzony jsonb pytań nie wychodzi z modułu i
//     że kolejność kuratora przetrwała podróż przez `.in()`;
//   * treści i uprawnień funkcji SQL `get_program_members` oraz
//     `page_full_path` - to pgTAP. Tu dowodzę wyłącznie NAZW argumentów
//     (`p_program_ids`, `_page_id`), bo obiekt argumentów jest luźno typowany:
//     literówka przechodzi przez `tsc` i przez przegląd, a serwer po prostu
//     odda pustą listę i strona programu wyrenderuje się bez zespołu;
//   * izolacji najemcy - to RLS i pgTAP; ten moduł nie filtruje po tenancie i
//     nie ma tu ani jednej asercji „czy jest filtr tenanta";
//   * renderu strony programu i jej adresów - to testy tras i komponentów,
//     które ZAŚLEPIAJĄ ten moduł;
//   * kolumn i kształtu typów `Podcast` / `PublicEvent` - należą do swoich
//     modułów; tutaj wiersze są nieprzejrzystymi danymi wejściowymi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  fail,
  ok,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import type { RecordedRpc, SupabaseRpcStub } from "@/test/supabase/rpc";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";

/** Data bazowa całego pliku - żaden przypadek nie czyta prawdziwego zegara. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  h.from = from;
  h.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

import {
  PROGRAMS_INDEX_LIMIT,
  latestProgramsQueryOptions,
  programBySlugQueryOptions,
  type ProgramLanding,
} from "@/lib/queries/programs";

// ---------- strażniki zawężające (zamiast rzutowań) ------------------------

function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return s;
}

function funkcje(): SupabaseRpcStub {
  const s = h.rpc;
  if (!s) throw new Error("test: atrapa RPC Supabase nie została podpięta");
  return s;
}

/** Ostatni łańcuch dla tabeli. Brak łańcucha to BŁĄD TESTU, nie `undefined`:
 *  asercja „kod nie zapytał o tę tabelę" ma własną formę (`chainsFor`). */
function lancuch(tabela: string): RecordedChain {
  const c = baza().lastChain(tabela);
  if (!c) throw new Error(`test: kod nie zbudował łańcucha dla tabeli "${tabela}"`);
  return c;
}

function wywolanie(nazwa: string): RecordedRpc {
  const c = funkcje().lastCall(nazwa);
  if (!c) throw new Error(`test: kod nie wywołał RPC "${nazwa}"`);
  return c;
}

/** Argumenty WSZYSTKICH wystąpień ogniwa - `.order()` bywa wołane dwa razy. */
function ogniwa(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

function filtrEq(chain: RecordedChain, kolumna: string): ReadonlyArray<unknown> | undefined {
  return ogniwa(chain, "eq").find((a) => a[0] === kolumna);
}

/** Zawężenie wyniku do NIEPUSTEGO lądowania w runtime - zamiast rzutowania. */
function jakoLadowanie(wynik: ProgramLanding | null): ProgramLanding {
  if (wynik === null) throw new Error("test: zapytanie oddało `null`, oczekiwano lądowania");
  return wynik;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// ---------- fabryki danych -------------------------------------------------

const SLUG = "bezpieczenstwo";
const ID_PROGRAMU = "prog-1";
const ID_KATEGORII = "kat-1";
const ID_STRONY = "str-1";

function wierszProgramu(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID_PROGRAMU,
    tenant_id: "ten-1",
    slug: SLUG,
    name_pl: "Bezpieczeństwo",
    name_en: "Security",
    tagline_pl: null,
    tagline_en: null,
    scope_pl: null,
    scope_en: null,
    research_questions: [{ pl: "Pytanie", en: "Question" }],
    icon: "shield",
    accent_color: "#123456",
    hero_image_url: null,
    category_id: null,
    contact_email: null,
    sort_order: 1,
    status: "published",
    updated_at: DATA_BAZOWA,
    created_at: DATA_BAZOWA,
    ...over,
  };
}

function wierszWpisu(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T00:00:00.000Z",
    parent_page_id: ID_STRONY,
    author_id: null,
    is_sponsored: null,
    sponsored_kind: null,
    sponsored_affiliate: null,
    ...over,
  };
}

function pozycja(
  typ: string,
  klucz: "post_id" | "podcast_id" | "event_id",
  id: string | null,
  sort = 0,
): Record<string, unknown> {
  return {
    item_type: typ,
    post_id: null,
    podcast_id: null,
    event_id: null,
    [klucz]: id,
    sort_order: sort,
  };
}

/** Plan odpowiedzi wszystkich ośmiu granic lądowania. Każda ma domyślną,
 *  UDANĄ odpowiedź, bo atrapa traktuje niezaplanowaną tabelę jako błąd testu. */
interface PlanLadowania {
  program?: SupabaseResult;
  zespol?: SupabaseResult;
  projekty?: SupabaseResult;
  partnerzy?: SupabaseResult;
  pozycje?: SupabaseResult;
  pivot?: SupabaseResult;
  wpisy?: SupabaseResult;
  podcasty?: SupabaseResult;
  wydarzenia?: SupabaseResult;
  /**
   * Odpowiedź RPC `page_full_path`. Dopuszcza RESPONDER zależny od wywołania,
   * bo jeden przypadek pyta o ścieżkę dwóch różnych stron rodzicielskich
   * i musi odpowiedzieć różnie na `_page_id`.
   */
  sciezka?: SupabaseResult | ((call: RecordedRpc) => SupabaseResult);
}

function planuj(plan: PlanLadowania = {}): void {
  baza().setResponse("research_programs", plan.program ?? ok(wierszProgramu()));
  baza().setResponse("research_program_projects", plan.projekty ?? ok([]));
  baza().setResponse("research_program_partners", plan.partnerzy ?? ok([]));
  baza().setResponse("research_program_items", plan.pozycje ?? ok([]));
  baza().setResponse("post_categories", plan.pivot ?? ok([]));
  baza().setResponse("posts", plan.wpisy ?? ok([]));
  baza().setResponse("podcasts", plan.podcasty ?? ok([]));
  baza().setResponse("events", plan.wydarzenia ?? ok([]));
  funkcje().setResponse("get_program_members", plan.zespol ?? ok([]));
  funkcje().setResponse("page_full_path", plan.sciezka ?? ok("programy/bezpieczenstwo"));
}

// ---------- cykl życia -----------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  baza().reset();
  funkcje().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ==========================================================================
// INDEKS PROGRAMÓW
// ==========================================================================

describe("indeks programów: kolejność kafli i widełki limitu", () => {
  it("pyta o opublikowane, sortuje wagą, a REMISY rozstrzyga nazwą", async () => {
    baza().setResponse("research_programs", ok([wierszProgramu()]));
    await klient().fetchQuery(latestProgramsQueryOptions());
    const c = lancuch("research_programs");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    // DWA ogniwa i ich kolejność są kontraktem: bez drugiego programy o tej
    // samej wadze przeskakiwałyby między żądaniami.
    expect(ogniwa(c, "order")).toEqual([
      ["sort_order", { ascending: true }],
      ["name_pl", { ascending: true }],
    ]);
    expect(ogniwa(c, "limit")).toEqual([[PROGRAMS_INDEX_LIMIT]]);
  });

  it("limit trzyma się widełek 1..100 - zero nie może wygasić indeksu", async () => {
    baza().setResponse("research_programs", ok([]));
    await klient().fetchQuery(latestProgramsQueryOptions(0));
    expect(ogniwa(lancuch("research_programs"), "limit")).toEqual([[1]]);

    baza().reset();
    baza().setResponse("research_programs", ok([]));
    await klient().fetchQuery(latestProgramsQueryOptions(500));
    expect(ogniwa(lancuch("research_programs"), "limit")).toEqual([[100]]);
  });

  it("uszkodzony jsonb pytań badawczych nie wychodzi z modułu", async () => {
    // `normalizeQuestions` ma własne testy - tu dowodzę, że warstwa danych ją
    // WOŁA, więc pole zawsze jest tablicą i render nie wywala się na `.map()`.
    baza().setResponse(
      "research_programs",
      ok([wierszProgramu({ research_questions: "to nie jest tablica" })]),
    );
    const lista = await klient().fetchQuery(latestProgramsQueryOptions());
    expect(lista[0].research_questions).toEqual([]);
  });

  it("PUSTO: serwis bez programów oddaje pustą listę", async () => {
    baza().setResponse("research_programs", ok(null));
    await expect(klient().fetchQuery(latestProgramsQueryOptions())).resolves.toEqual([]);
  });

  it("ODMOWA: indeks rzuca, zamiast udawać serwis bez programów badawczych", async () => {
    baza().setResponse("research_programs", fail("odmowa programów", "42501"));
    await expect(klient().fetchQuery(latestProgramsQueryOptions())).rejects.toThrow(
      "odmowa programów",
    );
  });
});

// ==========================================================================
// STRONA PROGRAMU - istnienie i szczelność ośmiu granic
// ==========================================================================

describe("strona programu: kiedy jej nie ma, a kiedy jest awaria", () => {
  it("puste `slug` wyłącza zapytanie, zamiast pytać bazę o nic", () => {
    expect(programBySlugQueryOptions("").enabled).toBe(false);
    expect(programBySlugQueryOptions(SLUG).enabled).toBe(true);
  });

  it("nieopublikowany albo nieistniejący program daje `null` i ZERO dalszych zapytań", async () => {
    planuj({ program: ok(null) });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).resolves.toBeNull();
    // Osiem granic nie zostało dotkniętych - to jest cała oszczędność.
    expect(baza().chainsFor("research_program_projects")).toHaveLength(0);
    expect(baza().chainsFor("research_program_items")).toHaveLength(0);
    expect(funkcje().callsFor("get_program_members")).toHaveLength(0);
  });

  it("program szuka się po slugu I po statusie - szkic nie ma publicznej strony", async () => {
    planuj();
    await klient().fetchQuery(programBySlugQueryOptions(SLUG));
    const c = baza().chainsFor("research_programs")[0];
    expect(filtrEq(c, "slug")).toEqual(["slug", SLUG]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(c.has("maybeSingle")).toBe(true);
  });

  it("ODMOWA odczytu programu rzuca, zamiast oddać „nie ma takiego programu”", async () => {
    planuj({ program: fail("odmowa programu", "42501") });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa programu",
    );
  });

  it("ODMOWA odczytu zespołu rzuca - strona nie może udawać programu bez ludzi", async () => {
    planuj({ zespol: fail("odmowa zespołu", "42501") });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa zespołu",
    );
  });

  it("ODMOWA odczytu projektów rzuca", async () => {
    planuj({ projekty: fail("odmowa projektów", "42501") });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa projektów",
    );
  });

  it("ODMOWA odczytu partnerów rzuca - lista partnerów to zobowiązanie, nie ozdoba", async () => {
    planuj({ partnerzy: fail("odmowa partnerów", "42501") });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa partnerów",
    );
  });

  it("ODMOWA odczytu pozycji kuratorowanych rzuca", async () => {
    planuj({ pozycje: fail("odmowa pozycji", "42501") });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa pozycji",
    );
  });
});

describe("strona programu: kształt zapytań o dzieci i o kurację", () => {
  it("nazwa argumentu RPC zespołu jest jedynym dowodem zawężenia do programu", async () => {
    planuj();
    await klient().fetchQuery(programBySlugQueryOptions(SLUG));
    // Literówka w `p_program_ids` przechodzi przez `tsc`, a serwer odda pustą
    // listę - strona wyrenderuje się bez zespołu i nikt tego nie zgłosi.
    expect(wywolanie("get_program_members").keys()).toEqual(["p_program_ids"]);
    expect(wywolanie("get_program_members").arg("p_program_ids")).toEqual([ID_PROGRAMU]);
  });

  it("projekty, partnerzy i pozycje sortują się kolejnością operatora", async () => {
    planuj();
    await klient().fetchQuery(programBySlugQueryOptions(SLUG));
    for (const tabela of [
      "research_program_projects",
      "research_program_partners",
      "research_program_items",
    ]) {
      const c = lancuch(tabela);
      expect(filtrEq(c, "program_id")).toEqual(["program_id", ID_PROGRAMU]);
      expect(ogniwa(c, "order")).toEqual([["sort_order", { ascending: true }]]);
    }
  });

  it("kierownik programu wyłania się z flagi `is_lead`, a jego brak daje `null`", async () => {
    planuj({
      zespol: ok([
        { profile_id: "os-1", is_lead: false, sort_order: 0 },
        { profile_id: "os-2", is_lead: true, sort_order: 1 },
      ]),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.lead?.profile_id).toBe("os-2");
    // Cały zespół zostaje na liście - kierownik jest wyróżnieniem, nie filtrem.
    expect(ladowanie.team.map((m) => m.profile_id)).toEqual(["os-1", "os-2"]);
  });

  it("zespół bez wyznaczonego kierownika nie wymyśla go z pierwszej osoby", async () => {
    planuj({ zespol: ok([{ profile_id: "os-1", is_lead: false, sort_order: 0 }]) });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.lead).toBeNull();
  });

  it("puste odpowiedzi wszystkich ośmiu granic dają kompletne, puste lądowanie", async () => {
    planuj({ zespol: ok(null), projekty: ok(null), partnerzy: ok(null), pozycje: ok(null) });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie).toMatchObject({
      lead: null,
      team: [],
      projects: [],
      partners: [],
      flagshipReports: [],
      latestPublications: [],
      podcasts: [],
      events: [],
    });
    expect(ladowanie.program.slug).toBe(SLUG);
  });
});

// ==========================================================================
// PUBLIKACJE Z POWIĄZANEJ KATEGORII - płyną automatem, nie z kuracji
// ==========================================================================

describe("najnowsze publikacje programu: automat z kategorii, nie kuracja", () => {
  it("program BEZ powiązanej kategorii nie pyta o pivot ani o wpisy", async () => {
    planuj({ program: ok(wierszProgramu({ category_id: null })) });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.latestPublications).toEqual([]);
    expect(baza().chainsFor("post_categories")).toHaveLength(0);
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("kategoria BEZ wpisów kończy sprawę na pivocie - drugi round-trip nie leci", async () => {
    planuj({ program: ok(wierszProgramu({ category_id: ID_KATEGORII })), pivot: ok([]) });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.latestPublications).toEqual([]);
    expect(filtrEq(lancuch("post_categories"), "category_id")).toEqual([
      "category_id",
      ID_KATEGORII,
    ]);
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("pivot bez wierszy (null) też nie generuje zapytania o wpisy", async () => {
    planuj({ program: ok(wierszProgramu({ category_id: ID_KATEGORII })), pivot: ok(null) });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.latestPublications).toEqual([]);
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("publikacje: od najnowszych, tylko opublikowane i nieusunięte, sześć pozycji", async () => {
    planuj({
      program: ok(wierszProgramu({ category_id: ID_KATEGORII })),
      pivot: ok([{ post_id: "w-1" }, { post_id: "w-2" }]),
      wpisy: ok([wierszWpisu("w-1")]),
    });
    await klient().fetchQuery(programBySlugQueryOptions(SLUG));
    const c = lancuch("posts");
    expect(c.argsOf("in")).toEqual(["id", ["w-1", "w-2"]]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    expect(ogniwa(c, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(ogniwa(c, "limit")).toEqual([[6]]);
    // Oznaczenie komercyjne MUSI być w selekcie - inaczej karta na stronie
    // programu pokazałaby materiał sponsorowany bez ujawnienia.
    expect(String(c.argsOf("select")?.[0])).toContain(SPONSORED_LIST_COLS);
  });

  it("PUSTO: pivot wskazuje wpisy, ale baza nie oddaje wierszy - pusta lista, nie awaria", async () => {
    // Stan realny: wpisy z kategorii zostały w międzyczasie odpublikowane albo
    // ukryte przez RLS. Lista musi być pusta, a nie `undefined.map()`.
    planuj({
      program: ok(wierszProgramu({ category_id: ID_KATEGORII })),
      pivot: ok([{ post_id: "w-1" }]),
      wpisy: ok(null),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.latestPublications).toEqual([]);
  });

  it("ODMOWA odczytu pivotu kategorii rzuca", async () => {
    planuj({
      program: ok(wierszProgramu({ category_id: ID_KATEGORII })),
      pivot: fail("odmowa pivotu", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa pivotu",
    );
  });

  it("ODMOWA odczytu publikacji rzuca, zamiast pokazać program bez dorobku", async () => {
    planuj({
      program: ok(wierszProgramu({ category_id: ID_KATEGORII })),
      pivot: ok([{ post_id: "w-1" }]),
      wpisy: fail("odmowa wpisów", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa wpisów",
    );
  });
});

// ==========================================================================
// KURACJA - typ pozycji, osierocone id i kolejność kuratora
// ==========================================================================

describe("kuracja programu: co wchodzi na listę i w jakiej kolejności", () => {
  it("kolejność KURATORA wygrywa z kolejnością bazy dla raportów flagowych", async () => {
    planuj({
      pozycje: ok([
        pozycja("flagship_post", "post_id", "w-1", 0),
        pozycja("flagship_post", "post_id", "w-2", 1),
        pozycja("flagship_post", "post_id", "w-3", 2),
      ]),
      // Baza oddaje wiersze W ODWROTNEJ kolejności - `WHERE id IN (...)` nie
      // gwarantuje żadnej. Bez `orderByIds` kurator traciłby kontrolę nad tym,
      // co jest pierwszym raportem na stronie programu.
      wpisy: ok([wierszWpisu("w-3"), wierszWpisu("w-1"), wierszWpisu("w-2")]),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.flagshipReports.map((r) => r.id)).toEqual(["w-1", "w-2", "w-3"]);
    // Raporty flagowe NIE są ograniczane limitem ani sortowane datą - to
    // odróżnia je od automatycznych publikacji.
    expect(ogniwa(lancuch("posts"), "limit")).toEqual([]);
    expect(ogniwa(lancuch("posts"), "order")).toEqual([]);
  });

  it("pozycja właściwego typu, ale z pustym id, NIE wchodzi do zapytania", async () => {
    // Osierocony wiersz kuracji po usunięciu treści. `.in("id", [null])`
    // oddałby błąd albo cudze wiersze.
    planuj({
      pozycje: ok([
        pozycja("flagship_post", "post_id", null),
        pozycja("podcast", "podcast_id", null),
        pozycja("event", "event_id", null),
      ]),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.flagshipReports).toEqual([]);
    expect(ladowanie.podcasts).toEqual([]);
    expect(ladowanie.events).toEqual([]);
    expect(baza().chainsFor("posts")).toHaveLength(0);
    expect(baza().chainsFor("podcasts")).toHaveLength(0);
    expect(baza().chainsFor("events")).toHaveLength(0);
  });

  it("nieznany typ pozycji jest ignorowany, a nie wrzucany do byle listy", async () => {
    planuj({ pozycje: ok([pozycja("newsletter", "post_id", "w-1")]) });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.flagshipReports).toEqual([]);
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("podcasty: tylko opublikowane i nieusunięte, w kolejności kuratora", async () => {
    planuj({
      pozycje: ok([
        pozycja("podcast", "podcast_id", "p-1", 0),
        pozycja("podcast", "podcast_id", "p-2", 1),
      ]),
      podcasty: ok([{ id: "p-2" }, { id: "p-1" }]),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.podcasts.map((p) => p.id)).toEqual(["p-1", "p-2"]);
    const c = lancuch("podcasts");
    expect(c.argsOf("in")).toEqual(["id", ["p-1", "p-2"]]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
  });

  it("wydarzenia: filtr statusu BEZ filtra usunięcia - taki jest kontrakt tabeli", async () => {
    planuj({
      pozycje: ok([pozycja("event", "event_id", "e-1", 0), pozycja("event", "event_id", "e-2", 1)]),
      wydarzenia: ok([{ id: "e-2" }, { id: "e-1" }]),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.events.map((e) => e.id)).toEqual(["e-1", "e-2"]);
    const c = lancuch("events");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    // Świadoma różnica wobec wpisów i podcastów - `events` nie ma `deleted_at`.
    expect(ogniwa(c, "is")).toEqual([]);
  });

  it("ODMOWA odczytu raportów flagowych rzuca", async () => {
    planuj({
      pozycje: ok([pozycja("flagship_post", "post_id", "w-1")]),
      wpisy: fail("odmowa raportów", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa raportów",
    );
  });

  it("ODMOWA odczytu podcastów rzuca", async () => {
    planuj({
      pozycje: ok([pozycja("podcast", "podcast_id", "p-1")]),
      podcasty: fail("odmowa podcastów", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa podcastów",
    );
  });

  it("ODMOWA odczytu wydarzeń rzuca", async () => {
    planuj({
      pozycje: ok([pozycja("event", "event_id", "e-1")]),
      wydarzenia: fail("odmowa wydarzeń", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow(
      "odmowa wydarzeń",
    );
  });

  it("PUSTO: brak wierszy podcastów (null) to pusta lista, nie awaria", async () => {
    planuj({
      pozycje: ok([pozycja("podcast", "podcast_id", "p-1")]),
      podcasty: ok(null),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.podcasts).toEqual([]);
  });

  it("PUSTO: brak wierszy wydarzeń (null) to pusta lista, nie awaria", async () => {
    planuj({
      pozycje: ok([pozycja("event", "event_id", "e-1")]),
      wydarzenia: ok(null),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.events).toEqual([]);
  });

  it("PUSTO: brak wierszy raportów flagowych (null) to pusta lista, nie awaria", async () => {
    planuj({
      pozycje: ok([pozycja("flagship_post", "post_id", "w-1")]),
      wpisy: ok(null),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.flagshipReports).toEqual([]);
  });
});

// ==========================================================================
// ADRESY WPISÓW - jedyne połknięcie w tym module
// ==========================================================================

describe("adresy wpisów programu: jedno zapytanie na RODZICA, nie na wpis", () => {
  it("wpisy o wspólnym rodzicu płacą JEDNO wywołanie rezolucji ścieżki", async () => {
    planuj({
      pozycje: ok([
        pozycja("flagship_post", "post_id", "w-1", 0),
        pozycja("flagship_post", "post_id", "w-2", 1),
      ]),
      wpisy: ok([
        wierszWpisu("w-1", { parent_page_id: "str-a" }),
        wierszWpisu("w-2", { parent_page_id: "str-a" }),
      ]),
      sciezka: ok("programy/bezpieczenstwo"),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    // Deduplikacja po rodzicu - inaczej lista 20 wpisów jednego działu byłaby
    // 20 round-tripami po tę samą ścieżkę.
    expect(funkcje().callsFor("page_full_path")).toHaveLength(1);
    expect(wywolanie("page_full_path").keys()).toEqual(["_page_id"]);
    expect(wywolanie("page_full_path").arg("_page_id")).toBe("str-a");
    expect(ladowanie.flagshipReports.map((r) => r.href)).toEqual([
      "/programy/bezpieczenstwo/slug-w-1",
      "/programy/bezpieczenstwo/slug-w-2",
    ]);
  });

  it("różni rodzice to różne wywołania i różne prefiksy adresu", async () => {
    planuj({
      pozycje: ok([
        pozycja("flagship_post", "post_id", "w-1", 0),
        pozycja("flagship_post", "post_id", "w-2", 1),
      ]),
      wpisy: ok([
        wierszWpisu("w-1", { parent_page_id: "str-a" }),
        wierszWpisu("w-2", { parent_page_id: "str-b" }),
      ]),
      sciezka: (call) => ok(call.arg("_page_id") === "str-a" ? "analizy" : "raporty"),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(funkcje().callsFor("page_full_path")).toHaveLength(2);
    expect(ladowanie.flagshipReports.map((r) => r.href)).toEqual([
      "/analizy/slug-w-1",
      "/raporty/slug-w-2",
    ]);
  });

  it("brak wpisów wcale nie woła rezolucji ścieżek", async () => {
    planuj({
      pozycje: ok([pozycja("flagship_post", "post_id", "w-1")]),
      wpisy: ok([]),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.flagshipReports).toEqual([]);
    expect(funkcje().callsFor("page_full_path")).toHaveLength(0);
  });

  it("STAN FAKTYCZNY: odpowiedź nie-tekstowa daje adres z prefiksem „blog”", async () => {
    planuj({
      pozycje: ok([pozycja("flagship_post", "post_id", "w-1")]),
      wpisy: ok([wierszWpisu("w-1")]),
      sciezka: ok(null),
    });
    const ladowanie = jakoLadowanie(await klient().fetchQuery(programBySlugQueryOptions(SLUG)));
    expect(ladowanie.flagshipReports[0].href).toBe("/blog/slug-w-1");
  });

  it("błąd odczytu jest zgłaszany: odmowa page_full_path", async () => {
    planuj({
      pozycje: ok([pozycja("flagship_post", "post_id", "w-1")]),
      wpisy: ok([wierszWpisu("w-1")]),
      sciezka: fail("odmowa page_full_path", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toMatchObject({
      message: "odmowa page_full_path",
    });
  });

  it("AWARIA rezolucji ścieżek POWINNA być odróżnialna od rodzica o ścieżce „blog”", async () => {
    planuj({
      pozycje: ok([pozycja("flagship_post", "post_id", "w-1")]),
      wpisy: ok([wierszWpisu("w-1")]),
      sciezka: fail("odmowa page_full_path", "42501"),
    });
    await expect(klient().fetchQuery(programBySlugQueryOptions(SLUG))).rejects.toThrow();
  });
});
