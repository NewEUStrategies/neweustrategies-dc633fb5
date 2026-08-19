// Warstwa danych hubów ekspertów: katalog publiczny, baza wewnętrzna,
// hydratacja profilu i odczyt huba przez RPC.
//
// DLACZEGO TE CZTERY PLIKI. Audyt 18.08 policzył huby ekspertów na 808 linii
// przy 11 z 23 plików na zerze. Testy miała już warstwa REGUŁ (`filter`,
// `normalize`, `publicVisibility`, `materials*`), ale nie miała ich warstwa,
// która te reguły karmi - a to ona decyduje, KOGO widać na `/experts`.
//
// NAJWAŻNIEJSZA REGUŁA: publiczny katalog pokazuje wyłącznie osoby z profilem
// autorskim oznaczonym `is_public = true`. Odznaka „expert" NIE wystarcza.
// Złamanie tego wyprowadza na stronę publiczną stanowisko i firmę osoby, która
// świadomie nie opublikowała swojego profilu - dlatego ma tu dedykowane
// asercje, a nie tylko przypadek szczęśliwy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseResult } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  rpcCalls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
}));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub: makeStub } = await import("@/test/supabaseChain");
  const from = makeStub();
  stubs.from = from;
  return {
    supabase: {
      from: from.from,
      // RPC w tej warstwie jest używane DWOMA sposobami: przez `await` oraz
      // przez `.maybeSingle()` (wrapper `adminGetAuthorProfile`). Atrapa musi
      // umieć oba, inaczej test milczkiem omija jedną ze ścieżek.
      rpc: (fn: string, args?: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        const result = h.rpcResults[fn] ?? { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          maybeSingle: () => Promise.resolve(result),
        });
      },
    },
  };
});

const db = () => stubs.from as ReturnType<typeof supabaseFromStub>;

const { EXPERTS_DIRECTORY_EMPTY, expertsDirectoryQueryOptions } =
  await import("@/lib/experts/directory");
const { filterInternalExperts, internalExpertBaseQueryOptions } =
  await import("@/lib/experts/internalBase");
const { fetchExpertHydration } = await import("@/lib/experts/hydration");
const { fetchExpertHubFromRpc } = await import("@/lib/experts/rpcHub");

const ANNA = "11111111-1111-4111-8111-111111111111";
const BOGDAN = "22222222-2222-4222-8222-222222222222";

/** Zaplanuj odpowiedzi wszystkich tabel katalogu naraz. */
function planDirectory(plan: Partial<Record<string, SupabaseResult>>) {
  const defaults: Record<string, SupabaseResult> = {
    profile_badges: ok([]),
    profiles_public: ok([]),
    author_profiles_public: ok([]),
    expert_expertise_areas: ok([]),
    program_members: ok([]),
    posts: ok([]),
  };
  for (const [table, result] of Object.entries({ ...defaults, ...plan })) {
    db().setResponse(table, result!);
  }
}

