// Katalog osób `/people` ZAMONTOWANY: bramka dostępu, stan w URL-u, fasety,
// tryb semantyczny i karta osoby.
//
// CO TEN PLIK DOWODZI (nazwane po SKUTKU dla użytkownika i dla danych):
//
//  1. KATALOG JEST WEWNĘTRZNY. Anonimowy odwiedzający dostaje bramkę logowania
//     i - to jest sedno - katalog NIE PYTA wtedy o nic. Trasa jest `noindex,
//     nofollow`, bo lista imion i firm zarejestrowanych osób nie jest treścią
//     publiczną.
//  2. STAN ŻYJE W ADRESIE. Fraza i każdy filtr trafiają do URL-a, więc widok
//     da się udostępnić linkiem i ZAPISAĆ. Bez tego nie istnieje alert
//     „dołączył ktoś, kogo szukasz" (encja `people` w `saved_searches`), bo nie
//     ma czego zapisać. Fraza idzie tam z opóźnieniem, ale filtr od razu.
//  3. PUSTKA, ŁADOWANIE I AWARIA TO TRZY OSOBNE EKRANY, a pustka mówi TRZY
//     różne rzeczy: „katalog jest pusty", „nic nie pasuje do frazy", „nic nie
//     pasuje do filtrów". Ostatni przypadek jako jedyny proponuje wyczyszczenie
//     filtrów - bo tylko tam użytkownik ma co wyczyścić.
//  4. JEDNO ZAPYTANIE NA PARTIĘ, NIE NA KARTĘ. Odznaki i statusy sieci
//     kontaktów są batchowane; przy wyłączonym module kontaktów RPC statusów nie
//     dostaje ANI JEDNEGO identyfikatora.
//  5. TRYB SEMANTYCZNY JEST JAWNYM WYBOREM i ma własny stan degradacji: bramka
//     embeddingów bez odpowiedzi musi to POWIEDZIEĆ, a nie po cichu pokazać
//     wyniki trigramowe jako semantyczne.
//  6. WIDOCZNOŚĆ WŁASNEGO PROFILU jest przełączana z tego samego ekranu, na
//     którym widać skutek - z potwierdzeniem i z komunikatem o niepowodzeniu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//  * ATOMÓW KATALOGU: `peopleEmptyKey`, `peopleFiltersFromSearch` i `seekingText`
//    mają tabele przypadków w `src/components/people/atoms/__tests__/peopleAtoms.test.ts`.
//  * GRAMATYKI ADRESU: `parsePeopleSearchParams`, `hasPeopleFacetFilters`,
//    `isPeopleSearchSaveable` i `clearedPeopleFacets` mają
//    `src/lib/profile/__tests__/peopleSearchParams.test.ts`. Tutaj dowodzimy,
//    że trasa jest do nich PODPIĘTA i respektuje ich wynik.
//  * WARSTWY DANYCH: `usePeopleDirectory` / `usePeopleFacets` (w tym blend
//    semantyczny liczony po stronie bazy), `useConnectionStatuses`,
//    `useBadgesForUsers` i `useDiscoverable` są tu ATRAPAMI - przedmiotem
//    dowodu jest reakcja trasy na ich stany, nie ich kontrakt z bazą.
//  * AUTORYTETU: `search_people`, `people_filter_options` i `connection_statuses`
//    są SECURITY DEFINER i odrzucają anonima. Mają pgTAP i `check:rpc-contract`;
//    atrapa nie odtwarza ich reguł.
//  * ORGANIZMÓW SĄSIEDNICH: `SavedSearchesPanel`, `MessageOrConnectButton`,
//    `ProfileLinkButton`, `ConnectionPathTrail` i `ChatAvatar` to atrapy-markery
//    z własnymi testami; tutaj sprawdzamy WYŁĄCZNIE propsy, które trasa im daje.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { PROFILE_INTENT_CODES } from "@/lib/profile/intents";
import type { PeopleFacets } from "@/lib/chat/usePeopleDirectory";
import type { ConnectionState } from "@/lib/network/useConnections";
import type { ProfileBadgeKind } from "@/lib/profile/badges";
import { axeViolations, summarize } from "@/test/axe";

/** Wiersz `search_people` w zakresie kolumn, które czyta karta osoby. */
interface PersonRow {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string;
  job_title: string;
  current_company: string;
  specialization: string;
  location: string;
  seeking_pl: string;
  seeking_en: string;
  open_to: string[];
  verified: boolean;
  match_score: number;
  completeness_score: number;
  total_count: number;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  session: null as { id: string } | null,
  authLoading: false,

  /** `null` = fasety jeszcze nie przyszły (selecty nie mają czego pokazać). */
  facets: null as PeopleFacets | null,
  /** Strony wyników; `null` = zapytanie w locie. */
  pages: null as PersonRow[][] | null,
  peopleLoading: false,
  peopleError: false,
  hasNextPage: false,
  fetchingNextPage: false,
  nextPageCalls: 0,
  refetchCalls: 0,
  semanticActive: false,
  semanticUnavailable: false,
  /** Pary (fraza, filtry), z jakimi trasa zawołała katalog. */
  directoryCalls: [] as { query: string; semantic: boolean; verifiedOnly: boolean }[],

