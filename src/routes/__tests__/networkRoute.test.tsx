// Trasa `/network` ZAMONTOWANA - cztery zakładki zarządzania siecią kontaktów.
//
// STAN WYJŚCIOWY: 120 wierszy instrukcji na OKRĄGŁYM ZERZE, największy
// pojedynczy plik bez dowodu w module. Zbieżność nie była przypadkowa: progi
// pokrycia w `vitest.config.ts` celują w `src/lib/network/**` i
// `src/components/network/**`, a ta trasa nie wpada pod żaden glob, więc przez
// całe życie modułu nikt nie dostał o niej sygnału.
//
// CZEGO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
//   1. SKRZYNKA ZAPROSZEŃ MA DROGĘ DO KAŻDEGO WIERSZA, O KTÓRYM MÓWI ODZNAKA.
//      RPC klamruje `p_limit` do 50, a odznaka zakładki liczy `COUNT(*)` po
//      całej tabeli - użytkownik z 60 zaproszeniami widział "60" nad listą
//      pokazującą 50 i nie miał jak dojść do pozostałych dziesięciu. To nie
//      jest kosmetyka stronicowania: zaproszenie, którego nie da się wyświetlić,
//      jest zaproszeniem, na które nie da się odpowiedzieć.
//   2. WYSZUKIWARKA SIECI CZEKA NA KONIEC PISANIA. Klucz zapytania niesie
//      przyciętą frazę, więc bez zwłoki każdy klawisz to osobne zapytanie
//      trigramowe po stronie bazy.
//   3. DEEP-LINK `?c=` Z POWIADOMIENIA WSKAZUJE KONKRETNY WIERSZ, a nie tylko
//      zakładkę. Nieznana wartość `?tab=` degraduje się po cichu do widoku
//      domyślnego (fail-soft): link ze starszej wersji produktu nie może
//      wywrócić trasy.
//   4. ZAPROSZENIE W TOKU NIE JEST STOPNIEM ODDALENIA. Graf relacji opisuje
//      fakty, nie intencje - wiersz skrzynki nie może twierdzić "3°" o kimś,
//      kto właśnie do mnie napisał. Ta asercja stoi tu, bo defekt polegał na
//      literale `degree: 3` NADPISUJĄCYM `...NO_CONNECTION` trzy wiersze pod
//      komentarzem, który mówił coś przeciwnego.
//   5. SUGESTIE POKAZUJĄ LICZBĘ MOSTÓW MOŻLIWYCH DO WSKAZANIA, nie fakt grafu -
//      ta sama reguła, co w `MutualConnectionsHint` (migracja 20260913172000).
//   6. TRASA JEST `noindex` I NIE RENDERUJE SIĘ BEZ SESJI ANI PRZY WYŁĄCZONYM
//      MODULE. Sieć kontaktów to dane osobowe o relacjach między ludźmi.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WARSTWY DANYCH: `src/lib/network/__tests__/useConnections.test.tsx` dowodzi
//   kształtu wywołań RPC, stronicowania po `total_count` i mapowania statusów.
//   Tutaj hooki są atrapami; dowodzimy, że trasa ich UŻYWA i respektuje wynik.
// - KOMPONENTÓW SIECI: `ConnectButton`, `MessageOrConnectButton`,
//   `ConnectionPathTrail` i `DegreeBadge` mają własne pliki. Atrapy przycisków
//   oddają tu wyłącznie STAN, jaki trasa im podaje - bo to jest jej kontrakt.
// - RADIX TABS: podmienione na natywny odpowiednik oddający kontrakt (wartość +
//   callback + treść tylko aktywnej zakładki), bo pod happy-dom bez pełnego
//   pointer API Radix nie renderuje zawartości.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ConnectionState } from "@/lib/network/useConnections";
import { NETWORK_IDS, PEER_NAME } from "@/test/network/fixtures";

