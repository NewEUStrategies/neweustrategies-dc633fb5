// Hub eksperta: wybór ścieżki (RPC vs legacy), rezolucja profilu i cache SSR.
//
// To najcięższa publiczna trasa w module (`/author/$slug`) i największy plik
// warstwy danych hubów - 276 linii, z czego audyt 18.08 widział wykonane 9%.
//
// TRZY REGUŁY, KTÓRYCH ZŁAMANIE WIDAĆ DOPIERO NA PRODUKCJI:
//   1. „RPC niedostępne" i „eksperta nie ma" to DWA RÓŻNE wyniki. Zlanie ich
//      w jeden daje 404 dla istniejącego eksperta przy chwilowej awarii RPC -
//      czyli znikającą stronę publiczną z poprawnym kodem odpowiedzi.
//   2. Błąd odczytu profilu MUSI lecieć dalej, a nie zamieniać się w null.
//      Null to dla trasy „nie ma takiego eksperta" i renderuje 404, które
//      crawler zapamięta.
//   3. Ścieżka legacy nie może wystartować, gdy RPC odpowiedziało - to pełny
//      fan-out kilkunastu zapytań na najcięższej trasie serwisu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: makeStub } = await import("@/test/supabaseChain");
  const from = makeStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      rpc: (fn: string) =>
        Promise.resolve(h.rpcResults[fn] ?? { data: null, error: { message: "brak funkcji" } }),
    },
  };
});

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const { expertHubQueryOptions, fetchExpertHubCached } = await import("@/lib/experts/queries");

const ANNA = "11111111-1111-4111-8111-111111111111";

const PROFILE = {
  id: ANNA,
  tenant_id: "t1",
  slug: "anna-kowalska",
  display_name: "Anna Kowalska",
  avatar_url: null,
  cover_url: null,
  bio_pl: "Bio",
  bio_en: "Bio",
  twitter_url: null,
  linkedin_url: null,
  website_url: null,
  verified_at: null,
  updated_at: "2026-08-01T00:00:00Z",
  expert_requests_enabled: true,
};

/** Wszystkie tabele ścieżki legacy - domyślnie puste, nadpisywane per test. */
function planLegacy(plan: Partial<Record<string, SupabaseResult>> = {}) {
  const empty = ok([]);
  const defaults: Record<string, SupabaseResult> = {
    profiles_public: ok(null),
    author_profiles_public: ok(null),
    profile_badges: empty,
    program_members: empty,
    expert_expertise_areas: empty,
    media_mentions: empty,
    post_authors: empty,
    event_speakers: empty,
    posts: empty,
    podcasts: empty,
    events: empty,
    programs: empty,
    regions: empty,
    categories: empty,
    tags: empty,
    post_categories: empty,
    post_programs: empty,
    post_regions: empty,
    post_tags: empty,
  };
  for (const [table, result] of Object.entries({ ...defaults, ...plan })) {
    db().setResponse(table, result!);
  }
}