  online: [] as string[],
  badges: null as Map<string, ProfileBadgeKind[]> | null,
  /** `null` = statusy sieci jeszcze nie przyszły (kart bez przycisku akcji). */
  connections: null as Map<string, ConnectionState> | null,
  /** Identyfikatory, o które trasa zapytała RPC statusów. */
  connectionCalls: [] as ReadonlyArray<string>[],
  connectionsEnabled: true,
  pendingInvites: 0,

  /** `undefined` = odczyt widoczności nie oddał wartości (np. świeży cache). */
  discoverable: false as boolean | undefined,
  discoverableLoading: false,
  setDiscoverablePending: false,
  discoverableWrites: [] as boolean[],
  /** Czy zapis widoczności ma się udać - dwie różne ścieżki komunikatu. */
  discoverableFails: false,

  toasts: [] as { kind: "success" | "error"; key: string }[],
  /** Propsy, jakie trasa podała panelowi zapisanych wyszukiwań. */
  savedPanel: [] as { entity: string; canSave: boolean; current: Record<string, unknown> }[],
  /** Uchwyt do wywołania „przywróć zapisane wyszukiwanie" z atrapy panelu. */
  applySaved: null as ((params: Record<string, unknown>) => void) | null,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Karta osoby czyta język renderu przez `currentLang()`, a nie przez
// `useTranslation()` - a ta funkcja jest izomorficzna i w środowisku testowym
// wchodzi w gałąź serwerową, która bez kontekstu żądania zawsze oddaje język
// domyślny. Bez tej podmiany dwujęzyczności karty NIE DA SIĘ w ogóle wywołać.
vi.mock("@/lib/i18n/localeRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));

vi.mock("@/lib/i18n-chat", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => undefined }));
vi.mock("@/lib/i18n-profile-intent", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  // Karty linkują do `/author/$slug`, `/contributors` i `/network` - tras, których
  // w drzewie testowym nie ma. Zaślepka daje prawdziwy `<a href>` z podstawionymi
  // parametrami, więc asercje czytają DOCELOWY adres profilu.
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.session, session: h.session, loading: h.authLoading }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (key: string) => h.toasts.push({ kind: "success", key }),
    error: (key: string) => h.toasts.push({ kind: "error", key }),
  },
}));

vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => new Set(h.online) }));

vi.mock("@/lib/chat/useDiscoverable", () => ({
  useDiscoverable: () => ({ data: h.discoverable, isLoading: h.discoverableLoading }),
  useSetDiscoverable: () => ({
    isPending: h.setDiscoverablePending,
    mutate: (next: boolean, handlers: { onSuccess: () => void; onError: () => void }) => {
      h.discoverableWrites.push(next);
      if (h.discoverableFails) handlers.onError();
      else handlers.onSuccess();
    },
  }),
}));

vi.mock("@/lib/community/useCommunityModules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/community/useCommunityModules")>();
  const { COMMUNITY_MODULES_DEFAULTS } = await import("@/lib/community/modulesSettings");
  return {
    ...actual,
    useCommunityModules: () => ({
      ...COMMUNITY_MODULES_DEFAULTS,
      connections_enabled: h.connectionsEnabled,
    }),
  };
});

vi.mock("@/lib/counters/usePendingCounters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/counters/usePendingCounters")>()),
  useUserCounter: () => h.pendingInvites,
}));

vi.mock("@/lib/network/useConnections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/network/useConnections")>()),
  useConnectionStatuses: (userIds: ReadonlyArray<string>) => {
    h.connectionCalls.push(userIds);
    return { data: h.connections };
  },
}));

vi.mock("@/lib/profile/badges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profile/badges")>()),
  useBadgesForUsers: () => ({ data: h.badges }),
}));

vi.mock("@/lib/chat/usePeopleDirectory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/usePeopleDirectory")>()),
  usePeopleFacets: () => ({ data: h.facets }),
  usePeopleDirectory: (query: string, filters: { semantic: boolean; verifiedOnly: boolean }) => {
    h.directoryCalls.push({
      query,
      semantic: filters.semantic,
      verifiedOnly: filters.verifiedOnly,
    });
    return {
      people: {
        data: h.pages === null ? undefined : { pages: h.pages },
        isLoading: h.peopleLoading,
        isError: h.peopleError,
        hasNextPage: h.hasNextPage,
        isFetchingNextPage: h.fetchingNextPage,
        fetchNextPage: () => {
          h.nextPageCalls += 1;
          return Promise.resolve();
        },
        refetch: () => {
          h.refetchCalls += 1;
          return Promise.resolve();
        },
      },
      semanticActive: h.semanticActive,
      semanticUnavailable: h.semanticUnavailable,
    };
  },
}));

vi.mock("@/components/search/SavedSearchesPanel", () => ({
  SavedSearchesPanel: (props: {
    entity: string;
    canSave: boolean;
    current: Record<string, unknown>;
    onApply: (params: Record<string, unknown>) => void;
  }) => {
    h.savedPanel.push({ entity: props.entity, canSave: props.canSave, current: props.current });
    h.applySaved = props.onApply;
    return <div data-testid="zapisane-wyszukiwania" data-can-save={String(props.canSave)} />;
  },
}));