interface RequestRow {
  connection_id: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  slug: string | null;
  job_title: string | null;
  current_company: string | null;
  verified: boolean;
  message: string | null;
  requested_at: string;
  total_count: number;
}

interface SuggestionRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  slug: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  verified: boolean;
  mutual_count: number;
  mutual_visible_count: number;
  shared_follows: number;
  shared_events: number;
  degree: number;
  open_to: string[];
}

const h = vi.hoisted(() => ({
  language: "pl",
  // Wartość startowa musi być LITERAŁEM: `vi.hoisted` wykonuje się PRZED
  // importami, więc stała z `@/test/network/fixtures` jeszcze tu nie istnieje.
  // `beforeEach` nadpisuje to identyfikatorem ze wspólnych stałych.
  user: { id: "user-me" } as { id: string } | null,
  modules: { connections_enabled: true },
  /** Fazy frazy, z jakimi trasa zawołała `useMyConnections` - dowód zwłoki. */
  connectionQueries: [] as string[],
  connectionPages: [] as Array<Array<Record<string, unknown>>>,
  connectionsHasNext: false,
  fetchNextConnections: vi.fn(),
  /** Strony skrzynki per kierunek + licznik dociągnięć. */
  requestPages: { in: [] as RequestRow[][], out: [] as RequestRow[][] },
  requestsHasNext: { in: false, out: false },
  fetchNextRequests: vi.fn(),
  requestsError: false,
  counts: { connections: 0, pending_in: 0, pending_out: 0 },
  suggestions: [] as SuggestionRow[],
  dismissed: 0,
  dismissPayloads: [] as string[],
  restoreCalls: 0,
  /** Stany relacji, jakie trasa podała przyciskom skrzynki. */
  connectStates: [] as Array<{ userId: string; state?: ConnectionState }>,
  toasts: [] as Array<{ kind: string; msg: string }>,
  connectionsLoading: false,
  connectionsError: false,
  requestsLoading: false,
  suggestionsLoading: false,
  suggestionsError: false,
  refetches: [] as string[],
  /** Czy mutacje pętli zwrotnej mają się udać - obie ścieżki callbacków. */
  dismissFails: false,
  restoreFails: false,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-profile-intent", () => ({ ensureI18n: () => {} }));
vi.mock("@/lib/i18n-community", () => ({ ensureI18n: () => {} }));

vi.mock("@/hooks/useAuth", () => {
  const session = {};
  const auth = {
    get user() {
      return h.user;
    },
    get session() {
      return h.user ? session : null;
    },
    loading: false,
  };
  return { useAuth: () => auth };
});

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => h.modules,
}));
vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => new Set<string>() }));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => h.language }));

vi.mock("@/lib/network/useConnections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network/useConnections")>();
  return {
    ...actual,
    useNetworkRealtime: () => undefined,
    useMyConnections: (query: string) => {
      h.connectionQueries.push(query);
      return {
        data: { pages: h.connectionPages },
        isError: h.connectionsError,
        isLoading: h.connectionsLoading,
        hasNextPage: h.connectionsHasNext,
        isFetchingNextPage: false,
        fetchNextPage: h.fetchNextConnections,
        refetch: () => h.refetches.push("connections"),
      };
    },
    useConnectionRequests: (direction: "in" | "out") => ({
      data: { pages: h.requestPages[direction] },
      isError: h.requestsError,
      isLoading: h.requestsLoading,
      hasNextPage: h.requestsHasNext[direction],
      isFetchingNextPage: false,
      fetchNextPage: () => h.fetchNextRequests(direction),
      refetch: () => h.refetches.push(`requests:${direction}`),
    }),
    useNetworkCounts: () => ({ data: h.counts }),
    useConnectionSuggestions: () => ({
      data: h.suggestions,
      isError: h.suggestionsError,
      isLoading: h.suggestionsLoading,
      refetch: () => h.refetches.push("suggestions"),
    }),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: (msg: string) => h.toasts.push({ kind: "success", msg }),
    error: (msg: string) => h.toasts.push({ kind: "error", msg }),
  },
}));

