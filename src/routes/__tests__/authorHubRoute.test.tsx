// Trasa PUBLICZNA `/author/$slug` - hub eksperta. Stała na okrągłym zerze.
//
// CO TEN PLIK DOWODZI - I DLACZEGO TRAKTUJE TĘ TRASĘ POWAŻNIEJ NIŻ PANELE.
//
// To jedyna trasa tego modułu, którą widzi świat: indeksowana, udostępniana
// odnośnikiem, scrapowana przez podglądy społecznościowe. Pomyłka nie kończy
// się tu złym ekranem dla jednej osoby - kończy się wypadnięciem profilu
// z wyników wyszukiwania albo pokazaniem 404 na stronie, która istnieje.
//
//   1. TRZY ROZŁĄCZNE STANY LOADERA, i to jest najważniejsza pozycja.
//      Wiersz → render. `null` → 404 (prawda: takiego profilu nie ma).
//      AWARIA / brak czasu → HTTP 200 z uczciwym komunikatem, NIGDY 404.
//      Sfabrykowany 404 przy blipie backendu wyrzuca indeksowany profil
//      z wyszukiwarki, a odzyskanie pozycji zajmuje tygodnie - stąd osobny
//      stan `degraded` i `no-store` na odpowiedzi.
//   2. INDEKSACJA JEST WARUNKOWA. Goły profil członka (bez odznaki eksperta,
//      bez dorobku, bez programów, obszarów i wzmianek) dostaje
//      `noindex, nofollow`. Widok spaginowany indeksowalnego profilu dostaje
//      `noindex, follow` - ranking konsoliduje się na stronie 1. Reguła
//      role-gatingu jest NADRZĘDNA: profil nieindeksowalny ma `nofollow`
//      zawsze, także na stronie 1.
//   3. ADRES KANONICZNY BEZ PARAMETRÓW EKSPLORATORA. Sześć filtrów i strona
//      dają tysiące kombinacji URL-i o tej samej treści; kanoniczny bez nich
//      jest jedyną rzeczą, która trzyma ranking w jednym miejscu.
//   4. INLINE-EDYTOR LAYOUTU WIDZI WŁAŚCICIEL I ADMIN TEGO SAMEGO TENANTA -
//      dokładnie ci, których wpuszcza RLS na `author_profiles`. Admin OBCEGO
//      tenanta nie może przestawiać cudzej strony publicznej.
//   5. OBEJRZENIE PROFILU NIE JEST REJESTROWANE, gdy oglądający jest
//      właścicielem. Inaczej licznik „kto oglądał mój profil" pokazywałby
//      samego zainteresowanego.
//   6. LAYOUT JEDZIE W TYM SAMYM ROUND-TRIPIE co tożsamość. Trasa zasiewa go
//      do cache zamiast doklejać sekwencyjne zapytanie na krytycznej ścieżce
//      TTFB, a `null` z RPC (potwierdzony brak wiersza) też jest wiedzą:
//      schodzi na defaulty tenanta, nie na drugie zapytanie. Osobny odczyt
//      zostaje wyłącznie dla ścieżki legacy - i właśnie tam siedzi DEFEKT
//      zgłoszony w tym pliku jako `it.fails`: loader wycisza awarię layoutu
//      („to dekoracja"), ale komponent czyta ten sam klucz przez
//      `useSuspenseQuery`, więc błąd wraca w renderze i zamienia indeksowany
//      profil w ekran błędu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ INDEKSACJI: `isIndexableProfile`/`profileRobots` mają własny plik
//   (`src/lib/experts/__tests__/publicVisibility.test.ts`). Tutaj dowodzimy, że
//   trasa je WOŁA z sygnałami z ładunku huba i respektuje wynik.
// - ZAPYTAŃ HUBA I MATERIAŁÓW: `lib/experts/queries`, `materials`,
//   `materialsSearch` mają swoje testy. Tu są atrapami.
// - ORGANIZMÓW HUBA (hero, eksplorator materiałów, CV, „W mediach", rekomendacje,
//   przyciski sieci): każdy ma własne testy. Tutaj są atrapami-markerami, bo
//   przedmiotem dowodu jest to, KTÓRE z nich trasa montuje i z czym.
// - SCALANIA LAYOUTU: `mergeExpertLayout` i `isSectionVisible` mają
//   `lib/experts/__tests__/layoutRules.test.ts`.
//
// USTALENIE CO DO `lib/profile/publicExposure.ts` - zadanie kazało sprawdzić, że
// ta trasa go respektuje. NIE RESPEKTUJE GO I NIE MA GO RESPEKTOWAĆ, a moduł
// mówi to o sobie sam w nagłówku: „dla autora i eksperta - bo ich hub
// /author/$slug jest publiczny Z ZAŁOŻENIA i żadna bramka tego nie zmieni".
// `publicExposure` opisuje WŁASNY profil w panelu prywatności (RPC
// `get_my_public_exposure`), nie to, co widzi gość. Widoczność POLA zamyka baza:
// widok `profiles_public` ma od migracji 20260806160000 dwie addytywne warstwy,
// a warstwa publiczna wymaga realnej publicznej obecności - i to jest dowiedzione
// w pgTAP, nie tutaj (§4 zadania). Ta trasa odpowiada za drugą warstwę:
// INDEKSACJĘ, i to ona jest przedmiotem dowodu w punkcie 2.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Ładunek huba: obiekt = profil, `null` = nie ma takiego profilu. */
  hub: null as Record<string, unknown> | null,
  /** Czy odczyt tożsamości ma zgłosić degradację (awaria / brak czasu). */
  degraded: false,
  /** Czy zapytanie o materiały ma paść (wtórne wobec tożsamości). */
  materialsFail: false,
  layoutSettings: { tenant_id: "tenant-1" } as Record<string, unknown> | null,
  /** Czy OSOBNY odczyt layoutu ma paść (ścieżka legacy, bez layoutu w RPC). */
  layoutFail: false,
  /** Ile razy poleciał OSOBNY odczyt layoutu - dowód na zasianie cache. */
  layoutFetches: 0,
  /** Odznaki katalogowe; `undefined` = odczyt jeszcze nie wrócił. */
  badges: ["verified", "speaker"] as string[] | undefined,
  /** Przełączniki personalizacji widoku (nagłówek huba). */
  personalized: {} as Record<string, boolean>,
  /** Odcinki podcastu przypisane do profilu. */
  podcasts: [] as Record<string, unknown>[],
  /** Nagłówki cache ustawione przez loader - dowód na `no-store`. */
  cacheHeaders: [] as string[],
  /** Klucze zasiane do cache przez loader (layout z jednego round-tripu). */
  seeded: [] as string[],
  user: null as { id: string } | null,
  isAdmin: false,
  viewerTenantId: null as string | null,
  language: "pl",
  /** Identyfikatory, dla których zarejestrowano obejrzenie profilu. */
  recordedViews: [] as string[],
  /** Widoczność sekcji zwracana przez reguły layoutu. */
  visibleSections: new Set<string>([
    "expertise_bar",
    "details",
    "media_mentions",
    "podcast_strip",
    "materials",
    "cv",
  ]),
  /** Adres żądania widziany przez `head()` - decyduje o kanonicznym. */
  requestUrl: "/author/anna-kowalska",
  /** Propsy zapisane przez atrapy organizmów. */
  organism: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-experts", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.user,
    isAdmin: h.isAdmin,
    tenantId: h.viewerTenantId,
    session: h.user ? {} : null,
    loading: false,
  }),
}));
vi.mock("@/lib/network/useProfileViews", () => ({
  useRecordProfileView: () => ({
    mutate: (id: string) => h.recordedViews.push(id),
  }),
}));
vi.mock("@/hooks/usePersonalizedSettings", () => ({
  usePersonalizedSettings: () => h.personalized,
}));
vi.mock("@/lib/profile/badges", () => ({
  useUserBadges: () => ({ data: h.badges }),
}));
vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => h.requestUrl }));
vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => h.cacheHeaders.push(value),
}));
// Zapytania huba i materiałów: atrapy oddają wyłącznie KLUCZ i funkcję, bo
// przedmiotem dowodu jest zachowanie loadera wobec ich wyniku, nie ich treść.
vi.mock("@/lib/experts/queries", () => ({
  expertHubQueryOptions: (slug: string) => ({
    queryKey: ["expert-hub", slug],
    queryFn: () => Promise.resolve(h.hub),
  }),
}));
vi.mock("@/lib/experts/materials", () => ({
  expertMaterialsQueryOptions: (slug: string, args: unknown) => ({
    queryKey: ["expert-materials", slug, args],
    queryFn: () =>
      h.materialsFail ? Promise.reject(new Error("materiały padły")) : Promise.resolve([]),
  }),
}));
// Layout tenanta: licznik odczytów jest tu DOWODEM, że ładunek RPC oszczędza
// osobne zapytanie na krytycznej ścieżce TTFB.
vi.mock("@/hooks/useExpertLayoutSettings", () => ({
  expertLayoutSettingsQueryOptions: (tenantId: string | null) => ({
    queryKey: ["expert-layout", tenantId],
    queryFn: () => {
      h.layoutFetches += 1;
      return h.layoutFail
        ? Promise.reject(new Error("odczyt layoutu padł"))
        : Promise.resolve(h.layoutSettings);
    },
  }),
}));
vi.mock("@/lib/queries/podcasts", () => ({
  podcastsByProfileQueryOptions: (id: string) => ({
    queryKey: ["podcasts", id],
    queryFn: () => Promise.resolve(h.podcasts),
  }),
}));
// Degradacja jest STANEM LOADERA, nie awarią zapytania - atrapa pozwala nim
// sterować bez czekania na realny budżet czasu.
vi.mock("@/lib/ssr/resilientLoad", () => ({
  loadResilient: async (
    _client: unknown,
    options: { queryFn: () => Promise<unknown> },
    fallback: unknown,
  ) => {
    if (h.degraded) return { data: fallback, degraded: true };
    return { data: await options.queryFn(), degraded: false };
  },
}));
vi.mock("@/lib/expertLayouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/expertLayouts")>();
  return {
    ...actual,
    isSectionVisible: (_settings: unknown, section: string) => h.visibleSections.has(section),
  };
});