vi.mock("@/components/network/MessageOrConnectButton", () => ({
  MessageOrConnectButton: (props: { userId: string }) => (
    <div data-testid="akcja-kontaktu" data-user={props.userId} />
  ),
}));
vi.mock("@/components/network/ProfileLinkButton", () => ({
  ProfileLinkButton: (props: { slug: string }) => (
    <div data-testid="skrot-profilu" data-slug={props.slug} />
  ),
}));
vi.mock("@/components/chat/ChatAvatar", () => ({
  ChatAvatar: (props: { name: string; online: boolean }) => (
    <div data-testid="awatar" data-name={props.name} data-online={String(props.online)} />
  ),
}));
vi.mock("@/components/network/molecules/ConnectionPathTrail", () => ({
  ConnectionPathTrail: (props: { degree: number }) => (
    <div data-testid="sciezka-kontaktu" data-degree={String(props.degree)} />
  ),
}));

const { renderRoute, routeMeta, routeSearchValidator } = await import("@/test/routeHarness");
const { Route: PeopleRoute } = await import("@/routes/people");
const { NO_CONNECTION } = await import("@/lib/network/useConnections");

function person(id: string, overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id,
    display_name: `Osoba ${id}`,
    slug: `osoba-${id}`,
    avatar_url: "",
    job_title: "",
    current_company: "",
    specialization: "",
    location: "",
    seeking_pl: "",
    seeking_en: "",
    open_to: [],
    verified: false,
    match_score: 1,
    completeness_score: 50,
    total_count: 1,
    ...overrides,
  };
}

async function mount(entry = "/people") {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({ route: PeopleRoute, path: "/people", initialEntry: entry });
  });
  return view;
}

/** Wybór wartości w fasecie Radix Select (klawiatura otwiera listę). */
async function pickFacet(ariaLabel: string, optionName: string | RegExp) {
  const trigger = screen.getByRole("combobox", { name: ariaLabel });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: optionName }));
  });
}