// Atrapy mutacji ODPALAJĄ callback - inaczej gałęzie `onSuccess`/`onError`
// (komunikaty, jakie zobaczy użytkownik) są nieosiągalne z testu.
interface Cbs {
  onSuccess?: (value: number) => void;
  onError?: (err: Error) => void;
}
vi.mock("@/lib/network/useSuggestionFeedback", () => ({
  useDismissSuggestion: () => ({
    mutate: (id: string, cbs?: Cbs) => {
      h.dismissPayloads.push(id);
      if (h.dismissFails) cbs?.onError?.(new Error("rpc"));
      else cbs?.onSuccess?.(1);
    },
    isPending: false,
  }),
  useDismissedSuggestionsCount: () => ({ data: h.dismissed }),
  useRestoreSuggestions: () => ({
    mutate: (_v: undefined, cbs?: Cbs) => {
      h.restoreCalls += 1;
      if (h.restoreFails) cbs?.onError?.(new Error("rpc"));
      else cbs?.onSuccess?.(3);
    },
    isPending: false,
  }),
}));

// Przyciski akcji: atrapa zapisuje STAN, jaki podała im trasa - to jest tu
// dowodzony kontrakt (patrz reguła 4 w nagłówku), nie ich własny render.
vi.mock("@/components/network/ConnectButton", () => ({
  ConnectButton: ({ userId, state }: { userId: string; state?: ConnectionState }) => {
    h.connectStates.push({ userId, state });
    return <button type="button" data-connect={userId} data-degree={state?.degree} />;
  },
}));
vi.mock("@/components/network/MessageOrConnectButton", () => ({
  MessageOrConnectButton: ({ userId }: { userId: string }) => (
    <button type="button" data-message={userId} />
  ),
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ value: string; set: (next: string) => void }>({
    value: "",
    set: () => undefined,
  });
  const Tabs = ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <Ctx.Provider value={{ value, set: onValueChange }}>
      <div data-testid="tabs" data-value={value}>
        {children}
      </div>
    </Ctx.Provider>
  );
  const TabsList = ({ children }: { children?: ReactNode }) => <div role="tablist">{children}</div>;
  const TabsTrigger = ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = React.useContext(Ctx);
    return (
      <button
        type="button"
        role="tab"
        data-tab-trigger={value}
        aria-selected={ctx.value === value}
        onClick={() => ctx.set(value)}
      >
        {children}
      </button>
    );
  };
  const TabsContent = ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = React.useContext(Ctx);
    return ctx.value === value ? <div data-tab-content={value}>{children}</div> : null;
  };
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { renderRoute, routeSearchValidator, routeHead } from "@/test/routeHarness";
import { Route as NetworkRoute } from "@/routes/network";

const PAGE_SIZE = 24;

// Wiersze HURTOWE (stronicowanie potrzebuje ich 24+) mają identyfikatory
// WYPROWADZONE z indeksu, bo `NETWORK_IDS` dostarcza pojedyncze role, nie
// serię. Są jawnie syntetyczne i nie niosą żadnych danych osoby - tożsamości
// POJEDYNCZE (ja, kontakt, most, relacja) biorą się ze wspólnych stałych.
function connectionRow(i: number): Record<string, unknown> {
  return {
    user_id: `peer-${i}`,
    display_name: `Osoba ${i}`,
    avatar_url: null,
    slug: `osoba-${i}`,
    job_title: "Analityk",
    current_company: "NES",
    location: "Warszawa",
    specialization: "Energia",
    verified: false,
    connection_id: `conn-${i}`,
    connected_at: "2026-01-15T10:00:00.000Z",
    total_count: 100,
  };
}

function requestRow(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    connection_id: NETWORK_IDS.connection,
    user_id: NETWORK_IDS.peer,
    display_name: PEER_NAME,
    avatar_url: null,
    slug: "anna-nowak",
    job_title: "Analityk",
    current_company: "NES",
    verified: false,
    message: null,
    requested_at: "2026-03-02T09:00:00.000Z",
    total_count: 1,
    ...overrides,
  };
}