beforeEach(() => {
  db().reset();
  h.rpcResults = {};
  h.rpcCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Katalog publiczny /experts
// ---------------------------------------------------------------------------

describe("expertsDirectoryQueryOptions", () => {
  const run = () => expertsDirectoryQueryOptions().queryFn!({} as never);

  it("ma stabilny klucz zapytania", () => {
    expect(expertsDirectoryQueryOptions().queryKey).toEqual(["public", "experts-directory"]);
  });

  it("brak ekspertów kończy pracę BEZ dalszych zapytań", async () => {
    // Budżet ścieżki krytycznej: pusty katalog nie ma powodu odpytywać
    // pięciu kolejnych tabel.
    planDirectory({ profile_badges: ok([]) });
    await expect(run()).resolves.toEqual({ experts: [], facets: { areas: [], programs: [] } });
    expect(db().chainsFor("profiles_public")).toHaveLength(0);
  });

  it("filtruje odznaki po `expert`", async () => {
    planDirectory({});
    await run();
    expect(db().lastChain("profile_badges")?.argsOf("eq")).toEqual(["badge", "expert"]);
  });

  it("błąd odczytu odznak leci dalej", async () => {
    planDirectory({ profile_badges: fail("boom") });
    await expect(run()).rejects.toMatchObject({ message: "boom" });
  });

  it("PRYWATNOŚĆ: ekspert BEZ publicznego profilu autorskiego nie trafia do katalogu", async () => {
    // Odznaka „expert" nie wystarcza. Bez tego warunku na stronę publiczną
    // wyszłoby stanowisko i firma osoby, która świadomie nie opublikowała
    // swojego profilu.
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([{ id: ANNA, slug: "anna", display_name: "Anna", verified_at: null }]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: "Analityczka", company: "NES", is_public: false },
      ]),
    });
    await expect(run()).resolves.toMatchObject({ experts: [] });
  });

  it("PRYWATNOŚĆ: brak wiersza profilu autorskiego też wyklucza z katalogu", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([{ id: ANNA, slug: "anna", display_name: "Anna", verified_at: null }]),
      author_profiles_public: ok([]),
    });
    await expect(run()).resolves.toMatchObject({ experts: [] });
  });

  it("ekspert z publicznym profilem dostaje stanowisko i firmę", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([
        { id: ANNA, slug: "anna", display_name: "Anna", avatar_url: "a.png", verified_at: "2026" },
      ]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: "Analityczka", company: "NES", is_public: true },
      ]),
    });
    const { experts } = await run();
    expect(experts).toHaveLength(1);
    expect(experts[0]).toMatchObject({
      id: ANNA,
      slug: "anna",
      display_name: "Anna",
      job_title: "Analityczka",
      company: "NES",
      verified_at: "2026",
      postCount: 0,
    });
  });

  it("sortuje ekspertów alfabetycznie, ignorując wielkość liter i znaki diakrytyczne", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }, { user_id: BOGDAN }]),
      profiles_public: ok([
        { id: BOGDAN, slug: "b", display_name: "Żaneta", verified_at: null },
        { id: ANNA, slug: "a", display_name: "anna", verified_at: null },
      ]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
        { user_id: BOGDAN, job_title: null, company: null, is_public: true },
      ]),
    });
    const { experts } = await run();
    expect(experts.map((e) => e.display_name)).toEqual(["anna", "Żaneta"]);
  });

  it("przypisuje obszary i programy właściwym osobom", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }, { user_id: BOGDAN }]),
      profiles_public: ok([
        { id: ANNA, slug: "a", display_name: "Anna", verified_at: null },
        { id: BOGDAN, slug: "b", display_name: "Bogdan", verified_at: null },
      ]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
        { user_id: BOGDAN, job_title: null, company: null, is_public: true },
      ]),
      expert_expertise_areas: ok([
        {
          user_id: ANNA,
          sort_order: 1,
          area: { id: "ar1", slug: "energia", name_pl: "Energia", name_en: "Energy" },
        },
      ]),
      program_members: ok([
        {
          user_id: BOGDAN,
          sort_order: 1,
          program: { id: "p1", name_pl: "Klimat", name_en: "Climate" },
        },
      ]),
    });
    const { experts } = await run();
    const anna = experts.find((e) => e.id === ANNA)!;
    const bogdan = experts.find((e) => e.id === BOGDAN)!;
    expect(anna.areas.map((a) => a.slug)).toEqual(["energia"]);
    expect(anna.programs).toEqual([]);
    expect(bogdan.programs.map((p) => p.name_pl)).toEqual(["Klimat"]);
  });

  it("powiązanie bez osadzonego obszaru albo programu jest pomijane", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([{ id: ANNA, slug: "a", display_name: "Anna", verified_at: null }]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
      ]),
      expert_expertise_areas: ok([{ user_id: ANNA, sort_order: 1, area: null }]),
      program_members: ok([{ user_id: ANNA, sort_order: 1, program: null }]),
    });
    const { experts } = await run();
    expect(experts[0]?.areas).toEqual([]);
    expect(experts[0]?.programs).toEqual([]);
  });

  it("liczy publikacje per autor i pomija wiersze bez autora", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([{ id: ANNA, slug: "a", display_name: "Anna", verified_at: null }]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
      ]),
      posts: ok([{ author_id: ANNA }, { author_id: ANNA }, { author_id: null }]),
    });
    expect((await run()).experts[0]?.postCount).toBe(2);
  });

  it("liczy WYŁĄCZNIE publikacje opublikowane i nieusunięte", async () => {
    planDirectory({ profile_badges: ok([{ user_id: ANNA }]) });
    await run();
    const chain = db().lastChain("posts");
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("fasety zawierają tylko wartości WIDOCZNYCH ekspertów", async () => {
    // Ekspert niepubliczny nie może wnieść swojego obszaru do listy filtrów -
    // pusty filtr zdradzałby, że ktoś taki istnieje.
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }, { user_id: BOGDAN }]),
      profiles_public: ok([
        { id: ANNA, slug: "a", display_name: "Anna", verified_at: null },
        { id: BOGDAN, slug: "b", display_name: "Bogdan", verified_at: null },
      ]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
        { user_id: BOGDAN, job_title: null, company: null, is_public: false },
      ]),
      expert_expertise_areas: ok([
        {
          user_id: ANNA,
          sort_order: 1,
          area: { id: "ar1", slug: "energia", name_pl: "Energia", name_en: "Energy" },
        },
        {
          user_id: BOGDAN,
          sort_order: 1,
          area: { id: "ar2", slug: "obrona", name_pl: "Obrona", name_en: "Defence" },
        },
      ]),
    });
    const { facets } = await run();
    expect(facets.areas.map((a) => a.slug)).toEqual(["energia"]);
  });

  it("fasety są posortowane i bez duplikatów", async () => {
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }, { user_id: ANNA }]),
      profiles_public: ok([{ id: ANNA, slug: "a", display_name: "Anna", verified_at: null }]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
      ]),
      expert_expertise_areas: ok([
        {
          user_id: ANNA,
          sort_order: 2,
          area: { id: "ar2", slug: "obrona", name_pl: "Obrona", name_en: "Defence" },
        },
        {
          user_id: ANNA,
          sort_order: 1,
          area: { id: "ar1", slug: "energia", name_pl: "Energia", name_en: "Energy" },
        },
        {
          user_id: ANNA,
          sort_order: 3,
          area: { id: "ar1", slug: "energia", name_pl: "Energia", name_en: "Energy" },
        },
      ]),
    });
    const { facets } = await run();
    expect(facets.areas.map((a) => a.name_pl)).toEqual(["Energia", "Obrona"]);
  });

  it("fasety PROGRAMÓW też są odduplikowane i sortowane alfabetycznie", async () => {
    // Fasety obszarów i programów budują się dwiema bliźniaczymi pętlami;
    // łatwo poprawić jedną i zapomnieć o drugiej. Wtedy panel filtrów pokazuje
    // program dwa razy albo w kolejności przypadkowej (czyli w kolejności
    // wierszy z bazy, która zależy od `sort_order` członkostwa, nie od nazwy).
    planDirectory({
      profile_badges: ok([{ user_id: ANNA }, { user_id: BOGDAN }]),
      profiles_public: ok([
        { id: ANNA, slug: "anna", display_name: "Anna" },
        { id: BOGDAN, slug: "bogdan", display_name: "Bogdan" },
      ]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: null, company: null, is_public: true },
        { user_id: BOGDAN, job_title: null, company: null, is_public: true },
      ]),
      program_members: ok([
        { user_id: ANNA, sort_order: 1, program: { id: "p2", name_pl: "Obronność", name_en: "B" } },
        { user_id: BOGDAN, sort_order: 2, program: { id: "p1", name_pl: "Klimat", name_en: "A" } },
        { user_id: ANNA, sort_order: 3, program: { id: "p1", name_pl: "Klimat", name_en: "A" } },
      ]),
    });
    const { facets } = await run();
    expect(facets.programs.map((p) => p.name_pl)).toEqual(["Klimat", "Obronność"]);
  });

  it("błąd profili albo profili autorskich leci dalej", async () => {
    planDirectory({ profile_badges: ok([{ user_id: ANNA }]), profiles_public: fail("profile") });
    await expect(run()).rejects.toMatchObject({ message: "profile" });
  });

  it("pusty katalog jest ZAMROŻONY - nie da się go przypadkiem zmutować", async () => {
    // Wspólna stała trafia do wielu konsumentów; mutacja u jednego zmieniłaby
    // stan pusty u wszystkich.
    expect(Object.isFrozen(EXPERTS_DIRECTORY_EMPTY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Baza wewnętrzna (panel)
// ---------------------------------------------------------------------------

describe("internalExpertBaseQueryOptions", () => {
  const run = () => internalExpertBaseQueryOptions().queryFn!({} as never);

  function planBase(plan: Partial<Record<string, SupabaseResult>> = {}) {
    const defaults: Record<string, SupabaseResult> = {
      profile_badges: ok([]),
      author_profiles_public: ok([]),
      author_profiles: ok([]),
      profiles_public: ok([]),
    };
    for (const [table, result] of Object.entries({ ...defaults, ...plan })) {
      db().setResponse(table, result!);
    }
  }

  it("ma stabilny klucz zapytania", () => {
    expect(internalExpertBaseQueryOptions().queryKey).toEqual(["admin", "internal-expert-base"]);
  });

  it("z uprawnieniami admina buduje listę z RPC i liczy podsumowania", async () => {
    planBase({
      profile_badges: ok([{ user_id: ANNA }]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: "Analityczka", company: "NES", is_public: true },
      ]),
    });
    h.rpcResults.admin_list_users = {
      data: [
        { id: ANNA, slug: "anna", display_name: "Anna", avatar_url: null, roles: [] },
        { id: BOGDAN, slug: "b", display_name: "Bogdan", avatar_url: null, roles: ["reader"] },
      ],
      error: null,
    };
    const base = await run();
    expect(base.restricted).toBe(false);
    expect(base.entries.map((e) => e.name)).toEqual(["Anna"]);
    expect(base).toMatchObject({ total: 1, expertCount: 1, publicCount: 1 });
  });

  it("wiersz z tabeli bazowej NADPISUJE projekcję publiczną", async () => {
    // Tylko tabela niesie profile czekające na publikację - dla admina to
    // właśnie one są istotne, więc muszą wygrać z widokiem publicznym.
    planBase({
      profile_badges: ok([{ user_id: ANNA }]),
      author_profiles_public: ok([
        { user_id: ANNA, job_title: "Stare", company: "Stara", is_public: true },
      ]),
      author_profiles: ok([
        { user_id: ANNA, job_title: "Nowe", company: "Nowa", is_public: false },
      ]),
    });
    h.rpcResults.admin_list_users = {
      data: [{ id: ANNA, slug: "anna", display_name: "Anna", avatar_url: null, roles: [] }],
      error: null,
    };
    const base = await run();
    expect(base.entries[0]).toMatchObject({ jobTitle: "Nowe", company: "Nowa", isPublic: false });
    expect(base.publicCount).toBe(0);
  });

  it("wciąga osoby po ROLI autorskiej, nawet bez odznaki i bez profilu", async () => {
    planBase({});
    h.rpcResults.admin_list_users = {
      data: [
        { id: ANNA, slug: "anna", display_name: "Anna", avatar_url: null, roles: ["author"] },
        { id: BOGDAN, slug: "b", display_name: "Bogdan", avatar_url: null, roles: ["reader"] },
      ],
      error: null,
    };
    const base = await run();
    expect(base.entries.map((e) => e.id)).toEqual([ANNA]);
  });

  it("bez uprawnień admina wchodzi w tryb ograniczony i czyta widok publiczny", async () => {
    planBase({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([{ id: ANNA, slug: "anna", display_name: "Anna", avatar_url: null }]),
    });
    h.rpcResults.admin_list_users = { data: null, error: { message: "brak uprawnień" } };
    const base = await run();
    expect(base.restricted).toBe(true);
    expect(base.entries.map((e) => e.id)).toEqual([ANNA]);
  });

  it("tryb ograniczony bez ani jednego identyfikatora zwraca puste podsumowanie", async () => {
    planBase({});
    h.rpcResults.admin_list_users = { data: null, error: { message: "brak uprawnień" } };
    await expect(run()).resolves.toEqual({
      entries: [],
      total: 0,
      expertCount: 0,
      publicCount: 0,
      restricted: true,
    });
  });

  it("tryb ograniczony odsiewa wiersze widoku bez identyfikatora", async () => {
    planBase({
      profile_badges: ok([{ user_id: ANNA }]),
      profiles_public: ok([
        { id: null, slug: "x", display_name: "Duch", avatar_url: null },
        { id: ANNA, slug: "anna", display_name: "Anna", avatar_url: null },
      ]),
    });
    h.rpcResults.admin_list_users = { data: null, error: { message: "brak uprawnień" } };
    expect((await run()).entries).toHaveLength(1);
  });

  it("nazwa spada z display_name na slug, a potem na identyfikator", async () => {
    planBase({ profile_badges: ok([{ user_id: ANNA }, { user_id: BOGDAN }]) });
    h.rpcResults.admin_list_users = {
      data: [
        { id: ANNA, slug: "anna-k", display_name: "   ", avatar_url: null, roles: [] },
        { id: BOGDAN, slug: null, display_name: null, avatar_url: null, roles: [] },
      ],
      error: null,
    };
    const names = (await run()).entries.map((e) => e.name);
    expect(names).toContain("anna-k");
    expect(names).toContain(BOGDAN);
  });
});

describe("filterInternalExperts", () => {
  const entries = [
    {
      id: ANNA,
      name: "Anna Kowalska",
      slug: "anna-kowalska",
      avatarUrl: null,
      jobTitle: "Analityczka",
      company: "NES",
      isExpert: true,
      isPublic: true,
    },
    {
      id: BOGDAN,
      name: "Bogdan Nowak",
      slug: "bogdan",
      avatarUrl: null,
      jobTitle: null,
      company: null,
      isExpert: false,
      isPublic: false,
    },
  ];

  it("pusty filtr zwraca KOPIĘ listy, nie tę samą tablicę", async () => {
    // Panel sortuje wynik w miejscu; oddanie oryginału przestawiłoby dane
    // w cache react-query.
    const result = filterInternalExperts(entries, "");
    expect(result).toEqual(entries);
    expect(result).not.toBe(entries);
  });

  it("same białe znaki traktuje jak brak filtra", () => {
    expect(filterInternalExperts(entries, "   ")).toHaveLength(2);
  });

  it("dopasowuje po nazwisku, stanowisku, firmie i slugu", () => {
    expect(filterInternalExperts(entries, "kowalska").map((e) => e.id)).toEqual([ANNA]);
    expect(filterInternalExperts(entries, "analityczka").map((e) => e.id)).toEqual([ANNA]);
    expect(filterInternalExperts(entries, "nes").map((e) => e.id)).toEqual([ANNA]);
    expect(filterInternalExperts(entries, "bogdan").map((e) => e.id)).toEqual([BOGDAN]);
  });

  it("nie zważa na wielkość liter ani na spacje wokół zapytania", () => {
    expect(filterInternalExperts(entries, "  ANNA  ").map((e) => e.id)).toEqual([ANNA]);
  });

  it("brak dopasowania daje pustą listę", () => {
    expect(filterInternalExperts(entries, "nieistniejący")).toEqual([]);
  });

  it("puste pola nie wywracają filtrowania", () => {
    expect(filterInternalExperts(entries, "analityczka").map((e) => e.id)).toEqual([ANNA]);
  });
});

// ---------------------------------------------------------------------------
// Hydratacja profilu eksperta
// ---------------------------------------------------------------------------

describe("fetchExpertHydration", () => {
  function planHydration(plan: Partial<Record<string, SupabaseResult>> = {}) {
    const defaults: Record<string, SupabaseResult> = {
      profiles: ok({
        id: ANNA,
        slug: "anna",
        display_name: "Anna",
        avatar_url: "a.png",
        bio_pl: "Bio PL",
        bio_en: "Bio EN",
        twitter_url: null,
        linkedin_url: null,
        website_url: null,
      }),
      author_profiles: ok(null),
      author_profiles_public: ok(null),
    };
    for (const [table, result] of Object.entries({ ...defaults, ...plan })) {
      db().setResponse(table, result!);
    }
  }

  it("brak profilu daje null", async () => {
    planHydration({ profiles: ok(null) });
    await expect(fetchExpertHydration(ANNA)).resolves.toBeNull();
  });

  it("błąd odczytu profilu leci dalej", async () => {
    planHydration({ profiles: fail("boom") });
    await expect(fetchExpertHydration(ANNA)).rejects.toMatchObject({ message: "boom" });
  });

  it("bez nakładki autorskiej bierze biogram z profilu", async () => {
    planHydration();
    await expect(fetchExpertHydration(ANNA)).resolves.toMatchObject({
      authorId: ANNA,
      authorSlug: "anna",
      name: "Anna",
      photo: "a.png",
      bioPl: "Bio PL",
      bioEn: "Bio EN",
      email: null,
    });
  });

  it("nakładka RPC admina WYGRYWA z tabelą i z projekcją publiczną", async () => {
    h.rpcResults.admin_get_author_profile = {
      data: {
        job_title: "Z RPC",
        full_bio_pl: "Bio z RPC",
        contact_email: "anna@nes.example",
        website_url: null,
        x_url: null,
        linkedin_url: null,
        full_bio_en: null,
      },
      error: null,
    };
    planHydration({
      author_profiles: ok({ job_title: "Z tabeli", full_bio_pl: "Bio z tabeli" }),
      author_profiles_public: ok({ job_title: "Z widoku" }),
    });
    await expect(fetchExpertHydration(ANNA)).resolves.toMatchObject({
      positionPl: "Z RPC",
      bioPl: "Bio z RPC",
      email: "anna@nes.example",
    });
  });

  it("bez RPC admina bierze WŁASNY wiersz z tabeli", async () => {
    planHydration({
      author_profiles: ok({ job_title: "Z tabeli", x_url: "https://x.example/anna" }),
      author_profiles_public: ok({ job_title: "Z widoku" }),
    });
    await expect(fetchExpertHydration(ANNA)).resolves.toMatchObject({
      positionPl: "Z tabeli",
      x: "https://x.example/anna",
    });
  });

  it("bez RPC i bez własnego wiersza schodzi do projekcji publicznej", async () => {
    planHydration({ author_profiles_public: ok({ job_title: "Z widoku" }) });
    await expect(fetchExpertHydration(ANNA)).resolves.toMatchObject({ positionPl: "Z widoku" });
  });

  it("PUSTE i białoznakowe wartości nakładki nie przykrywają danych profilu", async () => {
    // `pick` odrzuca napisy bez treści - inaczej pusty biogram autorski
    // wymazałby biogram z profilu i strona zostałaby bez opisu.
    planHydration({ author_profiles: ok({ full_bio_pl: "   ", job_title: "" }) });
    await expect(fetchExpertHydration(ANNA)).resolves.toMatchObject({
      bioPl: "Bio PL",
      positionPl: null,
    });
  });

  it("adres kontaktowy pochodzi WYŁĄCZNIE z RPC admina", async () => {
    // Publiczna projekcja świadomie nie ma `contact_email` - to PII.
    planHydration({ author_profiles_public: ok({ job_title: "Z widoku" }) });
    await expect(fetchExpertHydration(ANNA)).resolves.toMatchObject({ email: null });
  });
});

// ---------------------------------------------------------------------------
// Odczyt huba przez RPC
// ---------------------------------------------------------------------------

describe("fetchExpertHubFromRpc", () => {
  it("błąd RPC oznacza NIEDOSTĘPNOŚĆ, nie brak eksperta", async () => {
    // Rozróżnienie jest kluczowe dla trasy: „niedostępne" schodzi na ścieżkę
    // zapasową, a „nie znaleziono" renderuje 404. Zlanie ich w jedno dałoby
    // 404 dla istniejącego eksperta przy chwilowej awarii RPC.
    h.rpcResults.get_expert_hub = { data: null, error: { message: "brak funkcji" } };
    await expect(fetchExpertHubFromRpc("anna")).resolves.toEqual({ kind: "unavailable" });
  });

  it("pusty ładunek też oznacza niedostępność", async () => {
    h.rpcResults.get_expert_hub = { data: null, error: null };
    await expect(fetchExpertHubFromRpc("anna")).resolves.toEqual({ kind: "unavailable" });
  });

  it("ładunek BEZ profilu oznacza brak eksperta", async () => {
    h.rpcResults.get_expert_hub = { data: { profile: null }, error: null };
    await expect(fetchExpertHubFromRpc("anna")).resolves.toEqual({ kind: "not-found" });
  });

  it("przekazuje slug albo identyfikator do funkcji bazy", async () => {
    h.rpcResults.get_expert_hub = { data: { profile: null }, error: null };
    await fetchExpertHubFromRpc("anna-kowalska");
    expect(h.rpcCalls).toContainEqual({
      fn: "get_expert_hub",
      args: { _slug_or_id: "anna-kowalska" },
    });
  });

  it("poprawny ładunek buduje hub", async () => {
    h.rpcResults.get_expert_hub = {
      data: {
        profile: { id: ANNA, slug: "anna", display_name: "Anna" },
        author_profile: null,
        badges: ["expert", 42],
        programs: [],
        regions: [],
        categories: [],
        tags: [],
      },
      error: null,
    };
    const result = await fetchExpertHubFromRpc("anna");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.hub.expert).toBeTruthy();
    expect(result.hub.programs).toEqual([]);
    expect(result.hub.layoutSettings).toBeNull();
  });
});