beforeEach(() => {
  // Tylko `Date`: liczniki React Query i `waitFor` zostają na prawdziwym zegarze.
  // Testy debounce'u dokładają `setTimeout` u siebie - patrz ich komentarze.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  h.lang = "pl";
  h.session = { id: "u1" };
  h.authLoading = false;
  h.facets = null;
  h.pages = [[person("p1")]];
  h.peopleLoading = false;
  h.peopleError = false;
  h.hasNextPage = false;
  h.fetchingNextPage = false;
  h.nextPageCalls = 0;
  h.refetchCalls = 0;
  h.semanticActive = false;
  h.semanticUnavailable = false;
  h.directoryCalls = [];
  h.online = [];
  h.badges = null;
  h.connections = null;
  h.connectionCalls = [];
  h.connectionsEnabled = true;
  h.pendingInvites = 0;
  h.discoverable = false;
  h.discoverableLoading = false;
  h.setDiscoverablePending = false;
  h.discoverableWrites = [];
  h.discoverableFails = false;
  h.toasts = [];
  h.savedPanel = [];
  h.applySaved = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("/people - kontrakt adresu i nagłówka", () => {
  it("katalog osób NIE jest indeksowalny ani przechodzony przez crawlera", async () => {
    // Lista imion, firm i lokalizacji zarejestrowanych osób nie jest treścią
    // publiczną - `nofollow` domyka też linki do profili.
    const meta = await routeMeta(PeopleRoute);
    expect(meta).toEqual([{ title: "Osoby" }, { name: "robots", content: "noindex, nofollow" }]);
  });

  it("trasa używa TEGO SAMEGO walidatora, co przywracanie zapisanego wyszukiwania", async () => {
    // Jeden model stanu dla adresu w przeglądarce i dla snapshotu z bazy -
    // inaczej przywrócony zapis dawałby inny wynik niż link.
    const validate = routeSearchValidator(PeopleRoute);
    expect(validate({ q: "  energia  ", verified: "true", sem: "1", open: "consortium" })).toEqual({
      q: "energia",
      specialization: undefined,
      company: undefined,
      location: undefined,
      role: undefined,
      open: "consortium",
      verified: "1",
      sem: "1",
    });
  });
});

describe("/people - bramka dostępu", () => {
  it("anonimowy odwiedzający dostaje bramkę i NIE uruchamia żadnego zapytania", async () => {
    // RPC katalogu odrzuca anonima, ale sam fakt zapytania to zapalone liczniki
    // w logach i niepotrzebny round-trip na każdym wejściu bota.
    //
    // TEN TEST USTALA TEŻ NIEOSIĄGALNOŚĆ obrony `if (!user) return null;`
    // (`src/routes/people.tsx` linia 394). `AuthGate`
    // (`src/components/profile/AuthGate.tsx` linie 31-42) wpuszcza wnętrze
    // WYŁĄCZNIE przy istniejącej sesji, a `useAuth` wyprowadza `user` z tej
    // samej sesji (`src/hooks/useAuth.tsx` linia 183: `user: session?.user ?? null`),
    // więc para „sesja jest, użytkownika nie ma" nie powstaje. Tej gałęzi nie
    // farmujemy sztucznym renderem `PeopleInner` w oderwaniu od bramki - to
    // dowodziłoby wyłącznie tego, że test umie rozmontować gwarancję trasy.
    h.session = null;
    await mount();
    expect(screen.getByText("people.membersOnlyBody")).toBeTruthy();
    expect(h.directoryCalls).toEqual([]);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("dopóki sesja się rozstrzyga, widać wskaźnik pracy, a nie bramkę", async () => {
    // Mignięcie bramką logowania u ZALOGOWANEGO jest gorsze niż moment czekania.
    h.session = null;
    h.authLoading = true;
    const view = await mount();
    expect(view.container.querySelector('[aria-label="loading"]')).not.toBeNull();
    expect(screen.queryByText("people.membersOnlyBody")).toBeNull();
  });
});

describe("/people - karta osoby", () => {
  it("karta niesie nazwisko, rolę, firmę, specjalizację i lokalizację", async () => {
    h.pages = [
      [
        person("p1", {
          display_name: "Anna Nowak",
          job_title: "Dyrektorka",
          current_company: "Instytut",
          specialization: "Energetyka",
          location: "Warszawa",
        }),
      ],
    ];
    await mount();
    expect(screen.getByRole("link", { name: "people.viewProfile: Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/osoba-p1",
    );
    expect(screen.getByText("Dyrektorka - Instytut")).toBeTruthy();
    expect(screen.getByText("Energetyka")).toBeTruthy();
    expect(screen.getByText("Warszawa")).toBeTruthy();
  });

  it("INTENCJA („po co się kontaktować”) jest widoczna w języku renderu", async () => {
    h.pages = [[person("p1", { seeking_pl: "Szukam partnera do konsorcjum", seeking_en: "" })]];
    await mount();
    expect(screen.getByText("Szukam partnera do konsorcjum")).toBeTruthy();

    cleanup();
    h.lang = "en";
    h.pages = [[person("p1", { seeking_pl: "PL", seeking_en: "Looking for a consortium" })]];
    await mount();
    expect(screen.getByText("Looking for a consortium")).toBeTruthy();
  });

  it("chipy intencji renderują się z kodów, a nie z tekstu z bazy", async () => {
    // Etykiety intencji mieszkają w i18n; baza trzyma wyłącznie kody, więc
    // dodanie języka nie wymaga migracji danych.
    h.pages = [[person("p1", { open_to: ["hiring", "consortium", "nieznany-kod"] })]];
    await mount();
    const lista = screen.getByRole("list", { name: "profileIntent.openToLabel" });
    // Kolejność KATALOGOWA, nie kolejność zapisu w bazie.
    expect(within(lista).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("profileIntent.openToShort.consortium")).toBeTruthy();
    expect(screen.getByText("profileIntent.openToShort.hiring")).toBeTruthy();
  });

  it("osoba BEZ publicznego profilu nie dostaje odnośnika ani skrótu do profilu", async () => {
    // Link w nikąd jest gorszy niż jego brak.
    h.pages = [[person("p1", { slug: "", display_name: "Bez Profilu" })]];
    await mount();
    expect(screen.getByText("Bez Profilu")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /people\.viewProfile/ })).toBeNull();
    expect(screen.queryByTestId("skrot-profilu")).toBeNull();
  });

  it("obecność online idzie do awatara z jednej, wspólnej subskrypcji", async () => {
    h.pages = [[person("p1"), person("p2")]];
    h.online = ["p2"];
    await mount();
    const awatary = screen.getAllByTestId("awatar");
    expect(awatary.map((a) => a.getAttribute("data-online"))).toEqual(["false", "true"]);
  });

  it("BEZ mapy statusów karta nie pokazuje akcji kontaktu ani ścieżki", async () => {
    // Bez tego każda karta odpytywałaby o swój status osobno.
    h.connections = null;
    await mount();
    expect(screen.queryByTestId("akcja-kontaktu")).toBeNull();
    expect(screen.queryByTestId("sciezka-kontaktu")).toBeNull();
  });

  it("status z partii dokłada akcję kontaktu, stopień i wspólne kontakty", async () => {
    h.pages = [[person("p1"), person("p2")]];
    h.connections = new Map([
      ["p1", { ...NO_CONNECTION, degree: 2, mutualCount: 3, bridge: null }],
    ]);
    await mount();
    expect(screen.getAllByTestId("akcja-kontaktu")).toHaveLength(2);
    // Osoba bez wpisu w mapie dostaje stan „brak relacji", nie brak przycisku.
    expect(
      screen.getAllByTestId("sciezka-kontaktu").map((el) => el.getAttribute("data-degree")),
    ).toEqual(["2", "0"]);
    expect(screen.getByText("network.mutual(count=3)")).toBeTruthy();
  });

  it("odznaki zaufania przychodzą jedną mapą dla całej widocznej partii", async () => {
    h.badges = new Map([["p1", ["expert"]]]);
    await mount();
    expect(screen.getByTestId("awatar")).toBeTruthy();
    expect(h.connectionCalls.at(-1)).toEqual(["p1"]);
  });
});

describe("/people - stany listy", () => {
  it("nagłówek licznika pokazuje WIDOCZNE z CAŁOŚCI", async () => {
    h.pages = [[person("p1", { total_count: 42 }), person("p2", { total_count: 42 })]];
    await mount();
    expect(screen.getByText("people.shownOfTotal(shown=2,total=42)")).toBeTruthy();
  });

  it("gdy pierwsza strona nie niesie licznika, całość = to, co widać", async () => {
    // Licznik `total_count` przychodzi w PIERWSZYM wierszu pierwszej strony.
    // Gdy tej informacji nie ma, jedyną prawdą, jaką znamy, jest liczba
    // pobranych kart - lepsza niż „1 z 0", które wygląda na błąd danych.
    h.pages = [[], [person("p1")]];
    await mount();
    expect(screen.getByText("people.shownOfTotal(shown=1,total=1)")).toBeTruthy();
  });

  it("ten sam rekord z dwóch stron jest jedną kartą", async () => {
    // Okno offsetowe przesuwa się przy nowych rejestracjach, więc powtórka
    // między stronami jest normalna - podwójna karta nie jest.
    h.pages = [
      [person("p1"), person("p2")],
      [person("p2"), person("p3")],
    ];
    await mount();
    expect(screen.getAllByTestId("awatar")).toHaveLength(3);
  });

  it("ŁADOWANIE rezerwuje miejsce szkieletem, zamiast przesuwać stronę", async () => {
    h.peopleLoading = true;
    h.pages = null;
    const view = await mount();
    expect(view.container.querySelectorAll(".animate-pulse")).toHaveLength(6);
    // W trakcie ładowania licznik milczy - „0 z 0" byłoby nieprawdą.
    expect(screen.queryByText(/people\.shownOfTotal/)).toBeNull();
  });

  it("AWARIA mówi o niej wprost i daje ponowienie, a nie pustą listę", async () => {
    // „Nikogo nie znaleźliśmy" na awarii RPC to nieprawda o danych.
    h.peopleError = true;
    h.pages = null;
    await mount();
    expect(screen.getByText("people.loadError")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "people.retry" }));
    });
    expect(h.refetchCalls).toBe(1);
    expect(screen.queryByText(/people\.empty/)).toBeNull();
  });

  it("PUSTY katalog, PUSTA fraza i PUSTY filtr to trzy różne komunikaty", async () => {
    h.pages = [[]];
    await mount();
    expect(screen.getByText("people.emptyDirectory")).toBeTruthy();
    // Bez filtrów nie ma czego czyścić.
    expect(screen.queryByRole("button", { name: "people.clearFilters" })).toBeNull();

    cleanup();
    await mount("/people?q=energia");
    expect(screen.getByText("people.empty")).toBeTruthy();

    cleanup();
    await mount("/people?specialization=Energetyka");
    expect(screen.getByText("people.emptyFiltered")).toBeTruthy();
  });

  it("pusty wynik Z FILTREM daje przycisk, który KASUJE filtry z adresu", async () => {
    h.pages = [[]];
    const view = await mount("/people?specialization=Energetyka&q=energia");
    const [wyczysc] = screen.getAllByRole("button", { name: "people.clearFilters" });
    await act(async () => {
      fireEvent.click(wyczysc);
    });
    expect(view.search().specialization).toBeUndefined();
    // Fraza NIE jest filtrem fasetowym - zostaje.
    expect(view.search()).toMatchObject({ q: "energia" });
  });

  it("„pokaż więcej” pojawia się tylko wtedy, gdy jest co pokazać", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: "people.showMore" })).toBeNull();

    cleanup();
    h.hasNextPage = true;
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "people.showMore" }));
    });
    expect(h.nextPageCalls).toBe(1);
  });

  it("w trakcie dociągania przycisk jest zablokowany i mówi o pracy", async () => {
    h.hasNextPage = true;
    h.fetchingNextPage = true;
    await mount();
    expect(screen.getByRole("button", { name: "people.loadingMore" })).toBeDisabled();
  });
});