beforeEach(() => {
  db().reset();
  h.rpcResults = {};
  clearEdgeTtlCache();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("wybór ścieżki odczytu huba", () => {
  it("odpowiedź RPC kończy sprawę - ścieżka legacy NIE startuje", async () => {
    // Legacy to kilkanaście zapytań na najcięższej publicznej trasie. Jeśli
    // RPC odpowiedziało, żadne z nich nie ma prawa polecieć.
    h.rpcResults.get_expert_hub = {
      data: { profile: { id: ANNA, slug: "anna-kowalska", display_name: "Anna Kowalska" } },
      error: null,
    };
    planLegacy();
    const hub = await fetchExpertHubCached("anna-kowalska");
    expect(hub).not.toBeNull();
    expect(db().chainsFor("profiles_public")).toHaveLength(0);
    expect(db().chainsFor("posts")).toHaveLength(0);
  });

  it("RPC „nie znaleziono” daje null BEZ schodzenia na legacy", async () => {
    h.rpcResults.get_expert_hub = { data: { profile: null }, error: null };
    planLegacy({ profiles_public: ok(PROFILE) });
    await expect(fetchExpertHubCached("anna-kowalska")).resolves.toBeNull();
    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("RPC niedostępne SCHODZI na ścieżkę legacy", async () => {
    // Okno między deployem kodu a wdrożeniem migracji RPC. Bez tego fallbacku
    // wszystkie huby ekspertów znikają na czas wdrożenia.
    h.rpcResults.get_expert_hub = { data: null, error: { message: "brak funkcji" } };
    planLegacy({ profiles_public: ok(PROFILE) });
    const hub = await fetchExpertHubCached("anna-kowalska");
    expect(hub?.expert).toBeTruthy();
    expect(db().chainsFor("profiles_public").length).toBeGreaterThan(0);
  });
});

describe("ścieżka legacy - rezolucja profilu", () => {
  beforeEach(() => {
    h.rpcResults.get_expert_hub = { data: null, error: { message: "brak funkcji" } };
  });

  it("szuka profilu po slugu", async () => {
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    expect(db().chainsFor("profiles_public")[0]?.argsOf("eq")).toEqual(["slug", "anna-kowalska"]);
  });

  it("dla UUID próbuje jeszcze po identyfikatorze, gdy slug nie trafił", async () => {
    let call = 0;
    db().setResponse("profiles_public", () => {
      call += 1;
      return call === 1 ? ok(null) : ok(PROFILE);
    });
    planLegacy({ profiles_public: undefined });
    db().setResponse("profiles_public", () => {
      call += 1;
      return call === 1 ? ok(null) : ok(PROFILE);
    });
    call = 0;
    const hub = await fetchExpertHubCached(ANNA);
    expect(hub?.expert).toBeTruthy();
    const chains = db().chainsFor("profiles_public");
    expect(chains).toHaveLength(2);
    expect(chains[1]?.argsOf("eq")).toEqual(["id", ANNA]);
  });

  it("dla NIE-UUID nie ma drugiego podejścia - jedno zapytanie i null", async () => {
    // Bez tego warunku każdy nieistniejący slug kosztowałby dwa zapytania.
    planLegacy({ profiles_public: ok(null) });
    await expect(fetchExpertHubCached("nie-ma-takiego")).resolves.toBeNull();
    expect(db().chainsFor("profiles_public")).toHaveLength(1);
  });

  it("BŁĄD odczytu profilu leci dalej, zamiast udawać brak eksperta", async () => {
    // Null oznacza dla trasy 404, które crawler zapamięta. Awaria bazy nie
    // może wyglądać jak usunięty ekspert.
    planLegacy({ profiles_public: fail("boom") });
    await expect(fetchExpertHubCached("anna-kowalska")).rejects.toMatchObject({ message: "boom" });
  });

  it("błąd DRUGIEGO podejścia (po id) też leci dalej", async () => {
    let call = 0;
    planLegacy();
    db().setResponse("profiles_public", () => {
      call += 1;
      return call === 1 ? ok(null) : fail("boom po id");
    });
    await expect(fetchExpertHubCached(ANNA)).rejects.toMatchObject({ message: "boom po id" });
  });
});

describe("ścieżka legacy - składanie huba", () => {
  beforeEach(() => {
    h.rpcResults.get_expert_hub = { data: null, error: { message: "brak funkcji" } };
  });

  it("czyta nakładkę autorską dla rozwiązanego eksperta", async () => {
    planLegacy({
      profiles_public: ok(PROFILE),
      author_profiles_public: ok({ job_title: "Analityczka", company: "NES", is_public: true }),
    });
    const hub = await fetchExpertHubCached("anna-kowalska");
    expect(hub?.expert).toMatchObject({ job_title: "Analityczka", company: "NES" });
    expect(db().lastChain("author_profiles_public")?.argsOf("eq")).toEqual(["user_id", ANNA]);
  });

  it("brak nakładki NIE wywraca huba - degraduje się do danych z profilu", async () => {
    // Nakładka jest best-effort: gdy widok nic nie odda, strona ma się
    // wyrenderować, a nie zwrócić 500.
    planLegacy({ profiles_public: ok(PROFILE), author_profiles_public: ok(null) });
    const hub = await fetchExpertHubCached("anna-kowalska");
    expect(hub?.expert.display_name).toBe("Anna Kowalska");
  });

  it("odznaka `expert` decyduje o statusie eksperta", async () => {
    planLegacy({
      profiles_public: ok(PROFILE),
      profile_badges: ok([{ badge: "expert" }, { badge: "verified" }]),
    });
    expect((await fetchExpertHubCached("anna-kowalska"))?.expert.is_expert).toBe(true);
  });

  it("bez odznaki `expert` profil nie jest ekspertem, mimo innych odznak", async () => {
    planLegacy({ profiles_public: ok(PROFILE), profile_badges: ok([{ badge: "verified" }]) });
    expect((await fetchExpertHubCached("anna-kowalska"))?.expert.is_expert).toBe(false);
  });

  it("obecność medialna jest zawężona do wpisów PUBLICZNYCH", async () => {
    // Wzmianki nieopublikowane to notatki redakcyjne - nie mogą trafić na
    // stronę eksperta.
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    const filters = (db().lastChain("media_mentions")?.calls ?? [])
      .filter((c) => c.method === "eq")
      .map((c) => [...c.args]);
    expect(filters).toContainEqual(["is_public", true]);
  });

  it("obecność medialna jest sortowana od najnowszej", async () => {
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    expect(db().lastChain("media_mentions")?.argsOf("order")).toEqual([
      "published_on",
      { ascending: false },
    ]);
  });

  it("programy i obszary są czytane w kolejności redakcyjnej", async () => {
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    expect(db().lastChain("program_members")?.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
    expect(db().lastChain("expert_expertise_areas")?.argsOf("order")).toEqual([
      "sort_order",
      { ascending: true },
    ]);
  });

  it("ekspert bez materiałów dostaje PUSTE fasety, a nie pełną taksonomię", async () => {
    // Fasety pokazują tylko filtry, które coś zwrócą - inaczej użytkownik
    // klika filtr i dostaje pustą listę.
    planLegacy({
      profiles_public: ok(PROFILE),
      programs: ok([
        { id: "p1", slug: "klimat", name_pl: "Klimat", name_en: "Climate", kind: "research" },
      ]),
      regions: ok([{ id: "r1", slug: "ue", name_pl: "UE", name_en: "EU" }]),
      categories: ok([{ id: "c1", slug: "analizy", name_pl: "Analizy", name_en: "Analyses" }]),
      tags: ok([{ id: "t1", slug: "energia", name: "energia" }]),
    });
    const hub = await fetchExpertHubCached("anna-kowalska");
    expect(hub?.materials).toEqual([]);
    expect(hub?.facets.programs).toEqual([]);
    expect(hub?.facets.regions).toEqual([]);
  });

  it("materiały główne są czytane po identyfikatorze eksperta", async () => {
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    expect(db().chainsFor("post_authors")[0]?.argsOf("eq")).toEqual(["user_id", ANNA]);
    expect(db().chainsFor("event_speakers")[0]?.argsOf("eq")).toEqual(["user_id", ANNA]);
  });

  it("współautorstwa i wystąpienia idą DRUGĄ falą, po identyfikatorach z pierwszej", async () => {
    // Pivot `post_authors` niesie same identyfikatory, więc rekordy trzeba
    // dobrać osobno. Gdyby druga fala nie ruszała, hub gubiłby wszystko, przy
    // czym ekspert jest współautorem - a to często najważniejsze publikacje
    // (raporty zespołowe), nie te podpisane solo.
    planLegacy({ profiles_public: ok(PROFILE) });
    // Odpowiedzi ustawiamy PO `planLegacy` - ostatnie ustawienie wygrywa, a
    // plan domyślny odpowiada pustką na wszystkie tabele ścieżki legacy.
    db().setResponse("post_authors", ok([{ post_id: "post-wspolny" }]));
    db().setResponse("event_speakers", ok([{ event_id: "event-wystapienie" }]));
    db().setResponse("posts", (chain) =>
      chain.has("in")
        ? ok([
            {
              id: "post-wspolny",
              slug: "raport-zespolowy",
              title_pl: "Raport zespołowy",
              title_en: "Team report",
              post_format: "article",
              published_at: "2026-06-01T00:00:00Z",
            },
          ])
        : ok([
            {
              id: "post-solo",
              slug: "analiza",
              title_pl: "Analiza",
              title_en: "Analysis",
              post_format: "article",
              published_at: "2026-07-01T00:00:00Z",
            },
          ]),
    );
    db().setResponse("events", (chain) =>
      chain.has("in")
        ? ok([
            {
              id: "event-wystapienie",
              slug: "szczyt",
              title_pl: "Szczyt",
              title_en: "Summit",
              starts_at: "2026-09-01T00:00:00Z",
            },
          ])
        : ok([]),
    );

    const hub = await fetchExpertHubCached("anna-kowalska");

    const secondWavePosts = db()
      .chainsFor("posts")
      .find((c) => c.has("in"));
    expect(secondWavePosts?.argsOf("in")).toEqual(["id", ["post-wspolny"]]);
    const secondWaveEvents = db()
      .chainsFor("events")
      .find((c) => c.has("in"));
    expect(secondWaveEvents?.argsOf("in")).toEqual(["id", ["event-wystapienie"]]);

    const ids = hub?.materials.map((m) => m.id) ?? [];
    expect(ids).toContain("post-solo");
    expect(ids).toContain("post-wspolny");
    expect(hub?.materials.find((m) => m.id === "post-wspolny")?.isCoauthor).toBe(true);
    expect(hub?.materials.find((m) => m.id === "post-solo")?.isCoauthor).toBe(false);
  });

  it("mając publikacje, PYTA o taksonomie po pełnym zbiorze identyfikatorów", async () => {
    planLegacy({
      profiles_public: ok(PROFILE),
      posts: ok([{ id: "post-solo", slug: "a", post_format: "article" }]),
    });
    await fetchExpertHubCached("anna-kowalska");
    expect(db().chainsFor("post_categories")[0]?.argsOf("in")).toEqual(["post_id", ["post-solo"]]);
  });

  it("bez ani jednej publikacji NIE pyta o taksonomie postów", async () => {
    // Cztery zapytania `in (...)` z pustą listą nic by nie zwróciły, a
    // kosztowałyby round-trip każde.
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    expect(db().chainsFor("post_categories")).toHaveLength(0);
    expect(db().chainsFor("post_tags")).toHaveLength(0);
  });
});

describe("cache huba", () => {
  it("na KLIENCIE nie ma współdzielonego cache - każde wywołanie czyta na nowo", async () => {
    // `edgeTtlCache` wychodzi natychmiast, gdy `window` istnieje: cache SSR
    // jest per-izolat serwera i współdzielenie go w przeglądarce oznaczałoby
    // pokazanie jednemu użytkownikowi danych rozgrzanych dla innego. Za
    // buforowanie po stronie klienta odpowiada react-query (klucz niżej).
    // Ten test przypina właśnie to rozgraniczenie - w happy-dom `window`
    // istnieje, więc mierzymy zachowanie KLIENCKIE.
    h.rpcResults.get_expert_hub = { data: null, error: { message: "brak funkcji" } };
    planLegacy({ profiles_public: ok(PROFILE) });
    await fetchExpertHubCached("anna-kowalska");
    const afterFirst = db().chains.length;
    await fetchExpertHubCached("anna-kowalska");
    expect(db().chains.length).toBeGreaterThan(afterFirst);
  });
});

describe("expertHubQueryOptions", () => {
  it("klucz niesie slug, żeby loader SSR i hook trafiły w ten sam wpis", () => {
    expect(expertHubQueryOptions("anna-kowalska").queryKey).toEqual([
      "public",
      "expert",
      "anna-kowalska",
    ]);
  });

  it("funkcja zapytania oddaje hub przez wspólny cache", async () => {
    h.rpcResults.get_expert_hub = {
      data: { profile: { id: ANNA, slug: "anna-kowalska", display_name: "Anna Kowalska" } },
      error: null,
    };
    planLegacy();
    const hub = await expertHubQueryOptions("anna-kowalska").queryFn!({} as never);
    expect(hub?.expert.display_name).toBe("Anna Kowalska");
  });
});