function suggestionRow(overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    user_id: "peer-sug-1",
    display_name: "Marek Kowal",
    avatar_url: null,
    slug: "marek-kowal",
    job_title: "Ekspert",
    current_company: "NES",
    location: "Bruksela",
    verified: false,
    mutual_count: 0,
    mutual_visible_count: 0,
    shared_follows: 0,
    shared_events: 0,
    degree: 0,
    open_to: [],
    ...overrides,
  };
}

async function mount(entry = "/network") {
  return renderRoute({ route: NetworkRoute, path: "/network", initialEntry: entry });
}

function tabPanel(value: string): HTMLElement {
  const found = document.querySelector(`[data-tab-content="${value}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`test: brak panelu "${value}"`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.language = "pl";
  h.user = { id: NETWORK_IDS.me };
  h.modules = { connections_enabled: true };
  h.connectionQueries = [];
  h.connectionPages = [];
  h.connectionsHasNext = false;
  h.requestPages = { in: [], out: [] };
  h.requestsHasNext = { in: false, out: false };
  h.requestsError = false;
  h.counts = { connections: 0, pending_in: 0, pending_out: 0 };
  h.suggestions = [];
  h.dismissed = 0;
  h.dismissPayloads = [];
  h.restoreCalls = 0;
  h.connectStates = [];
  h.toasts = [];
  h.connectionsLoading = false;
  h.connectionsError = false;
  h.requestsLoading = false;
  h.suggestionsLoading = false;
  h.suggestionsError = false;
  h.refetches = [];
  h.dismissFails = false;
  h.restoreFails = false;
});

afterEach(() => cleanup());

describe("/network - bramki wejścia", () => {
  it("trasa jest noindex - sieć kontaktów to dane o relacjach między ludźmi", () => {
    const meta = routeHead(NetworkRoute).meta ?? [];
    const robots = meta.find((m) => m["name"] === "robots");
    expect(robots?.["content"]).toBe("noindex, nofollow");
  });

  it("moduł wyłączony w tenancie: ekran wyłączenia zamiast zakładek", async () => {
    h.modules = { connections_enabled: false };
    await mount();
    expect(screen.getByText("community.disabled.title")).toBeInTheDocument();
    expect(document.querySelector('[data-testid="tabs"]')).toBeNull();
  });

  it("anon: bramka logowania zamiast cudzych kontaktów", async () => {
    h.user = null;
    await mount();
    expect(document.querySelector('[data-testid="tabs"]')).toBeNull();
  });
});

describe("/network - walidacja parametrów adresu", () => {
  const validate = () => routeSearchValidator(NetworkRoute);

  it("przyjmuje cztery znane zakładki i identyfikator wiersza", () => {
    expect(validate()({ tab: "received", c: "conn-9" })).toEqual({
      tab: "received",
      c: "conn-9",
    });
    for (const tab of ["connections", "sent", "suggestions"]) {
      expect(validate()({ tab })).toEqual({ tab, c: undefined });
    }
  });

  it("nieznana zakładka i pusty `c` degradują się po cichu (fail-soft)", () => {
    expect(validate()({ tab: "moderation", c: "" })).toEqual({ tab: undefined, c: undefined });
    expect(validate()({ tab: 7, c: 9 })).toEqual({ tab: undefined, c: undefined });
  });
});

describe("/network - zakładka Kontakty", () => {
  it("wyszukiwarka czeka 250 ms - jedno zapytanie zamiast jednego na klawisz", async () => {
    // Montaż na PRAWDZIWYM zegarze: `renderRoute` czeka na router, a zamrożony
    // czas zatrzymałby to oczekiwanie. Zegar atrapa wchodzi dopiero na pomiar
    // zwłoki - inaczej test mierzyłby szybkość maszyny, a nie istnienie okna.
    h.connectionPages = [[connectionRow(1)]];
    await mount();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const before = h.connectionQueries.length;
      const input = screen.getByPlaceholderText("network.searchPlaceholder");

      fireEvent.change(input, { target: { value: "k" } });
      fireEvent.change(input, { target: { value: "ko" } });
      fireEvent.change(input, { target: { value: "kow" } });

      expect(h.connectionQueries.slice(before).filter((q) => q !== "")).toEqual([]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(new Set(h.connectionQueries.slice(before).filter((q) => q !== ""))).toEqual(
        new Set(["kow"]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stronicuje po 24 i nie powtarza osoby, która przyszła w dwóch stronach", async () => {
    // Ta sama osoba w dwóch stronach zdarza się realnie: między stronami ktoś
    // dołącza, offset się przesuwa. Powtórzony klucz Reacta to ostrzeżenie,
    // a powtórzony wiersz - pytanie "dlaczego mam to samo dwa razy".
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => connectionRow(i));
    h.connectionPages = [first, [connectionRow(0), connectionRow(PAGE_SIZE)]];
    await mount();

    const panel = tabPanel("connections");
    expect(panel.querySelectorAll("li[data-user-id]")).toHaveLength(PAGE_SIZE);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("druga strona pokazuje resztę, a powrót wraca na pierwszą", async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => connectionRow(i));
    h.connectionPages = [first, [connectionRow(PAGE_SIZE)]];
    await mount();

    fireEvent.click(screen.getByLabelText("network.nextPage"));
    await waitFor(() =>
      expect(tabPanel("connections").querySelectorAll("li[data-user-id]")).toHaveLength(1),
    );
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("network.prevPage"));
    await waitFor(() =>
      expect(tabPanel("connections").querySelectorAll("li[data-user-id]")).toHaveLength(PAGE_SIZE),
    );
  });

  it("pusta sieć: zaproszenie do znalezienia osób zamiast pustej listy", async () => {
    h.connectionPages = [[]];
    await mount();
    expect(screen.getByText("network.emptyConnections")).toBeInTheDocument();
  });

  it("deep-link `?c=` podświetla wskazany wiersz, nie tylko otwiera zakładkę", async () => {
    h.connectionPages = [[connectionRow(1), connectionRow(2)]];
    await mount("/network?c=conn-2");

    const highlighted = tabPanel("connections").querySelector('li[data-user-id="peer-2"]');
    expect(highlighted?.className).toContain("ring-1");
    const other = tabPanel("connections").querySelector('li[data-user-id="peer-1"]');
    expect(other?.className).not.toContain("ring-1");
  });
});

describe("/network - skrzynka zaproszeń", () => {
  it("odznaki zakładek biorą liczby z licznika sieci", async () => {
    h.counts = { connections: 12, pending_in: 3, pending_out: 5 };
    await mount();
    expect(screen.getByRole("tab", { name: /network\.tabs\.received/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /network\.tabs\.sent/ })).toHaveTextContent("5");
  });

  it("otrzymane: notka zapraszającego jest widoczna, wysłane jej nie pokazują", async () => {
    h.requestPages = {
      in: [[requestRow({ message: "Poznaliśmy się w Brukseli." })]],
      out: [[requestRow({ connection_id: "conn-out", message: "Ta sama notka." })]],
    };
    await mount("/network?tab=received");
    expect(screen.getByText("Poznaliśmy się w Brukseli.")).toBeInTheDocument();

    cleanup();
    await mount("/network?tab=sent");
    expect(screen.queryByText("Ta sama notka.")).not.toBeInTheDocument();
  });

  it("ZAPROSZENIE W TOKU NIE JEST STOPNIEM - wiersz nie twierdzi o dystansie", async () => {
    h.requestPages = { in: [[requestRow()]], out: [] };
    await mount("/network?tab=received");

    const state = h.connectStates.at(-1)?.state;
    expect(state?.status).toBe("pending_in");
    // 0 = „nic nie twierdzimy"; 3 byłoby twierdzeniem o grafie, którego nikt
    // nie policzył (defekt: literał `degree: 3` nadpisywał `...NO_CONNECTION`).
    expect(state?.degree).toBe(0);
  });

  it("licznik mówi o 60, lista pokazuje 24 - i JEST kontrolka po resztę", async () => {
    const page = Array.from({ length: PAGE_SIZE }, (_, i) =>
      requestRow({ connection_id: `conn-${i}`, user_id: `peer-${i}`, total_count: 60 }),
    );
    h.requestPages = { in: [page], out: [] };
    h.requestsHasNext = { in: true, out: false };
    h.counts = { connections: 0, pending_in: 60, pending_out: 0 };
    await mount("/network?tab=received");

    const more = screen.getByRole("button", {
      name: /network\.loadMoreOf/,
    });
    expect(more).toHaveTextContent("loaded=24");
    expect(more).toHaveTextContent("total=60");

    fireEvent.click(more);
    expect(h.fetchNextRequests).toHaveBeenCalledWith("in");
  });

  it("komplet wierszy na stronie: kontrolki dociągania NIE MA", async () => {
    h.requestPages = { in: [[requestRow()]], out: [] };
    h.requestsHasNext = { in: false, out: false };
    await mount("/network?tab=received");
    expect(screen.queryByRole("button", { name: /network\.loadMoreOf/ })).not.toBeInTheDocument();
  });

  it("pusta skrzynka i błąd RPC mają osobne komunikaty", async () => {
    await mount("/network?tab=received");
    expect(screen.getByText("network.emptyReceived")).toBeInTheDocument();

    cleanup();
    h.requestsError = true;
    await mount("/network?tab=received");
    expect(screen.getByText("network.loadError")).toBeInTheDocument();
  });
});

describe("/network - sugestie", () => {
  it("karta pokazuje mosty WIDOCZNE, nie fakt grafu", async () => {
    h.suggestions = [suggestionRow({ mutual_count: 7, mutual_visible_count: 4, degree: 2 })];
    await mount("/network?tab=suggestions");

    const panel = tabPanel("suggestions");
    expect(panel.textContent).toContain("network.mutual(count=4)");
    expect(panel.textContent).not.toContain("network.mutual(count=7)");
  });

  it("sygnały treściowe dokładają się do opisu powodu sugestii", async () => {
    h.suggestions = [
      suggestionRow({ mutual_visible_count: 2, shared_follows: 3, shared_events: 1 }),
    ];
    await mount("/network?tab=suggestions");

    const panel = tabPanel("suggestions");
    expect(panel.textContent).toContain("network.sharedDossiers(count=3)");
    expect(panel.textContent).toContain("network.sharedEvents(count=1)");
  });

  it("odrzucenie sugestii wysyła identyfikator TEJ osoby", async () => {
    h.suggestions = [suggestionRow({ user_id: "peer-sug-9" })];
    await mount("/network?tab=suggestions");

    fireEvent.click(screen.getByLabelText(/network\.suggestions\.dismiss/));
    expect(h.dismissPayloads).toEqual(["peer-sug-9"]);
  });

  // Lista opróżniona WŁASNĄ RĘKĄ to inny stan niż „brak kandydatów", i to
  // rozróżnienie jest tu całym twierdzeniem: bez drogi powrotu decyzja „nie,
  // dziękuję" byłaby nieodwracalna, a użytkownik nie miałby jak sprawdzić,
  // czy lista jest pusta, bo nikogo nie ma, czy dlatego, że sam ją wyczyścił.
  it("pusta lista BEZ ukrytych: zwykły komunikat, bez drogi powrotu", async () => {
    h.suggestions = [];
    h.dismissed = 0;
    await mount("/network?tab=suggestions");

    expect(screen.getByText("network.emptySuggestions")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /network\.suggestions\.restore/ }),
    ).not.toBeInTheDocument();
  });

  it("pusta lista Z ukrytymi: inny komunikat i JEST przycisk przywracania", async () => {
    h.suggestions = [];
    h.dismissed = 2;
    await mount("/network?tab=suggestions");

    expect(screen.getByText("network.suggestions.emptyAllDismissed(count=2)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /network\.suggestions\.restore/ }));
    expect(h.restoreCalls).toBe(1);
  });

  it("niepusta lista nie pokazuje przycisku przywracania - nie ma czego wznawiać", async () => {
    h.suggestions = [suggestionRow()];
    h.dismissed = 2;
    await mount("/network?tab=suggestions");
    expect(
      screen.queryByRole("button", { name: /network\.suggestions\.restore/ }),
    ).not.toBeInTheDocument();
  });
});

describe("/network - stany brzegowe wspólne dla zakładek", () => {
  it("każda zakładka ma WŁASNY szkielet ładowania, nie pustą listę", async () => {
    h.connectionsLoading = true;
    await mount();
    expect(tabPanel("connections").querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    cleanup();
    h.connectionsLoading = false;
    h.requestsLoading = true;
    await mount("/network?tab=received");
    expect(tabPanel("received").querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    cleanup();
    h.requestsLoading = false;
    h.suggestionsLoading = true;
    await mount("/network?tab=suggestions");
    expect(tabPanel("suggestions").querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("błąd w KAŻDEJ zakładce daje ponowienie, które naprawdę woła zapytanie", async () => {
    h.connectionsError = true;
    await mount();
    fireEvent.click(screen.getByText("network.retry"));
    expect(h.refetches).toContain("connections");

    cleanup();
    h.connectionsError = false;
    h.requestsError = true;
    await mount("/network?tab=sent");
    fireEvent.click(screen.getByText("network.retry"));
    expect(h.refetches).toContain("requests:out");

    cleanup();
    h.requestsError = false;
    h.suggestionsError = true;
    await mount("/network?tab=suggestions");
    fireEvent.click(screen.getByText("network.retry"));
    expect(h.refetches).toContain("suggestions");
  });

  it("klik w zakładkę przestawia widok bez przeładowania trasy", async () => {
    h.requestPages = { in: [[requestRow()]], out: [] };
    await mount();
    expect(document.querySelector('[data-tab-content="connections"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /network\.tabs\.received/ }));
    await waitFor(() =>
      expect(document.querySelector('[data-tab-content="received"]')).not.toBeNull(),
    );
  });
});

describe("/network - data zaproszenia", () => {
  it("brak daty i data nie do odczytania nie renderują `Invalid Date`", async () => {
    h.requestPages = {
      in: [
        [
          requestRow({ connection_id: "c-null", user_id: "p-null", requested_at: null as never }),
          requestRow({ connection_id: "c-bad", user_id: "p-bad", requested_at: "nie-data" }),
        ],
      ],
      out: [],
    };
    await mount("/network?tab=received");

    const text = tabPanel("received").textContent ?? "";
    expect(text).not.toContain("Invalid Date");
    expect(text).not.toContain("NaN");
    // Pusty człon daty zamiast śmiecia - klucz zostaje, wartość jest pusta.
    expect(text).toContain("network.requestedAt(date=)");
  });

  it("język interfejsu wybiera format daty (PL kontra EN)", async () => {
    h.requestPages = { in: [[requestRow({ requested_at: "2026-03-02T09:00:00.000Z" })]], out: [] };
    await mount("/network?tab=received");
    const pl = tabPanel("received").textContent ?? "";

    cleanup();
    h.language = "en";
    await mount("/network?tab=received");
    const en = tabPanel("received").textContent ?? "";

    expect(pl).not.toBe(en);
  });
});

describe("/network - pętla zwrotna sugestii", () => {
  it("odrzucenie potwierdza się komunikatem, a odmowa bazy - błędem", async () => {
    h.suggestions = [suggestionRow()];
    await mount("/network?tab=suggestions");
    fireEvent.click(screen.getByLabelText(/network\.suggestions\.dismiss/));
    expect(h.toasts.at(-1)).toEqual({
      kind: "success",
      msg: "network.suggestions.dismissedToast(name=Marek Kowal)",
    });

    cleanup();
    h.dismissFails = true;
    await mount("/network?tab=suggestions");
    fireEvent.click(screen.getByLabelText(/network\.suggestions\.dismiss/));
    expect(h.toasts.at(-1)).toEqual({
      kind: "error",
      msg: "network.suggestions.dismissError",
    });
  });

  it("przywrócenie mówi ILE osób wróciło, a odmowa bazy - że się nie udało", async () => {
    h.suggestions = [];
    h.dismissed = 2;
    await mount("/network?tab=suggestions");
    fireEvent.click(screen.getByRole("button", { name: /network\.suggestions\.restore/ }));
    expect(h.toasts.at(-1)).toEqual({
      kind: "success",
      msg: "network.suggestions.restoredToast(count=3)",
    });

    cleanup();
    h.restoreFails = true;
    await mount("/network?tab=suggestions");
    fireEvent.click(screen.getByRole("button", { name: /network\.suggestions\.restore/ }));
    expect(h.toasts.at(-1)?.kind).toBe("error");
  });

  // ZNALEZIONE PRZY PISANIU TEGO PLIKU, poza listą zlecenia - zapisane, a nie
  // naprawione po cichu (naprawa defektu i dopisanie testu do zielonego kodu to
  // dwie różne czynności).
  //
  // MECHANIZM. `PersonRow` ma prop `intents` (:150, :169) i renderuje z niego
  // listę chipów z etykietą `profileIntent.openToLabel` (:245-247). ŻADEN
  // z trzech wołających w tym pliku go nie przekazuje - grep po `intents`
  // w `src/routes/network.tsx` daje wyłącznie deklarację i ciało, ani jednego
  // miejsca użycia. Jednocześnie `connection_suggestions` NAPRAWDĘ zwraca
  // `open_to` (kolumna jest w `RETURNS TABLE` i w wygenerowanym typie), a trasa
  // importuje `IntentChip` i `profileIntentLabelKey` po to i tylko po to.
  //
  // Skutek: baza liczy i przesyła intencje, trasa ciągnie za sobą komponent
  // chipa i słownik, a użytkownik nie widzi ich nigdy. To ta sama klasa, co
  // martwy `targetSlug` w `ConnectionPathTrail` - prop zadeklarowany,
  // przekazywany albo nie, i nigdy nie czytany.
  //
  // NAPRAWA to jedna linia w `SuggestionsTab` (`intents={s.open_to}` przy
  // `PersonRow`), ale należy do zmiany o TYM defekcie, nie do tej.
  it.fails("DEFEKT: intencje z `open_to` nigdy nie docierają do karty sugestii", async () => {
    h.suggestions = [suggestionRow({ open_to: ["mentoring", "speaking"] })];
    await mount("/network?tab=suggestions");

    const list = tabPanel("suggestions").querySelector('[aria-label="profileIntent.openToLabel"]');
    expect(list?.querySelectorAll("li")).toHaveLength(2);
  });
});

describe("/network - dociąganie kolejnej strony sieci", () => {
  it("na ostatniej stronie klienta strzalka w prawo prosi warstwe danych o kolejna", async () => {
    const first = Array.from({ length: PAGE_SIZE }, (_, i) => connectionRow(i));
    h.connectionPages = [first];
    h.connectionsHasNext = true;
    h.fetchNextConnections.mockResolvedValue(undefined);
    await mount();

    // Strona 1 z 1+ : lokalnych stron nie ma więcej, więc przycisk musi sięgnąć
    // po kolejną PORCJĘ z bazy, a nie stać się nieaktywny.
    expect(screen.getByText("1 / 1+")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("network.nextPage"));
    await waitFor(() => expect(h.fetchNextConnections).toHaveBeenCalled());
  });
});