describe("/people - stan w ADRESIE, nie w komponencie", () => {
  it("fraza z adresu wchodzi do pola i do zapytania", async () => {
    await mount("/people?q=energia");
    expect(screen.getByRole("searchbox")).toHaveValue("energia");
    expect(h.directoryCalls.at(-1)?.query).toBe("energia");
  });

  it("wpisana fraza ląduje w ADRESIE po opóźnieniu, nie na każdy znak", async () => {
    // Bez opóźnienia każde wciśnięcie klawisza tworzyłoby wpis w historii
    // i osobny klucz zapytania. Zegar jest tu ATRAPĄ - test nie czeka realnych
    // 250 ms i nie zależy od szybkości maszyny.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
    const view = await mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ener" } });
    await act(async () => {
      vi.advanceTimersByTime(240);
    });
    expect(view.search().q).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(view.search()).toMatchObject({ q: "ener" });
  });

  it("wyczyszczenie pola USUWA frazę z adresu, zamiast zostawiać puste `?q=`", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
    const view = await mount("/people?q=energia");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "   " } });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(view.search().q).toBeUndefined();
  });

  it("fraza identyczna z adresem NIE zleca kolejnej nawigacji", async () => {
    // Inaczej powrót „wstecz" wpadałby w pętlę: adres -> stan -> adres.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
    const view = await mount("/people?q=energia");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "energia" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(view.currentPath()).toBe("/people");
    expect(view.search()).toMatchObject({ q: "energia" });
  });

  it("przełącznik „tylko zweryfikowani” ląduje w adresie i w filtrach zapytania", async () => {
    const view = await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "people.verifiedOnly" }));
    });
    expect(view.search()).toMatchObject({ verified: "1" });
    expect(h.directoryCalls.at(-1)?.verifiedOnly).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "people.verifiedOnly" }));
    });
    expect(view.search().verified).toBeUndefined();
  });

  it("panel zapisanych wyszukiwań dostaje encję `people` i AKTUALNY stan adresu", async () => {
    const view = await mount("/people?q=energia");
    expect(h.savedPanel.at(-1)).toMatchObject({ entity: "people", canSave: true });
    expect(h.savedPanel.at(-1)?.current).toMatchObject({ q: "energia" });

    // Przywrócenie zapisu przechodzi przez TEN SAM walidator, co adres.
    await act(async () => {
      h.applySaved?.({ specialization: "Energetyka", verified: "true", q: "  klimat  " });
    });
    expect(view.search()).toMatchObject({
      specialization: "Energetyka",
      verified: "1",
      q: "klimat",
    });
  });

  // FLAGI Z ADRESU NIE WRACAJĄ (defekt zachowania, nie testu).
  //
  // PLIKI I LINIE:
  //   * `src/lib/profile/peopleSearchParams.ts` linie 49-51 - `flag()` uznaje
  //     wyłącznie `"1"` (string), `true` i `"true"`;
  //   * `src/routes/people.tsx` linia 99 podpina ten walidator jako
  //     `validateSearch`, a `src/router.tsx` linia 65 tworzy router BEZ własnego
  //     `parseSearch`, czyli z domyślnym `parseSearchWith(JSON.parse)`.
  // MECHANIZM: przełącznik zapisuje `{ verified: "1" }`, router serializuje to
  //   do `?verified=1`, a przy NASTĘPNYM parsowaniu adresu `JSON.parse("1")`
  //   oddaje LICZBĘ `1`. `flag(1)` nie pasuje do żadnego z trzech warunków, więc
  //   zwraca `undefined` - flaga wyparowuje. Sprawdzone pomiarem: mount pod
  //   `/people?verified=1&sem=1&q=energia` daje search `{ q: "energia" }`.
  //   Nawigacja W OBRĘBIE karty tego nie ujawnia, bo tam obiekt search nigdy nie
  //   przechodzi przez string adresu - dlatego defekt jest niewidoczny w kliknięciach.
  // KONSEKWENCJA DLA UŻYTKOWNIKA: udostępniony link, odświeżenie karty i
  //   przycisk „wstecz" MILCZĄCO gubią „tylko zweryfikowani" i tryb semantyczny.
  //   Odbiorca linku widzi INNY zbiór osób niż nadawca i nie ma o tym żadnego
  //   sygnału. To samo dotyczy adresu w powiadomieniu „dołączył ktoś, kogo
  //   szukasz" - komentarz nagłówka trasy wskazuje ten href jako powód, dla
  //   którego parametry są krótkie, więc to jest ścieżka produkcyjna, nie
  //   hipoteza. Filtry TEKSTOWE (`specialization`, `company`, `role`,
  //   `location`, `q`, `open`) wracają poprawnie - traci się dokładnie te dwie
  //   flagi, co czyni defekt trudnym do zauważenia w przeglądzie.
  // DLACZEGO NAPRAWA JEST DECYZJĄ DLA CZŁOWIEKA: dwie drogi, obie o szerokim
  //   zasięgu. (a) Rozszerzyć `flag()` o liczbę `1` - ale ten sam walidator
  //   czyta snapshot z `saved_searches`, gdzie flaga jest stringiem, więc trzeba
  //   zdecydować, czy kanoniczną postacią zostaje string, i czy stare zapisy
  //   wymagają migracji. (b) Podać routerowi własny `parseSearch`, który nie
  //   konwertuje liczb - ale wtedy `?page=2` na trasach list przestaje być
  //   liczbą i zmienia się kontrakt adresu KAŻDEJ trasy w aplikacji. Wybór
  //   między nimi to decyzja o kontrakcie URL-a całego serwisu.
  it.fails("flagi z adresu przetrwają udostępnienie linku i odświeżenie karty", async () => {
    const view = await mount("/people?verified=1&sem=1&q=energia");
    expect(view.search()).toMatchObject({ q: "energia", verified: "1", sem: "1" });
  });

  it("sam tryb semantyczny bez frazy i filtrów NIE jest wart zapisania", async () => {
    // To tylko przełącznik, nie wyszukiwanie - zapis „nic, ale semantycznie"
    // nie ma czego pilnować w alercie.
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "people.semanticMode" }));
    });
    expect(h.savedPanel.at(-1)?.canSave).toBe(false);
    expect(screen.getByTestId("zapisane-wyszukiwania")).toHaveAttribute("data-can-save", "false");
  });
});