/** Atrapa organizmu: marker w DOM + zapis propsów. */
function organismStub(name: string) {
  return (props: Record<string, unknown>) => {
    h.organism[name] = props;
    return <div data-testid={name} />;
  };
}

// Hero renderuje przekazany blok akcji - to jedyna atrapa, która MUSI oddać
// swoje dziecko, bo przyciski sieci i obserwowania trasa montuje właśnie tam.
vi.mock("@/components/experts/ExpertLayoutRenderer", () => ({
  ExpertLayoutHero: (props: { action?: ReactNode } & Record<string, unknown>) => {
    h.organism.ExpertLayoutHero = props;
    return <div data-testid="ExpertLayoutHero">{props.action}</div>;
  },
  ExpertSectionsList: organismStub("ExpertSectionsList"),
  ExpertLayoutStyleScope: organismStub("ExpertLayoutStyleScope"),
  expertLayoutCssVars: () => ({ "--pv-accent": "#123456" }),
}));
vi.mock("@/components/experts/ExpertMaterialsExplorer", () => ({
  ExpertMaterialsExplorer: organismStub("ExpertMaterialsExplorer"),
}));
vi.mock("@/components/experts/ExpertHubDetails", () => ({
  ExpertHubDetails: organismStub("ExpertHubDetails"),
}));
vi.mock("@/components/experts/ExpertInTheNews", () => ({
  ExpertInTheNews: organismStub("ExpertInTheNews"),
}));
vi.mock("@/components/experts/ExpertRequestButton", () => ({
  ExpertRequestButton: organismStub("ExpertRequestButton"),
}));
vi.mock("@/components/author/AuthorCvSections", () => ({
  AuthorCvSections: organismStub("AuthorCvSections"),
}));
vi.mock("@/components/network/RecommendationsSection", () => ({
  RecommendationsSection: organismStub("RecommendationsSection"),
}));
vi.mock("@/components/podcast/PodcastEpisodeStrip", () => ({
  PodcastEpisodeStrip: organismStub("PodcastEpisodeStrip"),
}));
vi.mock("@/components/FollowButton", () => ({ FollowButton: organismStub("FollowButton") }));
vi.mock("@/components/network/ConnectButton", () => ({
  ConnectButton: organismStub("ConnectButton"),
}));
vi.mock("@/components/network/DirectMessageButton", () => ({
  DirectMessageButton: organismStub("DirectMessageButton"),
}));
vi.mock("@/components/network/MutualConnectionsHint", () => ({
  MutualConnectionsHint: organismStub("MutualConnectionsHint"),
}));
vi.mock("@/components/network/organisms/NetworkDistance", () => ({
  NetworkDistance: organismStub("NetworkDistance"),
}));
vi.mock("@/components/network/RequestIntroductionButton", () => ({
  RequestIntroductionButton: organismStub("RequestIntroductionButton"),
}));
vi.mock("@/components/network/AuthorMoreMenu", () => ({
  AuthorMoreMenu: organismStub("AuthorMoreMenu"),
}));
vi.mock("@/components/Breadcrumbs", () => ({ Breadcrumbs: organismStub("Breadcrumbs") }));
vi.mock("@/components/molecules/DegradedDataNotice", () => ({
  DegradedDataNotice: organismStub("DegradedDataNotice"),
}));
vi.mock("@/components/molecules/PublicNotFound", () => ({
  PublicNotFound: organismStub("PublicNotFound"),
}));
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: organismStub("RouteErrorFallback"),
}));
vi.mock("@/components/profile/ProfileBadges", () => ({
  ProfileBadges: organismStub("ProfileBadges"),
}));
// Inline-edytor jest leniwy; atrapa oszczędza `Suspense` w teście, a sam fakt
// jego zamontowania jest przedmiotem dowodu (bramka uprawnień).
vi.mock("@/components/experts/ExpertLayoutInlineEditor", () => ({
  default: organismStub("ExpertLayoutInlineEditor"),
}));

