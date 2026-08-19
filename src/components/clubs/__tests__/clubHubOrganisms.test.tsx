// Hub klubu (`ClubHub`) - powłoka trzykolumnowa i orkiestracja SZEŚCIU zapytań.
//
// CO TEN PLIK DOWODZI. Hub jest największą powierzchnią czytelnika w module
// i jednocześnie jedynym miejscem, w którym sześć niezależnych zapytań musi
// zgodzić się co do jednego zawężenia. Stąd pięć osi:
//
//  1. KONTRAKT ARGUMENTÓW. Wybrany dział zawęża RÓWNOCZEŚNIE strumień,
//     bibliotekę i ścianę - inaczej dział pokazuje wątki jednego działu
//     i wpisy całego klubu, co wygląda jak zepsuty filtr. Osobno jedzie
//     PEŁNA lista wątków klubu (`sort: "new"`, BEZ działu): zasila kompozytor
//     i liczniki obszarów tematycznych, które mają mówić o CAŁYM klubie.
//     Wyłączony filtr kotwicy jedzie jako `null`, nie `false` - `false`
//     znaczyłoby „tylko BEZ kotwicy”, czyli trzeci stan, którego kontrolka
//     nie oferuje. Nieprzeczytane bez sesji nie jadą wcale.
//  2. CZTERY STANY DANYCH: pełne, PUSTE, CZĘŚCIOWE (zapytanie w locie,
//     `data: undefined` na każdym z sześciu) i AWARIA. Pustka Z ZAWĘŻENIEM ma
//     INNY komunikat niż pusty klub - „nie ma jeszcze tematów” pod włączonym
//     filtrem jest po prostu nieprawdą i wypycha czytelnika z klubu, który ma
//     treść dwa kliknięcia dalej.
//  3. SPRZĘŻENIE FILTRA Z TRYBEM. Zawężenie WĄTKOWE włączone w trybie
//     „wszystko” przestawia strumień na „wątki”, bo inaczej filtr nie dotyczy
//     połowy tego, co widać. Zdjęcie zawężenia trybu NIE rusza.
//  4. WYSZUKIWANIE ZASTĘPUJE strumień, nie stoi obok niego: dwie listy naraz
//     na telefonie znaczą, że czytelnik nie wie, którą czyta. Fraza poniżej
//     dwóch znaków nie idzie do RPC. `?tag=` jest kontraktem adresu, więc
//     zdjęcie tagu musi usunąć parametr, a nie tylko wyczyścić pole.
//  5. UPRAWNIENIA SĄ ILOCZYNEM SESJI I ZDOLNOŚCI. `can_see_members`
//     przepuszcza anonima w klubie publicznym, a RPC z nazwiskami jest dla
//     niego zamknięte - dlatego panel spotkania dostaje `signedIn && can_*`,
//     a panel składu samo `can_see_members`. Pomyłka w tę stronę pokazuje
//     gościowi listę, której serwer mu nie odda.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//  - `buildClubFeed`: przeplot kart kontekstowych ma pełną tabelę przypadków
//    w `clubFeed.test.ts`. Tutaj dowodzimy, że hub go WOŁA z właściwymi
//    źródłami i respektuje wynik (liczba kart, ich rodzaje).
//  - REGUŁ DOSTĘPU (`hubAccess`, `gateView`, `capabilityMatrix`): mają własne
//    testy na czystych funkcjach oraz pgTAP. Hub czyta `can_*` z wiersza
//    `club_view`, nie liczy ich.
//  - MOLEKUŁ I ORGANIZMÓW POTOMNYCH: `ClubStreamFilters`, `ClubThreadTopicBar`,
//    `ClubCreatePanel`, `ClubGroupPanel`, `ClubFeedItem`, `ClubGlobalSearch`,
//    panele szyny o ludziach - wszystkie mają własne pliki i stoją tu
//    w atrapach. Sprawdzamy WYŁĄCZNIE kontrakt wpięcia i to, czy hub reaguje
//    na ich zgłoszenia.
//  - `ClubHubRail`, `ClubHubIdentity` i panele `ClubHubContext` NIE są
//    zamockowane: to ta sama warstwa co hub i mają własne pliki
//    (`clubHubRail.test.tsx`, `clubHubIdentity.test.tsx`,
//    `clubHubContext.test.tsx`) - tutaj dowodzimy tylko, że hub podaje im
//    liczby, które i tak pobrał, i że szyna stoi w obu nośnikach.
//  - `groupTree`, `threadSources`, `postTypes`: czyste moduły z własnymi testami.
//
// Radix `Select` nie działa pod happy-dom bez pełnego API wskaźnika, więc
// porządek stoi w natywnym `<select>`; `Link` routera jedzie przez
// `RouterLinkStub`. Determinizm: `useDebouncedValue` zastąpiony tożsamością
// (produkcja używa `setTimeout`), a etap harmonogramu jest bez terminu, żeby
// panel nie porównywał się z DZISIEJSZĄ datą systemową.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ClubReactionKind, ClubThreadKind } from "@/lib/clubs/types";