describe("/people - fasety", () => {
  it("BEZ opcji z bazy faseta w ogóle się nie renderuje", async () => {
    // Pusta droplista to obietnica filtra, którego nie ma.
    h.facets = null;
    await mount();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("wybór specjalizacji ląduje w adresie i w zapytaniu", async () => {
    h.facets = {
      specialization: [{ value: "Energetyka", cnt: 7 }],
      company: [],
      location: [],
      job_title: [],
      open_to: [],
    };
    const view = await mount();
    await pickFacet("people.filterSpecialization", "Energetyka (7)");
    expect(view.search()).toMatchObject({ specialization: "Energetyka" });
  });

  it("„wszystkie” czyści fasetę, zamiast zapisywać pustą wartość", async () => {
    // Puste `?company=` to osobny wpis w cache'u dla tego samego wyniku.
    h.facets = {
      specialization: [],
      company: [{ value: "Instytut", cnt: 2 }],
      location: [],
      job_title: [],
      open_to: [],
    };
    const view = await mount("/people?company=Instytut");
    await pickFacet("people.filterCompany", "people.allCompanies");
    expect(view.search().company).toBeUndefined();
  });

  it("faseta ROLI zapisuje się w adresie jako `role`, nie jako nazwa kolumny", async () => {
    // Adres trafia do href-a powiadomienia, więc parametry są krótkie.
    h.facets = {
      specialization: [],
      company: [],
      location: [],
      job_title: [{ value: "Dyrektor", cnt: 3 }],
      open_to: [],
    };
    const view = await mount();
    await pickFacet("people.filterJobTitle", "Dyrektor (3)");
    expect(view.search()).toMatchObject({ role: "Dyrektor" });
  });

  it("faseta LOKALIZACJI zapisuje się w adresie", async () => {
    h.facets = {
      specialization: [],
      company: [],
      location: [{ value: "Warszawa", cnt: 5 }],
      job_title: [],
      open_to: [],
    };
    const view = await mount();
    await pickFacet("people.filterLocation", "Warszawa (5)");
    expect(view.search()).toMatchObject({ location: "Warszawa" });
  });

  it("„wszystkie” w KAŻDEJ fasecie kasuje jej parametr z adresu", async () => {
    // Cztery fasety, cztery różne nazwy parametrów - literówka w którejkolwiek
    // daje filtr, którego nie da się wyłączyć inaczej niż ręczną edycją adresu.
    h.facets = {
      specialization: [{ value: "Energetyka", cnt: 7 }],
      company: [],
      location: [{ value: "Warszawa", cnt: 5 }],
      job_title: [{ value: "Dyrektor", cnt: 3 }],
      open_to: [{ value: "consortium", cnt: 4 }],
    };
    const view = await mount(
      "/people?specialization=Energetyka&location=Warszawa&role=Dyrektor&open=consortium",
    );
    await pickFacet("people.filterSpecialization", "people.allSpecializations");
    await pickFacet("people.filterLocation", "people.allLocations");
    await pickFacet("people.filterJobTitle", "people.allJobTitles");
    await pickFacet("people.filterIntent", "people.allIntents");
    expect(view.search()).toMatchObject({
      specialization: undefined,
      location: undefined,
      role: undefined,
      open: undefined,
    });
  });

  it("faseta INTENCJI bierze etykiety z i18n, a licznik z bazy", async () => {
    h.facets = {
      specialization: [],
      company: [],
      location: [],
      job_title: [],
      open_to: [{ value: "consortium", cnt: 4 }],
    };
    const view = await mount();
    await pickFacet("people.filterIntent", "profileIntent.openToShort.consortium (4)");
    expect(view.search()).toMatchObject({ open: "consortium" });
  });

  it("aktywna intencja z adresu jest zaznaczona w fasecie", async () => {
    h.facets = {
      specialization: [],
      company: [],
      location: [],
      job_title: [],
      open_to: [{ value: "mentoring", cnt: 1 }],
    };
    await mount("/people?open=mentoring");
    expect(screen.getByRole("combobox", { name: "people.filterIntent" }).textContent).toContain(
      "profileIntent.openToShort.mentoring",
    );
  });

  it("przy jakimkolwiek filtrze pojawia się czyszczenie NAD listą", async () => {
    h.facets = {
      specialization: [{ value: "Energetyka", cnt: 7 }],
      company: [],
      location: [],
      job_title: [],
      open_to: [],
    };
    const view = await mount("/people?specialization=Energetyka");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "people.clearFilters" })[0]);
    });
    expect(view.search().specialization).toBeUndefined();
  });
});