import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { Route as AuthorHubRoute } from "@/routes/author.$slug";
import { isIndexableProfile, profileRobots } from "@/lib/experts/publicVisibility";

const PATH = "/author/$slug";

/** Ładunek huba w kształcie, jakiego oczekuje trasa. */
function hub(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const expert = {
    id: "expert-1",
    slug: "anna-kowalska",
    tenant_id: "tenant-1",
    display_name: "Anna Kowalska",
    job_title: "Analityczka",
    company: "Instytut",
    is_expert: true,
    verified_at: "2026-01-01T00:00:00.000Z",
    avatar_url: "https://cdn.example.org/anna.jpg",
    updated_at: "2026-08-01T10:00:00.000Z",
    bio_pl: "Krótka nota.",
    bio_en: "Short note.",
    full_bio_pl: "",
    full_bio_en: "",
    website_url: "https://example.org/anna",
    linkedin_url: "https://example.org/in/anna",
    twitter_url: null,
    contact_email: "anna@example.org",
    layout_overrides: null,
    ...expertPatch(patch),
  };
  return {
    programs: [],
    areas: [{ name_pl: "Energia", name_en: "Energy" }],
    mediaMentions: [],
    materials: [],
    facets: { programs: [], regions: [], categories: [], tags: [] },
    layoutSettings: null,
    ...patch,
    // Po `...patch`, bo nadpisania eksperta są już w nim scalone.
    expert,
  };
}

/** Nadpisania pola `expert` z łatki - strażnik zamiast rzutowania. */
function expertPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const value = patch.expert;
  return value !== null && typeof value === "object" ? { ...value } : {};
}

/** Opis nagłówka dla profilu i widoku eksploratora. */
function headFor(
  loaderData: Record<string, unknown> | null,
  params: Record<string, string> = { slug: "anna-kowalska" },
) {
  return routeHead(AuthorHubRoute, { loaderData, params });
}

const metaByName = (result: RouteHeadResult, name: string) =>
  result.meta?.find((m) => m.name === name)?.content as string | undefined;
const metaByProperty = (result: RouteHeadResult, property: string) =>
  result.meta?.find((m) => m.property === property)?.content as string | undefined;
const title = (result: RouteHeadResult) =>
  String(result.meta?.find((m) => "title" in m)?.title ?? "");
const canonical = (result: RouteHeadResult) =>
  result.links?.find((l) => l.rel === "canonical")?.href as string | undefined;
const jsonLd = (result: RouteHeadResult) =>
  (result.scripts ?? []).map((s) => JSON.parse(String(s.children)) as Record<string, unknown>);

/** Draft layoutu w kształcie, jaki wysyła inline-edytor. */
interface LayoutDraft {
  overrides: Record<string, unknown>;
}

type DraftSetter = (draft: LayoutDraft | null) => void;

/** STRAŻNIK, nie rzutowanie: warunek sprawdza w runtime, że to funkcja. */
function isDraftSetter(value: unknown): value is DraftSetter {
  return typeof value === "function";
}

/**
 * `onDraftChange` zapisany przez atrapę inline-edytora. Wywołanie go jest
 * jedynym sposobem, żeby dowieść podglądu na żywo bez ciągnięcia całego
 * edytora do tego pliku (ma własne testy).
 */
function draftSetter(): DraftSetter {
  const value: unknown = h.organism.ExpertLayoutInlineEditor?.onDraftChange;
  if (!isDraftSetter(value)) throw new Error("test: inline-edytor nie dostał `onDraftChange`");
  return value;
}

const loaded = (page = 1, paginated = false) => ({
  hub: hub(),
  degraded: false,
  archiveView: { page, paginated },
});

async function mount(search = "") {
  return renderRoute({
    route: AuthorHubRoute,
    path: PATH,
    initialEntry: `/author/anna-kowalska${search}`,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hub = hub();
  h.degraded = false;
  h.materialsFail = false;
  h.layoutSettings = { tenant_id: "tenant-1" };
  h.layoutFail = false;
  h.layoutFetches = 0;
  h.badges = ["verified", "speaker"];
  h.personalized = {};
  h.podcasts = [];
  h.cacheHeaders = [];
  h.seeded = [];
  h.user = null;
  h.isAdmin = false;
  h.viewerTenantId = null;
  h.language = "pl";
  h.recordedViews = [];
  h.visibleSections = new Set([
    "expertise_bar",
    "details",
    "media_mentions",
    "podcast_strip",
    "materials",
    "cv",
  ]);
  h.requestUrl = "/author/anna-kowalska";
  h.organism = {};
});

afterEach(() => cleanup());

describe("loader - trzy rozłączne stany", () => {
  it("PROFIL ISTNIEJE: hub renderuje się z hero i sekcjami", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.organism.ExpertLayoutHero?.hub).toMatchObject({
      expert: { display_name: "Anna Kowalska" },
    });
  });

  it("PROFILU NIE MA (`null`): trasa zgłasza 404, nie pusty ekran", async () => {
    // `null` z zapytania tożsamościowego to PRAWDA o braku profilu - i tylko
    // wtedy wolno pokazać 404.
    h.hub = null;
    await mount();
    await waitFor(() => expect(screen.getByTestId("PublicNotFound")).toBeTruthy());
    expect(screen.queryByTestId("DegradedDataNotice")).toBeNull();
    expect(screen.queryByTestId("ExpertLayoutHero")).toBeNull();
  });

  it("AWARIA ODCZYTU: HTTP 200 z uczciwym komunikatem, NIGDY 404", async () => {
    // To jest najważniejsza asercja w tym pliku. Sfabrykowany 404 przy blipie
    // backendu wyrzuca indeksowany profil eksperta z wyników wyszukiwania,
    // a odzyskanie pozycji zajmuje tygodnie.
    h.degraded = true;
    await mount();
    await waitFor(() => expect(screen.getByTestId("DegradedDataNotice")).toBeTruthy());
    // Komunikat degradacji, a NIE „nie znaleziono" - to jest sedno.
    expect(screen.queryByTestId("PublicNotFound")).toBeNull();
    expect(screen.queryByTestId("ExpertLayoutHero")).toBeNull();
  });

  it("degradacja ustawia `no-store` - nie wolno zacache'ować niepewnego stanu", async () => {
    h.degraded = true;
    await mount();
    await waitFor(() => expect(h.cacheHeaders.length).toBeGreaterThan(0));
    expect(h.cacheHeaders.at(-1)).toContain("no-store");
  });

  it("brak profilu też ustawia `no-store` - 404 nie może utknąć na brzegu", async () => {
    h.hub = null;
    await mount();
    await waitFor(() => expect(h.cacheHeaders.length).toBeGreaterThan(0));
    expect(h.cacheHeaders.at(-1)).toContain("no-store");
  });

  it("PROFIL ISTNIEJE i materiały doszły: odpowiedź jest cache'owalna", async () => {
    await mount();
    await waitFor(() => expect(h.cacheHeaders.length).toBeGreaterThan(0));
    expect(h.cacheHeaders.at(-1)).not.toContain("no-store");
  });

  it("AWARIA MATERIAŁÓW nie wywraca huba, ale odbiera cache", async () => {
    // Materiały są wtórne wobec tożsamości: profil ma się wyrenderować, lista
    // dociągnie się po hydratacji. Cache'owanie niekompletnej strony
    // utrwaliłoby brak na brzegu.
    h.materialsFail = true;
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.cacheHeaders.at(-1)).toContain("no-store");
  });
});