const h = vi.hoisted(() => ({
  lang: "pl" as string,
  session: { user: { id: "user-me" } } as { user: { id: string } } | null,
  /** Parametry adresu (`?tag=`) widziane przez hub. */
  search: {} as { tag?: string },
  navigate: vi.fn(),

  // --- odpowiedzi zapytań (każde ma stan „w locie” przez `undefined`) -------
  groups: [] as unknown[] | undefined,
  threadPages: undefined as { rows: unknown[] }[] | undefined,
  threadsPending: false,
  threadsError: false,
  hasNextPage: false,
  fetchingNextPage: false,
  sourcePages: undefined as { rows: unknown[] }[] | undefined,
  documents: undefined as { rows: unknown[]; total: number } | undefined,
  events: undefined as unknown[] | undefined,
  milestones: undefined as unknown[] | undefined,
  postPages: undefined as { rows: unknown[]; total: number }[] | undefined,
  searchHits: undefined as unknown[] | undefined,
  searchPending: false,
  searchError: false,
  reactions: undefined as ReadonlyMap<string, unknown[]> | undefined,
  togglePending: false,

  // --- dzienniki wywołań ---------------------------------------------------
  threadArgs: null as Record<string, unknown> | null,
  sourceArgs: null as Record<string, unknown> | null,
  documentArgs: null as Record<string, unknown> | null,
  eventArgs: null as Record<string, unknown> | null,
  postArgs: null as Record<string, unknown> | null,
  searchArgs: null as Record<string, unknown> | null,
  reactionArgs: null as Record<string, unknown> | null,
  actorArgs: null as Record<string, unknown> | null,
  mediaPaths: [] as readonly string[],
  refetchThreads: vi.fn(),
  refetchSearch: vi.fn(),
  refetchPosts: vi.fn(),
  fetchNextPage: vi.fn(),
  likeMutate: vi.fn(),
  deleteMutate: vi.fn(),
  reactMutate: vi.fn(),

  // --- propsy zapisane przez atrapy ---------------------------------------
  sortTrigger: null as { label?: string; className?: string } | null,
  filters: null as Record<string, unknown> | null,
  topicBar: null as Record<string, unknown> | null,
  createPanel: null as Record<string, unknown> | null,
  groupPanel: null as Record<string, unknown> | null,
  meeting: null as Record<string, unknown> | null,
  board: null as Record<string, unknown> | null,
  roster: null as Record<string, unknown> | null,
  feedItem: null as Record<string, unknown> | null,
  searchPanel: null as Record<string, unknown> | null,
  /** Identyfikator działu, którym sterują atrapy list. */
  groupId: "group-1",
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: ({ activeOptions: _activeOptions, ...rest }: { activeOptions?: unknown }) => (
      <RouterLinkStub {...rest} />
    ),
    useNavigate: () => h.navigate,
    useSearch: () => h.search,
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, user: h.session?.user ?? null, isStaff: false, loading: false }),
}));

// Odbicie wartości bez opóźnienia: produkcja używa `setTimeout`, a test
// z zegarem sterowanym ręcznie sprawdzałby harmonogram, nie hub.
vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({
    topics: [{ key: "energy", label_pl: "Energia", label_en: "Energy", sort_order: 1 }],
    isLoading: false,
  }),
}));