describe("/people - tryb semantyczny", () => {
  it("przełącznik trybu ląduje w adresie - nie włącza się po cichu", async () => {
    // Zmienia SEMANTYKĘ dopasowania i kosztuje wywołanie bramki AI per fraza.
    const view = await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "people.semanticMode" }));
    });
    expect(view.search()).toMatchObject({ sem: "1" });
    expect(h.directoryCalls.at(-1)?.semantic).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "people.semanticMode" }));
    });
    expect(view.search().sem).toBeUndefined();
  });

  it("wzbogacone wyniki są OZNACZONE, żeby użytkownik wiedział, co widzi", async () => {
    h.semanticActive = true;
    await mount("/people?q=energia");
    expect(screen.getByText("people.semanticActive")).toBeTruthy();
    expect(screen.queryByText("people.semanticUnavailable")).toBeNull();
  });

  it("DEGRADACJA bramki embeddingów jest powiedziana wprost, nie przemilczana", async () => {
    // Wyniki trigramowe podane jako semantyczne to cicha zmiana znaczenia
    // filtra - użytkownik szukałby „po znaczeniu” i dostawał podciągi.
    // Tryb włączamy PRZEŁĄCZNIKIEM, nie adresem: flaga w adresie nie wraca
    // z parsera routera - patrz `it.fails` w opisie stanu adresu.
    h.semanticUnavailable = true;
    await mount("/people?q=energia");
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "people.semanticMode" }));
    });
    expect(screen.getByText("people.semanticUnavailable")).toBeTruthy();
    expect(screen.queryByText("people.semanticActive")).toBeNull();
  });

  it("przy WYŁĄCZONYM trybie ostrzeżenie o bramce się nie pokazuje", async () => {
    h.semanticUnavailable = true;
    await mount();
    expect(screen.queryByText("people.semanticUnavailable")).toBeNull();
  });
});