describe("head - indeksacja", () => {
  it("profil EKSPERTA jest indeksowany z hintami dla AI overview", () => {
    const robots = metaByName(headFor(loaded()), "robots");
    expect(robots).toBe(profileRobots(true));
    expect(robots).toContain("index");
  });

  it("GOŁY PROFIL CZŁONKA dostaje `noindex, nofollow`", () => {
    // Zbiór profili osiągalnych publicznie jest szerszy niż zbiór wart
    // indeksowania: konto bez odznaki i bez dorobku nie zasługuje na wpis
    // w wyszukiwarce, choć jego strona istnieje.
    const bare = {
      hub: hub({
        expert: { is_expert: false },
        areas: [],
        programs: [],
        materials: [],
        mediaMentions: [],
      }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(metaByName(headFor(bare), "robots")).toBe("noindex, nofollow");
  });

  it.each([
    [{ isExpert: true, materialCount: 0, programCount: 0, areaCount: 0, mediaMentionCount: 0 }],
    [{ isExpert: false, materialCount: 1, programCount: 0, areaCount: 0, mediaMentionCount: 0 }],
    [{ isExpert: false, materialCount: 0, programCount: 1, areaCount: 0, mediaMentionCount: 0 }],
    [{ isExpert: false, materialCount: 0, programCount: 0, areaCount: 1, mediaMentionCount: 0 }],
    [{ isExpert: false, materialCount: 0, programCount: 0, areaCount: 0, mediaMentionCount: 1 }],
  ])("trasa respektuje KAŻDY sygnał indeksacji z ładunku huba (%j)", (signals) => {
    // Nie przepisujemy tu reguł `isIndexableProfile` - sprawdzamy, że trasa
    // podaje jej WSZYSTKIE pięć sygnałów z huba i nie gubi żadnego po drodze.
    const payload = {
      hub: hub({
        expert: { is_expert: signals.isExpert },
        materials: Array.from({ length: signals.materialCount }, () => ({})),
        programs: Array.from({ length: signals.programCount }, () => ({})),
        areas: Array.from({ length: signals.areaCount }, () => ({ name_pl: "X", name_en: "X" })),
        mediaMentions: Array.from({ length: signals.mediaMentionCount }, () => ({})),
      }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(metaByName(headFor(payload), "robots")).toBe(profileRobots(isIndexableProfile(signals)));
  });

  it("WIDOK SPAGINOWANY indeksowalnego profilu: `noindex, follow`", () => {
    // Ranking konsoliduje się na stronie 1, ale linki ze strony N dalej liczą
    // się dla materiałów, do których prowadzą.
    expect(metaByName(headFor(loaded(2, true)), "robots")).toBe("noindex, follow");
  });

  it("ROLE-GATING JEST NADRZĘDNY: nieindeksowalny profil ma `nofollow` także spaginowany", () => {
    const barePaginated = {
      hub: hub({
        expert: { is_expert: false },
        areas: [],
        programs: [],
        materials: [],
        mediaMentions: [],
      }),
      degraded: false,
      archiveView: { page: 3, paginated: true },
    };
    expect(metaByName(headFor(barePaginated), "robots")).toBe("noindex, nofollow");
  });

  it("render ZDEGRADOWANY nie opisuje profilu, którego nie pobraliśmy", () => {
    // Meta opisujące profil na podstawie pustego ładunku byłyby fikcją
    // wystawioną scraperom.
    const degraded = { hub: null, degraded: true, archiveView: { page: 1, paginated: false } };
    const result = headFor(degraded);
    expect(title(result)).toBe("Ekspert");
    expect(metaByProperty(result, "profile:username")).toBeUndefined();
  });
});

describe("head - adres kanoniczny", () => {
  it("kanoniczny NIE NIESIE parametrów eksploratora", () => {
    // Sześć filtrów i strona dają tysiące adresów o tej samej treści; bez tego
    // ranking rozprasza się na wszystkie kombinacje.
    h.requestUrl = "/author/anna-kowalska?page=3&kind=report&topic=energia&year=2026";
    expect(canonical(headFor(loaded(3, true)))).toBe("/author/anna-kowalska");
  });

  it.each(["page", "kind", "topic", "region", "program", "year"])(
    "parametr %s jest usuwany z kanonicznego - kanarek listy",
    (param) => {
      h.requestUrl = `/author/anna-kowalska?${param}=x`;
      expect(canonical(headFor(loaded()))).toBe("/author/anna-kowalska");
    },
  );

  it("kanoniczny zrzuca CAŁY ciąg zapytania, nie tylko znane filtry", () => {
    // Dla adresu względnego trasa bierze samą ścieżkę, więc znaczniki kampanii
    // też wypadają. To jest MOCNIEJSZY kontrakt niż lista sześciu filtrów wyżej
    // i właściwy dla profilu: żaden parametr nie zmienia jego treści.
    h.requestUrl = "/author/anna-kowalska?utm_source=newsletter&fbclid=xyz";
    expect(canonical(headFor(loaded()))).toBe("/author/anna-kowalska");
  });

  it("brak adresu żądania cofa się do ścieżki ze sluga", () => {
    // SSR poza kontekstem żądania (prerender, test) nie ma prawa wyprodukować
    // kanonicznego wskazującego na inny profil.
    h.requestUrl = "";
    expect(canonical(headFor(loaded(), { slug: "jan-nowak" }))).toBe("/author/jan-nowak");
  });
});

describe("head - opis i podglądy społecznościowe", () => {
  it("tytuł niesie stanowisko i firmę - to one odróżniają imienników", () => {
    expect(title(headFor(loaded()))).toBe("Anna Kowalska - Analityczka · Instytut");
  });

  it("profil bez stanowiska ma tytuł z samego imienia i nazwiska", () => {
    const payload = {
      hub: hub({ expert: { job_title: null, company: null } }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(title(headFor(payload))).toBe("Anna Kowalska");
  });

  it("strona >1 dostaje sufiks w tytule - karty przeglądarki są rozróżnialne", () => {
    // Język nagłówka bierze się z ADRESU (`activeLang`), nie z instancji i18n:
    // SSR renderuje head przed hydratacją, więc jedynym pewnym sygnałem jest
    // prefiks ścieżki.
    expect(title(headFor(loaded(4, true)))).toContain("(strona 4)");
    h.requestUrl = "/en/author/anna-kowalska";
    expect(title(headFor(loaded(4, true)))).toContain("(page 4)");
  });

  it("opis bierze się z BIO, po odsianiu HTML i nadmiarowych spacji", () => {
    const payload = {
      hub: hub({
        expert: { full_bio_pl: "  <p>Zajmuje   się</p>\n<b>energią</b> teraz.  " },
      }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(metaByName(headFor(payload), "description")).toBe("Zajmuje się energią teraz.");
  });

  it("znacznik zamykający PRZED kropką zostawia spację - stan faktyczny", () => {
    // ODNOTOWANE, NIE NAPRAWIONE. Odsiew HTML zamienia każdy znacznik na
    // spację, więc „<b>energią</b>." daje „energią ." - spacja przed kropką
    // w meta description każdego eksperta, którego bio kończy zdanie
    // pogrubieniem albo odnośnikiem. Defekt kosmetyczny, ale widoczny w SERP;
    // poprawka to jeden `replace` przed przycięciem. Nie wchodzi w zakres tego
    // etapu (pokrycie), więc test opisuje stan faktyczny, a nie życzenie -
    // inaczej po cichu zmieniłbym zachowanie produkcyjne pod pretekstem testu.
    const payload = {
      hub: hub({ expert: { full_bio_pl: "<b>energią</b>." } }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(metaByName(headFor(payload), "description")).toBe("energią .");
  });

  it("opis jest PRZYCIĘTY do 160 znaków - dłuższy i tak zostanie ucięty w SERP", () => {
    const payload = {
      hub: hub({ expert: { full_bio_pl: "x".repeat(400) } }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(metaByName(headFor(payload), "description")).toHaveLength(160);
  });

  it("profil BEZ BIO dostaje opis z obszarów ekspertyzy, nie pustkę", () => {
    // Pusty `description` oddaje wyszukiwarce decyzję o tym, co pokazać -
    // zwykle pierwsze zdanie nawigacji.
    const payload = {
      hub: hub({
        expert: { bio_pl: "", bio_en: "", full_bio_pl: "", full_bio_en: "" },
        areas: [
          { name_pl: "Energia", name_en: "Energy" },
          { name_pl: "Klimat", name_en: "Climate" },
        ],
      }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    const description = metaByName(headFor(payload), "description");
    expect(description).toContain("Anna Kowalska");
    expect(description).toContain("Energia");
  });

  it("profil bez bio I bez obszarów dostaje opis ogólny", () => {
    const payload = {
      hub: hub({
        expert: { bio_pl: "", bio_en: "", full_bio_pl: "", full_bio_en: "" },
        areas: [],
      }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    expect(metaByName(headFor(payload), "description")).toContain("New European Strategies");
  });

  it("`og:type` to `profile`, nie `website` - Facebook i LinkedIn to czytają", () => {
    expect(metaByProperty(headFor(loaded()), "og:type")).toBe("profile");
  });

  it("imię i nazwisko jadą osobno w Open Graph", () => {
    const result = headFor(loaded());
    expect(metaByProperty(result, "profile:first_name")).toBe("Anna");
    expect(metaByProperty(result, "profile:last_name")).toBe("Kowalska");
    expect(metaByProperty(result, "profile:username")).toBe("anna-kowalska");
  });

  it("nazwisko wieloczłonowe zostaje CAŁE w `last_name`", () => {
    const payload = {
      hub: hub({ expert: { display_name: "Anna Maria Kowalska-Nowak" } }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    const result = headFor(payload);
    expect(metaByProperty(result, "profile:first_name")).toBe("Anna");
    expect(metaByProperty(result, "profile:last_name")).toBe("Maria Kowalska-Nowak");
  });

  it("`og:image` niesie WERSJĘ z daty zmiany profilu - scraper nie trzyma starej", () => {
    // Bez cache-bustera podgląd w social media zostaje na zdjęciu, które
    // użytkownik właśnie wymienił.
    const image = metaByProperty(headFor(loaded()), "og:image");
    expect(image).toContain("anna.jpg");
    expect(image).toMatch(/[?&]v=/);
  });
});

describe("head - dane strukturalne", () => {
  it("wypisuje Person ORAZ BreadcrumbList", () => {
    const nodes = jsonLd(headFor(loaded()));
    expect(nodes.map((n) => n["@type"])).toEqual(["Person", "BreadcrumbList"]);
  });

  it("Person niesie stanowisko, pracodawcę, obszary i kanały `sameAs`", () => {
    const [person] = jsonLd(headFor(loaded()));
    expect(person).toMatchObject({
      "@type": "Person",
      name: "Anna Kowalska",
      givenName: "Anna",
      familyName: "Kowalska",
      jobTitle: "Analityczka",
      worksFor: { "@type": "Organization", name: "Instytut" },
      knowsAbout: ["Energia"],
    });
    expect(person.sameAs).toEqual(["https://example.org/anna", "https://example.org/in/anna"]);
  });

  it("puste kanały NIE trafiają do `sameAs`", () => {
    // Pusty ciąg w `sameAs` to nieprawidłowy węzeł schema.org, a nie „brak".
    const payload = {
      hub: hub({
        expert: { website_url: "   ", linkedin_url: null, twitter_url: "" },
      }),
      degraded: false,
      archiveView: { page: 1, paginated: false },
    };
    const [person] = jsonLd(headFor(payload));
    expect(person.sameAs).toBeUndefined();
  });

  it("BreadcrumbList prowadzi Home › Eksperci › nazwisko", () => {
    const [, breadcrumb] = jsonLd(headFor(loaded()));
    const items = breadcrumb.itemListElement as { position: number; name: string }[];
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[2].name).toBe("Anna Kowalska");
  });

  it("okruszki są w języku ADRESU, nie instancji i18n", () => {
    h.requestUrl = "/en/author/anna-kowalska";
    const [, breadcrumb] = jsonLd(headFor(loaded()));
    const items = breadcrumb.itemListElement as { name: string }[];
    expect(items[0].name).toBe("Home");
    expect(items[1].name).toBe("Experts");
  });
});

describe("komponent - bramka edycji layoutu", () => {
  it("GOŚĆ nie widzi inline-edytora", async () => {
    h.user = null;
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("ExpertLayoutInlineEditor")).toBeNull();
  });

  it("WŁAŚCICIEL profilu widzi inline-edytor", async () => {
    h.user = { id: "expert-1" };
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutInlineEditor")).toBeTruthy());
  });

  it("ADMIN TEGO SAMEGO tenanta widzi inline-edytor", async () => {
    h.user = { id: "kto-inny" };
    h.isAdmin = true;
    h.viewerTenantId = "tenant-1";
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutInlineEditor")).toBeTruthy());
  });

  it("ADMIN OBCEGO tenanta NIE widzi inline-edytora", async () => {
    // To jest cała treść tego testu: admin nie może przestawiać publicznej
    // strony osoby z innego tenanta. Bramka odpowiada RLS na `author_profiles`.
    h.user = { id: "kto-inny" };
    h.isAdmin = true;
    h.viewerTenantId = "tenant-obcy";
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("ExpertLayoutInlineEditor")).toBeNull();
  });

  it("ZWYKŁY zalogowany użytkownik NIE widzi inline-edytora", async () => {
    h.user = { id: "kto-inny" };
    h.isAdmin = false;
    h.viewerTenantId = "tenant-1";
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("ExpertLayoutInlineEditor")).toBeNull();
  });

  it("profil BEZ tenanta nie wpuszcza nikogo do edycji", async () => {
    // Bez tenanta nie da się rozstrzygnąć, czy admin jest „swój".
    h.hub = hub({ expert: { tenant_id: null } });
    h.user = { id: "kto-inny" };
    h.isAdmin = true;
    h.viewerTenantId = null;
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("ExpertLayoutInlineEditor")).toBeNull();
  });
});

describe("komponent - rejestrowanie obejrzenia profilu", () => {
  it("GOŚĆ nie rejestruje obejrzenia - nie ma kogo zapisać", async () => {
    h.user = null;
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.recordedViews).toEqual([]);
  });

  it("OBCY zalogowany rejestruje obejrzenie", async () => {
    h.user = { id: "kto-inny" };
    await mount();
    await waitFor(() => expect(h.recordedViews).toEqual(["expert-1"]));
  });

  it("WŁAŚCICIEL nie rejestruje obejrzenia własnego profilu", async () => {
    // Inaczej licznik „kto oglądał mój profil" pokazywałby samego
    // zainteresowanego przy każdym wejściu na własną stronę.
    h.user = { id: "expert-1" };
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.recordedViews).toEqual([]);
  });
});

describe("komponent - widoczność sekcji z ustawień layoutu", () => {
  it("wszystkie sekcje włączone: hub montuje pełny zestaw organizmów", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.getByTestId("ExpertHubDetails")).toBeTruthy();
    expect(screen.getByTestId("ExpertMaterialsExplorer")).toBeTruthy();
    expect(screen.getByTestId("AuthorCvSections")).toBeTruthy();
  });

  it.each(["details", "materials", "cv"])(
    "sekcja %s wyłączona w ustawieniach NIE renderuje się",
    async (section) => {
      h.visibleSections.delete(section);
      const map: Record<string, string> = {
        details: "ExpertHubDetails",
        materials: "ExpertMaterialsExplorer",
        cv: "AuthorCvSections",
      };
      await mount();
      await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
      expect(screen.queryByTestId(map[section])).toBeNull();
    },
  );

  it("HERO renderuje się ZAWSZE - to jest wizytówka strony", async () => {
    // Ustawienia mogą schować każdą sekcję pod hero, ale nie samo hero:
    // strona bez niego nie mówi nawet, czyj to profil.
    h.visibleSections.clear();
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
  });

  it("odznaka „ekspert” pojawia się tylko dla eksperta", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("expert.expertBadge")).toBeTruthy());
    cleanup();

    h.hub = hub({ expert: { is_expert: false } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByText("expert.expertBadge")).toBeNull();
  });

  it("odznaka „zweryfikowany” nie dubluje się z datą weryfikacji", async () => {
    // Profil z `verified_at` ma już znacznik w hero; druga taka odznaka obok
    // wyglądałaby jak dwie różne weryfikacje.
    await mount();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    expect(h.organism.ProfileBadges?.badges).toEqual(["speaker"]);
  });

  it("profil BEZ daty weryfikacji zachowuje odznakę z katalogu", async () => {
    h.hub = hub({ expert: { verified_at: null } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    expect(h.organism.ProfileBadges?.badges).toEqual(["verified", "speaker"]);
  });
});

describe("loader - layout tenanta z jednego round-tripu", () => {
  it("layout PRZYSZEDŁ z RPC: trasa NIE dokłada drugiego zapytania", async () => {
    // Sedno jest wydajnościowe: layout jedzie w tym samym `get_expert_hub`,
    // więc doklejanie sekwencyjnego odczytu na krytycznej ścieżce TTFB byłoby
    // regresem widocznym w LCP najcięższej trasy publicznej.
    h.hub = hub({ layoutSettings: { tenant_id: "tenant-1", accent_color: "#0055aa" } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.layoutFetches).toBe(0);
    expect(h.organism.ExpertLayoutHero?.settings).toMatchObject({ accent_color: "#0055aa" });
  });

  it("POTWIERDZONY BRAK wiersza (`null`) daje DEFAULTY TENANTA, też bez zapytania", async () => {
    // `null` z RPC to wiedza, a nie brak wiedzy: tenant nie ma zapisanego
    // layoutu. Drugie zapytanie zwróciłoby dokładnie te same defaulty.
    h.hub = hub({ layoutSettings: null });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.layoutFetches).toBe(0);
    expect(h.organism.ExpertLayoutHero?.settings).toMatchObject({
      tenant_id: "tenant-1",
      default_preset: "classic",
    });
  });

  it("ŚCIEŻKA LEGACY (brak layoutu w ładunku) dociąga go osobnym zapytaniem", async () => {
    // `layoutSettings === undefined` to wynik fallbacku wdrożeniowego
    // (`fetchExpertHubLegacy` nie zwraca tego pola). Profil ma się wtedy
    // wyrenderować z layoutem, a nie bez niego.
    h.hub = hub({ layoutSettings: undefined });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.layoutFetches).toBe(1);
  });

  it("STAN FAKTYCZNY: awaria layoutu w ścieżce legacy zjada CAŁY profil", async () => {
    // Loader wycisza tę awarię świadomie („layout to dekoracja"), ale
    // komponent czyta ten sam klucz przez `useSuspenseQuery`, więc błąd
    // z cache wraca w renderze i wywraca trasę do ekranu błędu. Test opisuje
    // to, co jest; życzenie stoi niżej jako `it.fails`.
    h.hub = hub({ layoutSettings: undefined });
    h.layoutFail = true;
    await mount();
    await waitFor(() => expect(screen.getByTestId("RouteErrorFallback")).toBeTruthy());
    expect(h.organism.RouteErrorFallback?.title).toBe("Nie udało się załadować profilu");
  });

  it("ekran błędu mówi w języku ADRESU, nie instancji i18n", async () => {
    // Ta sama zasada, co w `head()`: instancja i18next jest współdzielona
    // między równoległymi żądaniami SSR, więc język bierze się z URL-a.
    h.hub = hub({ layoutSettings: undefined });
    h.layoutFail = true;
    h.requestUrl = "/en/author/anna-kowalska";
    await mount();
    await waitFor(() => expect(screen.getByTestId("RouteErrorFallback")).toBeTruthy());
    expect(h.organism.RouteErrorFallback?.title).toBe("Failed to load the profile");
  });

  it.fails("DEFEKT: awaria layoutu nie powinna wywracać profilu", async () => {
    // ŻYCZENIE, nie stan faktyczny - i dlatego `it.fails`. Loader ma na tę
    // awarię jawne `catch(() => undefined)` z komentarzem „Layout to dekoracja
    // - jego awaria nie może wywrócić całego profilu", ale komponent czyta ten
    // sam klucz przez `useSuspenseQuery` i błąd z cache wraca w renderze.
    //
    // KONSEKWENCJA: w oknie między deployem kodu a migracją `get_expert_hub`
    // (jedyna ścieżka, w której layout leci osobnym zapytaniem) jedno padnięte
    // zapytanie o DEKORACJĘ zamienia indeksowany profil eksperta w ekran błędu.
    // Naprawa to `useQuery` z defaultami tenanta zamiast `useSuspenseQuery`
    // albo zasianie defaultów w gałęzi `catch` loadera - nie zmiana testu.
    h.hub = hub({ layoutSettings: undefined });
    h.layoutFail = true;
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
  });
});

describe("loader - domykanie równoległej gałęzi materiałów", () => {
  // Materiały startują RÓWNOLEGLE z tożsamością. Gdy tożsamość kończy bieg
  // wcześniej (degradacja albo 404), nikt już nie czeka na tamtą obietnicę -
  // bez jawnego `catch` jej odrzucenie leci jako unhandled rejection i na
  // serwerze potrafi zabić cały isolate, a nie tylko to jedno żądanie.
  it("DEGRADACJA z padniętymi materiałami: nadal HTTP 200 z komunikatem", async () => {
    h.degraded = true;
    h.materialsFail = true;
    await mount();
    await waitFor(() => expect(screen.getByTestId("DegradedDataNotice")).toBeTruthy());
    expect(h.cacheHeaders.at(-1)).toContain("no-store");
  });

  it("404 z padniętymi materiałami: nadal czysty 404", async () => {
    h.hub = null;
    h.materialsFail = true;
    await mount();
    await waitFor(() => expect(screen.getByTestId("PublicNotFound")).toBeTruthy());
    expect(h.cacheHeaders.at(-1)).toContain("no-store");
  });
});

describe("head - adres absolutny w żądaniu", () => {
  // Żądanie z pełnym adresem (proxy, podgląd społecznościowy, subdomena
  // tenanta) NIE może dać kanonicznego względnego: scraper czyta wtedy
  // odnośnik względem SWOJEGO hosta.
  const ABSOLUTE = "https://neweuropeanstrategies.com/en/author/anna-kowalska?page=3&kind=article";

  it("kanoniczny zostaje ABSOLUTNY, ale bez parametrów eksploratora", () => {
    h.requestUrl = ABSOLUTE;
    expect(canonical(headFor(loaded(3, true)))).toBe(
      "https://neweuropeanstrategies.com/en/author/anna-kowalska",
    );
  });

  it("okruszki dostają PEŁNE adresy, gdy kanoniczny jest absolutny", () => {
    // Względne `item` w BreadcrumbList jest dla Google poprawne, ale w
    // ładunku absolutnym niespójne - trasa trzyma jedną konwencję na raz.
    h.requestUrl = ABSOLUTE;
    const [, breadcrumb] = jsonLd(headFor(loaded()));
    const items = breadcrumb.itemListElement as { item?: string }[];
    expect(items[0]?.item).toBe("https://neweuropeanstrategies.com");
    expect(items[1]?.item).toBe("https://neweuropeanstrategies.com/experts");
  });
});

describe("head - warianty bio i tożsamości", () => {
  it("EN bez bio angielskiego spada na POLSKIE - lepsze niż pustka w SERP", () => {
    // Kolejność jest celowa: pełne bio w języku strony, potem punktor, potem
    // to samo w drugim języku. Pusty `description` to utrata snippetu.
    h.requestUrl = "/en/author/anna-kowalska";
    const result = headFor({
      ...loaded(),
      hub: hub({
        expert: { full_bio_en: "", bio_en: "", full_bio_pl: "", bio_pl: "Tylko polska nota." },
      }),
    });
    expect(metaByName(result, "description")).toBe("Tylko polska nota.");
  });

  it("PL bez bio polskiego spada na ANGIELSKIE - symetrycznie", () => {
    const result = headFor({
      ...loaded(),
      hub: hub({
        expert: { full_bio_pl: "", bio_pl: "", full_bio_en: "", bio_en: "English note only." },
      }),
    });
    expect(metaByName(result, "description")).toBe("English note only.");
  });

  it("pełne bio ma PIERWSZEŃSTWO nad krótkim punktorem", () => {
    const result = headFor({
      ...loaded(),
      hub: hub({ expert: { full_bio_pl: "Rozbudowana nota.", bio_pl: "Punktor." } }),
    });
    expect(metaByName(result, "description")).toBe("Rozbudowana nota.");
  });

  it("stanowisko BEZ firmy nie zostawia wisiącego separatora", () => {
    const result = headFor({
      ...loaded(),
      hub: hub({ expert: { job_title: "Analityczka", company: null } }),
    });
    expect(title(result)).toBe("Anna Kowalska - Analityczka");
    expect(title(result)).not.toContain("·");
  });

  it("render ZDEGRADOWANY po angielsku ma nazwę zastępczą po angielsku", () => {
    // Zastępcza nazwa też jest treścią widoczną w karcie społecznościowej.
    h.requestUrl = "/en/author/anna-kowalska";
    const result = headFor({
      hub: null,
      degraded: true,
      archiveView: { page: 1, paginated: false },
    });
    expect(title(result)).toBe("Expert");
  });
});

describe("komponent - język widoku", () => {
  it("EN: hub i pasek ekspertyzy idą po angielsku", async () => {
    h.language = "en";
    h.hub = hub({ areas: [{ id: "a1", name_pl: "Energia", name_en: "Energy" }] });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.organism.ExpertLayoutHero?.lang).toBe("en");
    expect(screen.getByText("Energy")).toBeTruthy();
  });

  it("PL: ten sam obszar po polsku", async () => {
    h.hub = hub({ areas: [{ id: "a1", name_pl: "Energia", name_en: "Energy" }] });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.organism.ExpertLayoutHero?.lang).toBe("pl");
    expect(screen.getByText("Energia")).toBeTruthy();
  });

  it("profil BEZ nazwy wyświetlanej dostaje zastępczą w języku widoku", async () => {
    h.hub = hub({ expert: { display_name: null } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ConnectButton")).toBeTruthy());
    expect(h.organism.ConnectButton?.displayName).toBe("Ekspert");
  });

  it("ta sama zastępcza nazwa po angielsku", async () => {
    h.language = "en";
    h.hub = hub({ expert: { display_name: null } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ConnectButton")).toBeTruthy());
    expect(h.organism.ConnectButton?.displayName).toBe("Expert");
  });
});

describe("komponent - profil znikający pod ręką", () => {
  it("gdy odświeżone zapytanie zwróci `null`, hub schodzi do 404 zamiast pustki", async () => {
    // Osiągalne po stronie klienta: `invalidateQueries` po nawigacji miękkiej
    // albo po zniknięciu profilu. `loaderData.degraded` nadal mówi „false",
    // więc bez tego strażnika komponent czytałby `expert` z `null`.
    const view = await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    h.hub = null;
    await act(async () => {
      await view.queryClient.invalidateQueries({ queryKey: ["expert-hub", "anna-kowalska"] });
    });
    await waitFor(() => expect(screen.getByTestId("PublicNotFound")).toBeTruthy());
    expect(screen.queryByTestId("ExpertLayoutHero")).toBeNull();
  });
});

describe("komponent - nadpisania layoutu eksperta", () => {
  it("ZAPISANE nadpisania eksperta wchodzą nad ustawienia tenanta", async () => {
    h.hub = hub({ expert: { layout_overrides: { accent_color: "#ff0055" } } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(h.organism.ExpertLayoutHero?.settings).toMatchObject({ accent_color: "#ff0055" });
  });

  it("DRAFT z inline-edytora wygrywa z zapisanymi nadpisaniami (podgląd na żywo)", async () => {
    // To jest cała wartość edytora na stronie: `settings` liczy się z draftu
    // tym samym `mergeExpertLayout`, więc podgląd == produkcja po zapisie.
    h.user = { id: "expert-1" };
    h.hub = hub({ expert: { layout_overrides: { accent_color: "#ff0055" } } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutInlineEditor")).toBeTruthy());
    expect(h.organism.ExpertLayoutHero?.settings).toMatchObject({ accent_color: "#ff0055" });
    const onDraftChange = draftSetter();
    await act(async () => onDraftChange({ overrides: { accent_color: "#00ccaa" } }));
    await waitFor(() =>
      expect(h.organism.ExpertLayoutHero?.settings).toMatchObject({ accent_color: "#00ccaa" }),
    );
  });

  it("porzucenie draftu wraca do stanu ZAPISANEGO, nie do defaultów", async () => {
    h.user = { id: "expert-1" };
    h.hub = hub({ expert: { layout_overrides: { accent_color: "#ff0055" } } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutInlineEditor")).toBeTruthy());
    const onDraftChange = draftSetter();
    await act(async () => onDraftChange({ overrides: { accent_color: "#00ccaa" } }));
    await act(async () => onDraftChange(null));
    await waitFor(() =>
      expect(h.organism.ExpertLayoutHero?.settings).toMatchObject({ accent_color: "#ff0055" }),
    );
  });
});

describe("komponent - odznaki i identyfikator zakresu stylów", () => {
  it("ODCZYT ODZNAK JESZCZE NIE WRÓCIŁ: lista jest pusta, nie wywala renderu", async () => {
    h.badges = undefined;
    await mount();
    await waitFor(() => expect(screen.getByTestId("ProfileBadges")).toBeTruthy());
    expect(h.organism.ProfileBadges?.badges).toEqual([]);
  });

  it("profil BEZ identyfikatora dostaje zakres zastępczy, nie `expert-`", async () => {
    // Zakres stylów trafia do selektora CSS. `expert-` bez sufiksu zderzałby
    // się z każdym innym profilem bez identyfikatora na tej samej stronie.
    h.hub = hub({ expert: { id: "" } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    const scoped = document.querySelector("[data-pv-scope]");
    expect(scoped?.getAttribute("data-pv-scope")).toBe("expert-default");
  });
});

describe("komponent - przycisk obserwowania w nagłówku", () => {
  it("personalizacja WŁĄCZONA: przycisk obserwowania jest w nagłówku", async () => {
    h.personalized = { followInAuthorHeader: true };
    await mount();
    await waitFor(() => expect(screen.getByTestId("FollowButton")).toBeTruthy());
    expect(h.organism.FollowButton?.targetId).toBe("expert-1");
  });

  it("personalizacja WYŁĄCZONA: przycisku nie ma, a reszta nagłówka zostaje", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("ConnectButton")).toBeTruthy());
    expect(screen.queryByTestId("FollowButton")).toBeNull();
  });
});

describe("komponent - sekcje warunkowane TREŚCIĄ, nie tylko ustawieniami", () => {
  it("sekcja szczegółów potrzebuje TREŚCI: same obszary wystarczą", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertHubDetails")).toBeTruthy());
  });

  it("same PROGRAMY też wystarczą", async () => {
    h.hub = hub({ areas: [], programs: [{ id: "p1", name_pl: "Klimat", name_en: "Climate" }] });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertHubDetails")).toBeTruthy());
  });

  it("sam ADRES KONTAKTOWY też wystarcza", async () => {
    h.hub = hub({ areas: [], programs: [], expert: { contact_email: "anna@example.org" } });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertHubDetails")).toBeTruthy());
  });

  it("sama STRONA WWW też wystarcza", async () => {
    h.hub = hub({
      areas: [],
      programs: [],
      expert: { contact_email: null, website_url: "https://example.org/anna" },
    });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertHubDetails")).toBeTruthy());
  });

  it("PUSTE pola kontaktowe (same spacje) nie robią treści", async () => {
    // Inaczej profil bez ani jednej informacji dostaje pustą sekcję z nagłówkiem.
    h.hub = hub({
      areas: [],
      programs: [],
      expert: { contact_email: "   ", website_url: "  " },
    });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("ExpertHubDetails")).toBeNull();
  });

  it("sekcja prasowa pojawia się dopiero z WZMIANKAMI", async () => {
    expect(h.visibleSections.has("media_mentions")).toBe(true);
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("ExpertInTheNews")).toBeNull();
    cleanup();
    h.hub = hub({ mediaMentions: [{ id: "m1", title: "Wywiad" }] });
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertInTheNews")).toBeTruthy());
  });

  it("pasek podcastu pojawia się dopiero z ODCINKAMI", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("ExpertLayoutHero")).toBeTruthy());
    expect(screen.queryByTestId("PodcastEpisodeStrip")).toBeNull();
    cleanup();
    h.podcasts = [{ id: "e1", title: "Odcinek 1" }];
    await mount();
    await waitFor(() => expect(screen.getByTestId("PodcastEpisodeStrip")).toBeTruthy());
    expect(h.organism.PodcastEpisodeStrip?.episodes).toHaveLength(1);
  });

  it("sekcja CV niesie tożsamość do wydruku - z adresem strony", async () => {
    // `profileUrl` jest brane z `window.location` tylko w przeglądarce; w SSR
    // schodzi na `null`. Tej drugiej gałęzi nie da się osiągnąć w środowisku
    // testowym z DOM-em i nie udajemy, że się da.
    await mount();
    await waitFor(() => expect(screen.getByTestId("AuthorCvSections")).toBeTruthy());
    expect(h.organism.AuthorCvSections?.printIdentity).toMatchObject({
      name: "Anna Kowalska",
      contactEmail: "anna@example.org",
    });
  });
});