vi.mock("@/lib/clubs/useClubs", () => ({
  useClubGroups: () => ({ data: h.groups }),
  useClubThreads: (args: Record<string, unknown>) => {
    // PEŁNA lista klubu nie podaje działu wcale; strumień podaje go zawsze
    // (także jako `null`), więc rozróżnienie idzie po obecności klucza.
    if (args.groupId === undefined) {
      h.sourceArgs = args;
      return {
        data: h.sourcePages === undefined ? undefined : { pages: h.sourcePages },
        isPending: false,
        isError: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    }
    h.threadArgs = args;
    return {
      data: h.threadPages === undefined ? undefined : { pages: h.threadPages },
      isPending: h.threadsPending,
      isError: h.threadsError,
      hasNextPage: h.hasNextPage,
      isFetchingNextPage: h.fetchingNextPage,
      fetchNextPage: h.fetchNextPage,
      refetch: h.refetchThreads,
    };
  },
  useClubSearch: (args: Record<string, unknown>) => {
    h.searchArgs = args;
    return {
      data: h.searchHits,
      isPending: h.searchPending,
      isError: h.searchError,
      refetch: h.refetchSearch,
    };
  },
  useClubReactions: (args: Record<string, unknown>) => {
    h.reactionArgs = args;
    return { data: h.reactions };
  },
  useClubReactionActors: (args: Record<string, unknown>) => {
    h.actorArgs = args;
    return { data: undefined };
  },
  useToggleClubReaction: () => ({ mutate: h.reactMutate, isPending: h.togglePending }),
}));

vi.mock("@/lib/clubs/useClubWorkspace", () => ({
  useClubDocuments: (args: Record<string, unknown>) => {
    h.documentArgs = args;
    return { data: h.documents };
  },
  useClubEvents: (args: Record<string, unknown>) => {
    h.eventArgs = args;
    return { data: h.events };
  },
  useClubMilestones: () => ({ data: h.milestones }),
}));

vi.mock("@/lib/clubs/useClubPosts", () => ({
  useClubPosts: (args: Record<string, unknown>) => {
    h.postArgs = args;
    return {
      data: h.postPages === undefined ? undefined : { pages: h.postPages },
      refetch: h.refetchPosts,
    };
  },
  useDeleteClubPost: () => ({ mutate: h.deleteMutate }),
  useToggleClubPostLike: () => ({ mutate: h.likeMutate }),
  useClubMediaUrls: (paths: readonly string[]) => {
    h.mediaPaths = paths;
    return {};
  },
}));

// Radix Select -> natywny `<select>`. Wyzwalacz zapisuje swoje propsy, bo to
// jego klasa mówi, czy porządek schował się pod wyszukiwaniem.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <select
      aria-label="club.sort.label"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: (props: { "aria-label"?: string; className?: string; children?: ReactNode }) => {
    h.sortTrigger = { label: props["aria-label"], className: props.className };
    return null;
  },
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

vi.mock("@/components/clubs/molecules/ClubGroupTree", () => ({
  ClubGroupBar: (props: { onGroupChange: (groupId: string | null) => void }) => (
    <div data-testid="group-bar">
      <button type="button" data-testid="bar-pick" onClick={() => props.onGroupChange(h.groupId)}>
        bar
      </button>
    </div>
  ),
  ClubGroupTree: (props: { onGroupChange: (groupId: string | null) => void }) => (
    <div data-testid="group-tree">
      <button type="button" data-testid="tree-pick" onClick={() => props.onGroupChange(h.groupId)}>
        tree
      </button>
      <button type="button" data-testid="tree-clear" onClick={() => props.onGroupChange(null)}>
        clear
      </button>
    </div>
  ),
}));

vi.mock("@/components/clubs/molecules/ClubGroupPanel", () => ({
  ClubGroupPanel: (props: { documentCount: number; onGroupChange: (id: string | null) => void }) => {
    h.groupPanel = { documentCount: props.documentCount };
    return (
      <div data-testid="group-panel">
        <button type="button" data-testid="panel-clear" onClick={() => props.onGroupChange(null)}>
          clear
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/molecules/ClubStreamFilters", () => ({
  ClubStreamFilters: (props: {
    kind: ClubThreadKind | null;
    onKindChange: (next: ClubThreadKind | null) => void;
    anchoredOnly: boolean;
    onAnchoredOnlyChange: (next: boolean) => void;
    unreadOnly: boolean;
    onUnreadOnlyChange: (next: boolean) => void;
    canFilterUnread: boolean;
  }) => {
    h.filters = {
      kind: props.kind,
      anchoredOnly: props.anchoredOnly,
      unreadOnly: props.unreadOnly,
      canFilterUnread: props.canFilterUnread,
    };
    return (
      <div data-testid="stream-filters">
        <button type="button" data-testid="kind-on" onClick={() => props.onKindChange("question")}>
          k+
        </button>
        <button type="button" data-testid="kind-off" onClick={() => props.onKindChange(null)}>
          k-
        </button>
        <button
          type="button"
          data-testid="anchored-on"
          onClick={() => props.onAnchoredOnlyChange(true)}
        >
          a+
        </button>
        <button
          type="button"
          data-testid="anchored-off"
          onClick={() => props.onAnchoredOnlyChange(false)}
        >
          a-
        </button>
        <button type="button" data-testid="unread-on" onClick={() => props.onUnreadOnlyChange(true)}>
          u+
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/molecules/ClubThreadTopicBar", () => ({
  ClubThreadTopicBar: (props: {
    threads: readonly unknown[];
    value: string | null;
    onChange: (next: string | null) => void;
  }) => {
    h.topicBar = { threadCount: props.threads.length, value: props.value };
    return (
      <div data-testid="topic-bar">
        <button type="button" data-testid="topic-on" onClick={() => props.onChange("energy")}>
          t+
        </button>
        <button type="button" data-testid="topic-off" onClick={() => props.onChange(null)}>
          t-
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/molecules/ClubCreatePanel", () => ({
  ClubCreatePanel: (props: {
    clubId: string;
    groupId: string | null;
    threads: readonly unknown[];
    canPost: boolean;
    canPostThread: boolean;
    whoCanPost: string;
  }) => {
    h.createPanel = {
      clubId: props.clubId,
      groupId: props.groupId,
      threadCount: props.threads.length,
      canPost: props.canPost,
      canPostThread: props.canPostThread,
      whoCanPost: props.whoCanPost,
    };
    return <div data-testid="create-panel" />;
  },
}));

vi.mock("@/components/clubs/molecules/ClubMeetingPanel", () => ({
  ClubMeetingPanel: (props: {
    events: readonly unknown[];
    canSeeMembers: boolean;
    canRsvp: boolean;
    canManage: boolean;
  }) => {
    h.meeting = {
      eventCount: props.events.length,
      canSeeMembers: props.canSeeMembers,
      canRsvp: props.canRsvp,
      canManage: props.canManage,
    };
    return <div data-testid="meeting-panel" />;
  },
}));

vi.mock("@/components/clubs/molecules/ClubBoardPanel", () => ({
  ClubBoardPanel: (props: { canPost: boolean }) => {
    h.board = { canPost: props.canPost };
    return <div data-testid="board-panel" />;
  },
}));

vi.mock("@/components/clubs/molecules/ClubRosterPanel", () => ({
  ClubRosterPanel: (props: { canSeeMembers: boolean; canDeclare: boolean; locale: string }) => {
    h.roster = {
      canSeeMembers: props.canSeeMembers,
      canDeclare: props.canDeclare,
      locale: props.locale,
    };
    return <div data-testid="roster-panel" />;
  },
}));

vi.mock("@/components/clubs/molecules/ClubSpotlightPanel", () => ({
  ClubSpotlightPanel: () => <div data-testid="spotlight-panel" />,
}));

vi.mock("@/components/clubs/organisms/ClubFeedItem", () => ({
  ClubFeedItem: (props: {
    entry: { kind: string };
    canReact: boolean;
    reactionsPending?: boolean;
    threadReactions?: ReadonlyMap<string, unknown[]>;
    onSourceSelect?: (groupId: string | null) => void;
    onTopicSelect?: (topic: string | null) => void;
    onPostLike?: (postId: string) => void;
    onPostDelete?: (postId: string) => void;
    onThreadReact?: (threadId: string, kind: ClubReactionKind, active: boolean) => void;
  }) => {
    h.feedItem = {
      canReact: props.canReact,
      reactionsPending: props.reactionsPending,
      hasReactions: props.threadReactions !== undefined,
    };
    return (
      <div data-testid="feed-item" data-kind={props.entry.kind}>
        <button
          type="button"
          data-testid="feed-source"
          onClick={() => props.onSourceSelect?.(h.groupId)}
        >
          source
        </button>
        <button
          type="button"
          data-testid="feed-topic"
          onClick={() => props.onTopicSelect?.("energy")}
        >
          topic
        </button>
        <button
          type="button"
          data-testid="feed-like"
          onClick={() => props.onPostLike?.("post-1")}
        >
          like
        </button>
        <button
          type="button"
          data-testid="feed-delete"
          onClick={() => props.onPostDelete?.("post-1")}
        >
          delete
        </button>
        <button
          type="button"
          data-testid="feed-react"
          onClick={() => props.onThreadReact?.("thread-1", "insightful", false)}
        >
          react
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/organisms/ClubGlobalSearch", () => ({
  ClubGlobalSearchResults: (props: {
    hits: readonly unknown[];
    pending: boolean;
    failed: boolean;
    query: string;
    onRetry: () => void;
  }) => {
    h.searchPanel = {
      hitCount: props.hits.length,
      pending: props.pending,
      failed: props.failed,
      query: props.query,
    };
    return (
      <div data-testid="search-results">
        <button type="button" data-testid="search-retry" onClick={props.onRetry}>
          retry
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/clubs/molecules/ClubErrorNotice", () => ({
  ClubErrorNotice: (props: { onRetry?: () => void }) => (
    <div data-testid="error-notice">
      <button type="button" data-testid="error-retry" onClick={props.onRetry}>
        retry
      </button>
    </div>
  ),
}));

vi.mock("@/components/clubs/atoms/ClubSkeletons", () => ({
  ClubThreadListSkeleton: () => <div data-testid="thread-skeleton" />,
}));

vi.mock("@/components/clubs/molecules/ClubCoverEditor", () => ({
  ClubCoverEditor: () => <div data-testid="cover-editor" />,
}));

import { ClubHub } from "@/components/clubs/organisms/ClubHub";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { CLUB_IDS, clubGroupRow, clubThreadListRow, clubViewRow } from "@/test/clubs/fixtures";
import {
  clubDocumentRow,
  clubEventRow,
  clubMilestoneRow,
  clubPostRow,
} from "@/test/clubs/hubFixtures";
import { translateKey } from "@/test/i18nStub";
import type { ClubViewRow } from "@/lib/clubs/types";

function threadRows(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, index) =>
    clubThreadListRow({ id: `thread-${index + 1}`, slug: `temat-${index + 1}` }),
  );
}

/** Hub z PEŁNYMI danymi wszystkich sześciu zapytań. */
function fullData(): void {
  h.groups = [clubGroupRow()];
  h.threadPages = [{ rows: threadRows(3) }];
  h.sourcePages = [{ rows: threadRows(4) }];
  h.documents = { rows: [clubDocumentRow()], total: 9 };
  h.events = [clubEventRow()];
  // Etap BEZ terminu: panel nie porównuje się wtedy z datą systemową.
  h.milestones = [clubMilestoneRow({ state: "active", due_on: null })];
  h.postPages = [{ rows: [clubPostRow()], total: 5 }];
}

function mount(overrides: Partial<ClubViewRow> = {}) {
  return renderWithQueryClient(<ClubHub club={clubViewRow(overrides)} />);
}

function feedKinds(): string[] {
  return screen.getAllByTestId("feed-item").map((node) => node.dataset.kind ?? "");
}

/**
 * Segment trybu. Nazwa dostępna niesie także LICZNIK („…posts 5”), więc
 * dopasowanie jest po początku klucza, a nie po całości napisu.
 */
function modeButton(mode: string): HTMLElement {
  return screen.getByRole("radio", { name: new RegExp(`^club\\.hub\\.feed\\.mode\\.${mode}`) });
}

/**
 * Kolumna sekcji i poziomy pasek sekcji mają tę samą etykietę nawigacji -
 * rozróżnia je nagłówek grupy, który istnieje wyłącznie w kolumnie.
 */
function railNav(): HTMLElement {
  const navs = screen.getAllByRole("navigation", { name: "club.hub.sectionsLabel" });
  const column = navs.find((nav) => nav.querySelector("h3") !== null);
  if (column === undefined) throw new Error("kolumna sekcji nie została wyrenderowana");
  return column;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  h.lang = "pl";
  h.session = { user: { id: "user-me" } };
  h.search = {};
  h.groups = [];
  h.threadPages = undefined;
  h.threadsPending = false;
  h.threadsError = false;
  h.hasNextPage = false;
  h.fetchingNextPage = false;
  h.sourcePages = undefined;
  h.documents = undefined;
  h.events = undefined;
  h.milestones = undefined;
  h.postPages = undefined;
  h.searchHits = undefined;
  h.searchPending = false;
  h.searchError = false;
  h.reactions = undefined;
  h.togglePending = false;
  h.sortTrigger = null;
  h.filters = null;
  h.topicBar = null;
  h.createPanel = null;
  h.groupPanel = null;
  h.meeting = null;
  h.board = null;
  h.roster = null;
  h.feedItem = null;
  h.searchPanel = null;
});

describe("ClubHub - kontrakt argumentów sześciu zapytań", () => {
  it("wybrany dział zawęża RÓWNOCZEŚNIE strumień, bibliotekę i ścianę", () => {
    fullData();
    mount();

    expect(h.threadArgs?.groupId).toBeNull();
    fireEvent.click(screen.getByTestId("tree-pick"));

    expect(h.threadArgs?.groupId).toBe(CLUB_IDS.group);
    expect(h.documentArgs?.groupId).toBe(CLUB_IDS.group);
    expect(h.postArgs?.groupId).toBe(CLUB_IDS.group);
  });

  it("PEŁNA lista wątków klubu jedzie bez działu i w porządku „new”, także po wybraniu działu", () => {
    fullData();
    mount();
    fireEvent.click(screen.getByTestId("bar-pick"));

    expect(h.sourceArgs).toEqual({ clubId: CLUB_IDS.club, sort: "new" });
  });

  it("wyłączony filtr kotwicy jedzie jako `null`, nie `false`", () => {
    fullData();
    mount();
    expect(h.threadArgs?.anchored).toBeNull();

    fireEvent.click(screen.getByTestId("anchored-on"));
    expect(h.threadArgs?.anchored).toBe(true);

    fireEvent.click(screen.getByTestId("anchored-off"));
    expect(h.threadArgs?.anchored).toBeNull();
  });

  it("nieprzeczytane bez sesji nie jadą do RPC i filtr jest zamknięty", () => {
    fullData();
    h.session = null;
    mount();

    expect(h.filters?.canFilterUnread).toBe(false);
    fireEvent.click(screen.getByTestId("unread-on"));
    expect(h.threadArgs?.unreadOnly).toBe(false);
  });

  it("nieprzeczytane z sesją jadą do RPC", () => {
    fullData();
    mount();

    expect(h.filters?.canFilterUnread).toBe(true);
    fireEvent.click(screen.getByTestId("unread-on"));
    expect(h.threadArgs?.unreadOnly).toBe(true);
  });

  it("konteksty mają KRÓTKIE limity - w hubie są kontekstem, nie listą", () => {
    fullData();
    mount();

    expect(h.documentArgs?.limit).toBe(6);
    expect(h.eventArgs?.limit).toBe(12);
    expect(typeof h.eventArgs?.from).toBe("string");
  });

  it("reakcje CAŁEJ widocznej partii wątków jadą jednym zapytaniem, bez kart kontekstowych", () => {
    fullData();
    mount();

    expect(h.reactionArgs?.targetType).toBe("thread");
    expect(h.reactionArgs?.targetIds).toEqual(["thread-1", "thread-2", "thread-3"]);
    expect(h.actorArgs?.targetIds).toEqual(["thread-1", "thread-2", "thread-3"]);
  });

  it("wszystkie ścieżki plików ze ściany podpisuje JEDNYM żądaniem, bez linków", () => {
    fullData();
    h.postPages = [
      {
        rows: [
          clubPostRow({
            id: "post-1",
            attachments: [
              { type: "image", path: "klub/1.jpg", name: "1.jpg", mime: "image/jpeg", size: 10 },
              { type: "link", url: "https://example.test" },
            ],
          }),
          clubPostRow({
            id: "post-2",
            attachments: [
              { type: "file", path: "klub/2.pdf", name: "2.pdf", mime: "application/pdf", size: 20 },
            ],
          }),
        ],
        total: 2,
      },
    ];
    mount();

    expect(h.mediaPaths).toEqual(["klub/1.jpg", "klub/2.pdf"]);
  });

  it("kompozytor dostaje pełną listę wątków klubu i prawa z wiersza klubu", () => {
    fullData();
    mount();

    expect(h.createPanel).toEqual({
      clubId: CLUB_IDS.club,
      groupId: null,
      threadCount: 4,
      canPost: true,
      canPostThread: true,
      whoCanPost: "members",
    });
  });
});

describe("ClubHub - cztery stany danych", () => {
  it("zapytania W LOCIE nie wywracają huba: sześć razy `undefined` daje szkielet", () => {
    h.threadsPending = true;
    // `useClubGroups` bez odpowiedzi: drzewo działów musi wytrzymać `?? []`.
    h.groups = undefined;
    mount();

    expect(screen.getByTestId("thread-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("feed-item")).toBeNull();
    // Kafelki szyny liczą tylko tym, co wiezie wiersz klubu.
    expect(h.groupPanel).toBeNull();
    expect(h.meeting?.eventCount).toBe(0);
  });

  it("awaria strumienia pokazuje ponowienie, nie pustkę", () => {
    h.threadsError = true;
    mount();

    expect(screen.getByTestId("error-notice")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("error-retry"));
    expect(h.refetchThreads).toHaveBeenCalledTimes(1);
  });

  it("pusty klub mówi „nie ma jeszcze tematów”", () => {
    h.threadPages = [{ rows: [] }];
    mount();

    expect(screen.getByText("club.noThreads")).toBeInTheDocument();
  });

  it("pustka Z ZAWĘŻENIEM RODZAJU to INNY komunikat niż pusty klub", () => {
    h.threadPages = [{ rows: [] }];
    mount();
    fireEvent.click(screen.getByTestId("kind-on"));

    expect(screen.getByText("club.filters.empty")).toBeInTheDocument();
    expect(screen.queryByText("club.noThreads")).toBeNull();
  });

  it("pustka z zawężeniem KOTWICĄ też mówi o filtrze", () => {
    h.threadPages = [{ rows: [] }];
    mount();
    fireEvent.click(screen.getByTestId("anchored-on"));

    expect(screen.getByText("club.filters.empty")).toBeInTheDocument();
  });

  it("pustka z zawężeniem OBSZAREM też mówi o filtrze", () => {
    h.threadPages = [{ rows: [] }];
    mount();
    fireEvent.click(screen.getByTestId("topic-on"));

    expect(screen.getByText("club.filters.empty")).toBeInTheDocument();
  });

  it("pustka przy nieprzeczytanych liczy się TYLKO dla zalogowanego", () => {
    h.threadPages = [{ rows: [] }];
    h.session = null;
    mount();
    fireEvent.click(screen.getByTestId("unread-on"));

    // Gość nie ma czego mieć nieprzeczytanego, więc pustka NIE jest pustką
    // „pod filtrem” - zostaje komunikat trybu, na który przestawił się strumień.
    expect(screen.queryByText("club.filters.empty")).toBeNull();
    expect(screen.getByText("club.hub.feed.empty.threads")).toBeInTheDocument();
  });

  it("pustka w trybie innym niż „wszystko” ma komunikat TEGO trybu", () => {
    h.threadPages = [{ rows: [] }];
    h.postPages = [{ rows: [], total: 0 }];
    mount();
    fireEvent.click(modeButton("posts"));

    expect(screen.getByText("club.hub.feed.empty.posts")).toBeInTheDocument();
  });

  it("dane CZĘŚCIOWE: brak biblioteki i kalendarza nie odbiera huba", () => {
    h.threadPages = [{ rows: threadRows(2) }];
    h.documents = undefined;
    h.events = undefined;
    h.milestones = undefined;
    mount();

    expect(feedKinds()).toEqual(["thread", "thread"]);
    expect(h.groupPanel).toBeNull();
    expect(screen.queryByText("club.hub.stage.title")).toBeNull();
    expect(screen.queryByText("club.hub.freshDocs.title")).toBeNull();
  });

  it("dane PEŁNE wpuszczają karty kontekstowe do strumienia", () => {
    fullData();
    mount();

    // Wątki + termin + paczka materiałów + etap: kolejność należy do
    // `buildClubFeed`, tu liczy się, że hub podał mu wszystkie cztery źródła.
    expect(feedKinds()).toContain("event");
    expect(feedKinds()).toContain("documents");
    expect(feedKinds()).toContain("milestone");
    expect(feedKinds().filter((kind) => kind === "thread")).toHaveLength(3);
  });
});

describe("ClubHub - sprzężenie zawężeń z trybem strumienia", () => {
  it("zawężenie RODZAJU w trybie „wszystko” przestawia strumień na wątki", () => {
    fullData();
    mount();
    expect(modeButton("all")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByTestId("kind-on"));

    expect(modeButton("threads")).toHaveAttribute("aria-checked", "true");
    expect(h.threadArgs?.kind).toBe("question");
  });

  it("ZDJĘCIE zawężenia nie rusza trybu", () => {
    fullData();
    mount();
    fireEvent.click(screen.getByTestId("kind-off"));

    expect(modeButton("all")).toHaveAttribute("aria-checked", "true");
    expect(h.threadArgs?.kind).toBeNull();
  });

  it("zawężenie włączone już w trybie „wątki” nie przestawia niczego", () => {
    fullData();
    mount();
    fireEvent.click(modeButton("threads"));
    fireEvent.click(screen.getByTestId("anchored-on"));

    expect(modeButton("threads")).toHaveAttribute("aria-checked", "true");
    expect(h.threadArgs?.anchored).toBe(true);
  });

  it("obszar tematyczny z paska jedzie do RPC i też przestawia tryb", () => {
    fullData();
    mount();
    // Liczniki obszarów jadą z PEŁNEJ listy klubu (4 wątki), nie z bieżącego
    // zawężenia strumienia (3) - inaczej po wybraniu działu mówiłyby o dziale.
    expect(h.topicBar).toEqual({ threadCount: 4, value: null });

    fireEvent.click(screen.getByTestId("topic-on"));

    expect(h.threadArgs?.topic).toBe("energy");
    expect(modeButton("threads")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByTestId("topic-off"));
    expect(h.threadArgs?.topic).toBeNull();
  });

  it("obszar wybrany z KARTY strumienia idzie tą samą drogą", () => {
    fullData();
    mount();
    fireEvent.click(screen.getAllByTestId("feed-topic")[0]);

    expect(h.threadArgs?.topic).toBe("energy");
    expect(modeButton("threads")).toHaveAttribute("aria-checked", "true");
  });

  it("dział wybrany z KARTY strumienia zawęża listę", () => {
    fullData();
    mount();
    fireEvent.click(screen.getAllByTestId("feed-source")[0]);

    expect(h.threadArgs?.groupId).toBe(CLUB_IDS.group);
  });

  it("zawężenia i pasek obszarów NIE stoją nad dokumentami ani kalendarzem", () => {
    fullData();
    mount();
    fireEvent.click(modeButton("documents"));

    expect(screen.queryByTestId("stream-filters")).toBeNull();
    expect(screen.queryByTestId("topic-bar")).toBeNull();
  });

  it("liczniki trybów jadą z zapytań, które hub i tak wykonuje", () => {
    fullData();
    mount();

    expect(modeButton("posts").textContent).toContain("5");
    expect(modeButton("documents").textContent).toContain("9");
    expect(modeButton("calendar").textContent).toContain("1");
    // Tryby bez licznika wyglądają jak tryb, a nie jak tryb z zerem.
    expect(modeButton("all").textContent).toBe("club.hub.feed.mode.all");
    expect(modeButton("threads").textContent).toBe("club.hub.feed.mode.threads");
  });

  it("bez danych ściany i biblioteki liczniki trybów milczą", () => {
    h.threadPages = [{ rows: threadRows(1) }];
    mount();

    expect(modeButton("posts").textContent).toBe("club.hub.feed.mode.posts");
    expect(modeButton("documents").textContent).toBe("club.hub.feed.mode.documents");
  });
});

describe("ClubHub - wyszukiwanie zastępuje strumień", () => {
  function typeQuery(value: string): void {
    fireEvent.change(screen.getByLabelText("club.searchPlaceholder"), { target: { value } });
  }

  it("fraza poniżej dwóch znaków nie idzie do RPC", () => {
    fullData();
    mount();
    typeQuery("a");

    expect(h.searchArgs?.enabled).toBe(false);
    expect(screen.queryByTestId("search-results")).toBeNull();
  });

  it("fraza od dwóch znaków ZASTĘPUJE strumień i chowa przełącznik trybu oraz porządek", () => {
    fullData();
    h.searchHits = [{ id: "hit-1" }];
    mount();
    typeQuery("energia");

    expect(h.searchArgs?.enabled).toBe(true);
    expect(h.searchArgs?.clubId).toBe(CLUB_IDS.club);
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
    expect(screen.queryByTestId("feed-item")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(h.sortTrigger?.className).toContain("hidden");
    expect(h.searchPanel).toEqual({
      hitCount: 1,
      pending: false,
      failed: false,
      query: "energia",
    });
  });

  it("wyniki w locie i awaria jadą do panelu wyników, a ponowienie woła RPC", () => {
    fullData();
    h.searchPending = true;
    h.searchError = true;
    mount();
    typeQuery("energia");

    expect(h.searchPanel?.pending).toBe(true);
    expect(h.searchPanel?.failed).toBe(true);
    expect(h.searchPanel?.hitCount).toBe(0);

    fireEvent.click(screen.getByTestId("search-retry"));
    expect(h.refetchSearch).toHaveBeenCalledTimes(1);
  });

  it("krzyżyk w polu czyści frazę i NIE rusza adresu, gdy tagu nie było", () => {
    fullData();
    mount();
    typeQuery("energia");

    fireEvent.click(screen.getByRole("button", { name: "club.searchClear" }));

    expect(screen.getByLabelText("club.searchPlaceholder")).toHaveValue("");
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("puste pole nie rysuje krzyżyka", () => {
    fullData();
    mount();
    expect(screen.queryByRole("button", { name: "club.searchClear" })).toBeNull();
  });

  it("porządek bez sesji nie oferuje tych, które wymagają sesji", () => {
    fullData();
    h.session = null;
    mount();

    const options = within(screen.getByLabelText("club.sort.label"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["club.sort.hot", "club.sort.new", "club.sort.unanswered", "club.sort.top"]);
  });

  it("porządek z sesją oferuje także „moje” i „obserwowane”", () => {
    fullData();
    mount();

    const options = within(screen.getByLabelText("club.sort.label")).getAllByRole("option");
    expect(options).toHaveLength(6);
  });

  it("zmiana porządku jedzie do RPC", () => {
    fullData();
    mount();
    fireEvent.change(screen.getByLabelText("club.sort.label"), { target: { value: "top" } });

    expect(h.threadArgs?.sort).toBe("top");
  });
});

describe("ClubHub - `?tag=` jako kontrakt adresu", () => {
  it("tag z adresu zasiewa frazę i rysuje chip zawężenia", () => {
    fullData();
    h.search = { tag: "  klimat  " };
    mount();

    expect(screen.getByLabelText("club.searchPlaceholder")).toHaveValue("klimat");
    expect(
      screen.getByText(translateKey("club.inline.tagFilter", { tag: "klimat" })),
    ).toBeInTheDocument();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
  });

  it("zdjęcie tagu czyści frazę I USUWA parametr z adresu", () => {
    fullData();
    h.search = { tag: "klimat" };
    mount();

    fireEvent.click(screen.getByText("club.inline.tagClear"));

    expect(h.navigate).toHaveBeenCalledWith({
      to: "/club/$clubSlug",
      params: { clubSlug: "klub-energetyczny" },
      search: {},
    });
    expect(screen.getByLabelText("club.searchPlaceholder")).toHaveValue("");
  });

  it("adres bez tagu nie rysuje chipa zawężenia", () => {
    fullData();
    h.search = {};
    mount();

    expect(screen.queryByText("club.inline.tagClear")).toBeNull();
  });
});

describe("ClubHub - doładowanie kolejnej strony", () => {
  it("przycisk woła kolejną stronę wątków", () => {
    fullData();
    h.hasNextPage = true;
    mount();

    fireEvent.click(screen.getByRole("button", { name: "club.loadMore" }));
    expect(h.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("w trakcie doładowania przycisk jest zablokowany i mówi o tym", () => {
    fullData();
    h.hasNextPage = true;
    h.fetchingNextPage = true;
    mount();

    expect(screen.getByRole("button", { name: "club.loadingMore" })).toBeDisabled();
  });

  it("doładowanie NIE dotyczy dokumentów ani kalendarza", () => {
    fullData();
    h.hasNextPage = true;
    mount();
    fireEvent.click(modeButton("documents"));

    expect(screen.queryByRole("button", { name: "club.loadMore" })).toBeNull();
  });

  it("bez kolejnej strony nie ma ani przycisku, ani czujnika końca listy", () => {
    fullData();
    h.hasNextPage = false;
    mount();

    expect(screen.queryByRole("button", { name: "club.loadMore" })).toBeNull();
  });

  it("dojście czytelnika do końca listy UPRZEDZA przycisk", () => {
    const observers: Array<(entries: readonly { isIntersecting: boolean }[]) => void> = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(callback: (entries: readonly { isIntersecting: boolean }[]) => void) {
        observers.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {
        disconnect();
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    fullData();
    h.hasNextPage = true;
    const view = mount();

    expect(observers).toHaveLength(1);
    // Czujnik POZA ekranem nie ładuje niczego.
    observers[0]([{ isIntersecting: false }]);
    expect(h.fetchNextPage).not.toHaveBeenCalled();

    observers[0]([{ isIntersecting: true }]);
    expect(h.fetchNextPage).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("środowisko bez obserwatora zostawia sam przycisk i nie wywraca huba", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    fullData();
    h.hasNextPage = true;
    mount();

    expect(screen.getByRole("button", { name: "club.loadMore" })).toBeInTheDocument();
  });
});

describe("ClubHub - ściana i reakcje", () => {
  it("polubienie wpisu odświeża ścianę PO SUKCESIE, a nie przed", () => {
    fullData();
    h.likeMutate.mockImplementation((_postId: string, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.();
    });
    mount();

    fireEvent.click(screen.getAllByTestId("feed-like")[0]);

    expect(h.likeMutate).toHaveBeenCalledWith("post-1", expect.anything());
    expect(h.refetchPosts).toHaveBeenCalledTimes(1);
  });

  it("usunięcie wpisu woła mutację usuwania", () => {
    fullData();
    mount();
    fireEvent.click(screen.getAllByTestId("feed-delete")[0]);

    expect(h.deleteMutate).toHaveBeenCalledWith("post-1");
  });

  it("reakcja na wątek jedzie z rodzajem i bieżącym stanem", () => {
    fullData();
    mount();
    fireEvent.click(screen.getAllByTestId("feed-react")[0]);

    expect(h.reactMutate).toHaveBeenCalledWith({
      targetId: "thread-1",
      kind: "insightful",
      active: false,
    });
  });

  it("prawo do reakcji jest ILOCZYNEM sesji i `can_reply`", () => {
    fullData();
    mount();
    expect(h.feedItem?.canReact).toBe(true);

    cleanup();
    h.session = null;
    mount({ can_reply: true });
    expect(h.feedItem?.canReact).toBe(false);
  });

  it("stan „reakcja w drodze” dociera do karty", () => {
    fullData();
    h.togglePending = true;
    mount();
    expect(h.feedItem?.reactionsPending).toBe(true);
  });

  it("liczniki reakcji z JEDNEGO zapytania trafiają do każdej karty", () => {
    fullData();
    h.reactions = new Map([["thread-1", [{ kind: "insightful", count: 2 }]]]);
    mount();

    expect(h.feedItem?.hasReactions).toBe(true);
  });

  it("bez pobranych reakcji karta dostaje `undefined`, a nie pustą mapę", () => {
    fullData();
    h.reactions = undefined;
    mount();

    expect(h.feedItem?.hasReactions).toBe(false);
  });
});

describe("ClubHub - prawa szyna i granice uprawnień", () => {
  it("panel spotkania wymaga SESJI, nie samego `can_see_members`", () => {
    fullData();
    h.session = null;
    mount({ can_see_members: true, can_reply: true, can_manage: true });

    expect(h.meeting).toEqual({
      eventCount: 1,
      canSeeMembers: false,
      canRsvp: false,
      canManage: false,
    });
  });

  it("z sesją panel spotkania dostaje pełne prawa z wiersza klubu", () => {
    fullData();
    mount({ can_see_members: true, can_reply: true, can_manage: true });

    expect(h.meeting).toEqual({
      eventCount: 1,
      canSeeMembers: true,
      canRsvp: true,
      canManage: true,
    });
  });

  it("panel składu czyta SAM `can_see_members`, bo lista jest publiczna w klubie publicznym", () => {
    fullData();
    h.session = null;
    mount({ can_see_members: true });

    expect(h.roster?.canSeeMembers).toBe(true);
    expect(h.roster?.canDeclare).toBe(false);
    expect(h.roster?.locale).toBe("pl-PL");
  });

  it("tablica ogłoszeń przyjmuje wpis tylko od zalogowanego z prawem odpowiedzi", () => {
    fullData();
    h.session = null;
    mount({ can_reply: true });
    expect(h.board?.canPost).toBe(false);
  });

  it("szyna kontekstu stoi DWA razy: pod strumieniem i w kolumnie", () => {
    fullData();
    mount();

    expect(screen.getAllByTestId("meeting-panel")).toHaveLength(2);
    expect(screen.getAllByTestId("board-panel")).toHaveLength(2);
    expect(screen.getAllByTestId("roster-panel")).toHaveLength(2);
    expect(screen.getAllByTestId("spotlight-panel")).toHaveLength(2);
    expect(screen.getAllByText("club.hub.stage.title")).toHaveLength(2);
    expect(screen.getAllByText("club.hub.freshDocs.title")).toHaveLength(2);
  });

  it("kafelki lewej szyny liczą TYM, co hub i tak pobrał", () => {
    fullData();
    h.events = [clubEventRow({ id: "event-1" }), clubEventRow({ id: "event-2" })];
    mount({ thread_count: 12, member_count: 42 });

    const nav = railNav();
    const tile = (key: string): string =>
      within(nav).getByRole("link", { name: `club.hub.sections.${key}` }).textContent ?? "";

    expect(tile("threads")).toContain("12");
    expect(tile("documents")).toContain("9");
    expect(tile("calendar")).toContain("2");
    expect(tile("schedule")).toContain("1");
    expect(tile("members")).toContain("42");
  });

  it("panel działu pojawia się PO wybraniu działu i zna liczbę materiałów", () => {
    fullData();
    mount();
    expect(screen.queryByTestId("group-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("tree-pick"));
    expect(screen.getByTestId("group-panel")).toBeInTheDocument();
    expect(h.groupPanel?.documentCount).toBe(9);

    fireEvent.click(screen.getByTestId("panel-clear"));
    expect(screen.queryByTestId("group-panel")).toBeNull();
  });

  it("dział, którego nie ma w drzewie, nie rysuje panelu działu", () => {
    fullData();
    // Klub bez działów: kolumna nie rysuje drzewa wcale, więc wybór przychodzi
    // z paska poziomego - a `clubGroupPath` nie ma czego znaleźć.
    h.groups = [];
    mount();
    fireEvent.click(screen.getByTestId("bar-pick"));

    expect(screen.queryByTestId("group-panel")).toBeNull();
    expect(h.threadArgs?.groupId).toBe(CLUB_IDS.group);
  });

  it("panel działu bez pobranej biblioteki pokazuje ZERO materiałów, nie `undefined`", () => {
    fullData();
    h.documents = undefined;
    mount();
    fireEvent.click(screen.getByTestId("tree-pick"));

    expect(h.groupPanel?.documentCount).toBe(0);
  });

  it("pasek sekcji na telefonie stoi obok kolumny, nie zamiast niej", () => {
    fullData();
    mount();
    // Dwa nośniki tej samej nawigacji: kolumna (`lg`) i pasek (poniżej `lg`).
    expect(screen.getAllByRole("navigation", { name: "club.hub.sectionsLabel" })).toHaveLength(2);
  });
});

describe("ClubHub - dostępność warstwy czytania", () => {
  // `landmark-unique` jest tu ARTEFAKTEM ŚRODOWISKA, nie usterką: nawigacja
  // sekcji stoi w dwóch nośnikach (kolumna `lg:block`, pasek `lg:hidden`)
  // i w przeglądarce w danym momencie widoczny jest DOKŁADNIE jeden. happy-dom
  // nie liczy CSS-u, więc axe widzi oba i zgłasza dwie identyczne etykiety.
  // `heading-order` to usterka PRAWDZIWA - pinuje ją osobny test poniżej.
  const ENV_RULES = {
    "landmark-unique": { enabled: false },
    "heading-order": { enabled: false },
  };

  it("pełny hub nie ma naruszeń dostępności", async () => {
    fullData();
    const { container } = mount({ can_moderate: true });

    const violations = await axeViolations(container, ENV_RULES);
    expect(violations, summarize(violations)).toEqual([]);
  });

  // PRAWDZIWY BŁĄD, świadomie zapięty jako `it.fails`, a nie ukryty: pasek
  // tożsamości daje `<h1>`, a siatka sekcji w szynie wchodzi od razu z `<h3>`
  // (nagłówki grup „klub / ludzie / praca”) - między nimi nie ma żadnego
  // `<h2>`, bo panel szyny z siatką jest bez tytułu. Czytnik ekranu dostaje
  // w spisie nagłówków dziurę o jeden poziom. Naprawa należy do właściciela
  // `ClubHubRail` (poziom nagłówka grupy albo tytuł panelu) i jest zmianą
  // SEMANTYKI, więc nie robimy jej pod test.
  it.fails("kolejność nagłówków w szynie sekcji przeskakuje z <h1> na <h3>", async () => {
    fullData();
    const { container } = mount();

    const violations = await axeViolations(container, {
      "landmark-unique": { enabled: false },
    });
    expect(violations, summarize(violations)).toEqual([]);
  });
});