describe("/people - moduł kontaktów i widoczność profilu", () => {
  it("wyłączony moduł kontaktów zabiera link do sieci i NIE pyta o statusy", async () => {
    h.connectionsEnabled = false;
    await mount();
    expect(screen.queryByText("network.networkLink")).toBeNull();
    expect(h.connectionCalls.at(-1)).toEqual([]);
  });

  it("włączony moduł prowadzi do sieci kontaktów i do tablicy zasług", async () => {
    await mount();
    expect(screen.getByRole("link", { name: /network\.networkLink/ })).toHaveAttribute(
      "href",
      "/network",
    );
    expect(screen.getByRole("link", { name: /community\.reputation\.boardLink/ })).toHaveAttribute(
      "href",
      "/contributors",
    );
  });

  it("oczekujące zaproszenia są policzone przy linku do sieci", async () => {
    h.pendingInvites = 3;
    await mount();
    expect(screen.getByLabelText("network.pendingBadge(count=3)")).toHaveTextContent("3");
  });

  it("zero zaproszeń nie rysuje pustej plakietki", async () => {
    await mount();
    expect(screen.queryByLabelText(/network\.pendingBadge/)).toBeNull();
  });

  it("dopóki widoczność się nie wczytała, pasek się NIE MIGA", async () => {
    h.discoverableLoading = true;
    await mount();
    expect(screen.queryByRole("switch", { name: "profilePrivacy.discoverableLabel" })).toBeNull();
  });

  it("BRAK odpowiedzi o widoczności traktujemy jak profil UKRYTY", async () => {
    // Domyślenie się „widoczny" byłoby domyśleniem się zgody na pokazanie
    // czyjegoś nazwiska w katalogu - w tę stronę pomyłka jest nieodwracalna.
    h.discoverable = undefined;
    await mount();
    expect(screen.getByText("people.discoverBannerTitle")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "profilePrivacy.discoverableLabel" }),
    ).not.toBeChecked();
  });

  it("ukryty profil dostaje inny komunikat niż widoczny", async () => {
    await mount();
    expect(screen.getByText("people.discoverBannerTitle")).toBeTruthy();
    expect(screen.getByText("people.discoverBannerBody")).toBeTruthy();

    cleanup();
    h.discoverable = true;
    await mount();
    expect(screen.getByText("people.discoverBannerOnTitle")).toBeTruthy();
    expect(screen.getByText("people.discoverBannerOnBody")).toBeTruthy();
  });

  it("włączenie widoczności zapisuje się i POTWIERDZA", async () => {
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "profilePrivacy.discoverableLabel" }));
    });
    expect(h.discoverableWrites).toEqual([true]);
    expect(h.toasts).toEqual([{ kind: "success", key: "profilePrivacy.saved" }]);
  });

  it("nieudany zapis widoczności MÓWI o tym - cisza sugerowałaby sukces", async () => {
    h.discoverableFails = true;
    await mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "profilePrivacy.discoverableLabel" }));
    });
    expect(h.toasts).toEqual([{ kind: "error", key: "profilePrivacy.saveError" }]);
  });

  it("w trakcie zapisu przełącznik jest ZABLOKOWANY", async () => {
    // Dwa kliknięcia dałyby dwa sprzeczne zapisy tej samej flagi.
    h.setDiscoverablePending = true;
    await mount();
    expect(screen.getByRole("switch", { name: "profilePrivacy.discoverableLabel" })).toBeDisabled();
  });
});

describe("/people - dostępność", () => {
  it("bramka dla anonima nie ma naruszeń dostępności", async () => {
    h.session = null;
    const view = await mount();
    expect(summarize(await axeViolations(view.container))).toBe("");
  });

  it("katalog z wynikami, fasetami i chipami nie ma naruszeń dostępności", async () => {
    h.facets = {
      specialization: [{ value: "Energetyka", cnt: 7 }],
      company: [{ value: "Instytut", cnt: 2 }],
      location: [{ value: "Warszawa", cnt: 5 }],
      job_title: [{ value: "Dyrektor", cnt: 3 }],
      open_to: [{ value: "consortium", cnt: 4 }],
    };
    h.pages = [
      [
        person("p1", {
          display_name: "Anna Nowak",
          job_title: "Dyrektorka",
          current_company: "Instytut",
          specialization: "Energetyka",
          location: "Warszawa",
          seeking_pl: "Szukam partnera",
          open_to: [...PROFILE_INTENT_CODES].slice(0, 3),
          total_count: 1,
        }),
      ],
    ];
    h.connections = new Map([["p1", { ...NO_CONNECTION, degree: 1, mutualCount: 2 }]]);
    h.pendingInvites = 2;
    const view = await mount("/people?q=energia&specialization=Energetyka");
    expect(summarize(await axeViolations(view.container))).toBe("");
  });

  it("pusty katalog nie ma naruszeń dostępności", async () => {
    h.pages = [[]];
    const view = await mount();
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});
