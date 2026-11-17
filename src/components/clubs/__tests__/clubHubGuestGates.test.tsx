// Hub klubu (`ClubHub`) u GOŚCIA: panele ludzi z PRAWDZIWYMI molekułami.
//
// CO TEN PLIK DOWODZI. Tablica „Szukam / Oferuję” (`club_board_notices_list`),
// skład z sygnałem obecności (`club_roster_signal`) i „poznaj członka”
// (`club_member_spotlight_current`) nie mają EXECUTE dla `anon`. Hub montował
// je bezwarunkowo, więc KAŻDE wejście gościa do klubu publicznego kończyło się
// trzema odrzuconymi żądaniami (plus ponowienia), a szkielet tablicy i składu
// z HTML-u serwera zapadał się po porażce. Tu panele są prawdziwe, a atrapą
// jest dopiero warstwa sieci - więc „gość nie pyta” jest asercją o FUNKCJACH
// wołających RPC, a nie o propsach.
//
// DRUGA OŚ: HYDRATACJA. Dokument SSR jest anonimowy; leniwa trasa huba bywa
// hydratowana PO rozstrzygnięciu sesji. Bramka na samej sesji dałaby wtedy
// inny pierwszy render klienta niż HTML serwera (AGENTS.md: hub klubu
// z `useHydrated`). Dowód: `renderToString` gościa + `hydrateRoot` z sesją,
// zero błędów do odzyskania, a panele wchodzą dopiero po hydratacji.
//
// CZEGO NIE DUBLUJE. Kontrakt argumentów, strumień, filtry i propsy paneli -
// `clubHubOrganisms.test.tsx` (tam panele są atrapami). Stany paneli -
// `clubMoleculePanels.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: ({ activeOptions: _activeOptions, ...rest }: { activeOptions?: unknown }) => (
      <RouterLinkStub {...rest} />
    ),
    useNavigate: () => vi.fn(),
    useSearch: () => ({}),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    isStaff: false,
    loading: false,
  }),
}));

vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

vi.mock("@/lib/clubs/useClubTopics", () => ({
  useClubTopics: () => ({ topics: [], isLoading: false }),
}));

// Strumień i konteksty: puste, ale ROZSTRZYGNIĘTE - hub rysuje pełną powłokę.
vi.mock("@/lib/clubs/useClubs", () => {
  const page = {
    data: { pages: [{ rows: [] }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
    refetch: () => undefined,
  };
  return {
    useClubGroups: () => ({ data: [] }),
    useClubThreads: () => page,
    useClubSearch: () => ({ data: [], isPending: false, isError: false, refetch: () => undefined }),
    useClubReactions: () => ({ data: undefined }),
    useClubReactionActors: () => ({ data: undefined }),
    useToggleClubReaction: () => ({ mutate: () => undefined, isPending: false }),
  };
});

vi.mock("@/lib/clubs/useClubWorkspace", () => ({
  useClubDocuments: () => ({ data: { rows: [], total: 0 } }),
  useClubEvents: () => ({ data: [] }),
  useClubMilestones: () => ({ data: [] }),
}));

vi.mock("@/lib/clubs/useClubPosts", () => ({
  useClubPosts: () => ({
    data: { pages: [{ rows: [], total: 0 }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => undefined,
    refetch: () => undefined,
  }),
  useDeleteClubPost: () => ({ mutate: () => undefined }),
  useToggleClubPostLike: () => ({ mutate: () => undefined }),
  useClubMediaUrls: () => ({}),
}));

// WARSTWA SIECI - jedyna atrapa pod panelami ludzi.
vi.mock(
  "@/lib/clubs/networkApi",
  async () => (await import("@/test/clubs/workspaceApiMock")).networkApiMock,
);
vi.mock("@/components/network/MessageOrConnectButton", async () =>
  (await import("@/test/clubs/networkScreenStubs")).messageOrConnectStub(),
);
vi.mock("@/components/clubs/molecules/ClubRosterFaces", () => ({
  ClubRosterFaces: () => <div data-testid="twarze" />,
}));

// Reszta szyny i strumienia nie jest przedmiotem dowodu.
vi.mock("@/components/clubs/molecules/ClubMeetingPanel", () => ({ ClubMeetingPanel: () => null }));
vi.mock("@/components/clubs/molecules/ClubCreatePanel", () => ({ ClubCreatePanel: () => null }));
vi.mock("@/components/clubs/molecules/ClubStreamFilters", () => ({
  ClubStreamFilters: () => null,
}));
vi.mock("@/components/clubs/molecules/ClubThreadTopicBar", () => ({
  ClubThreadTopicBar: () => null,
}));
vi.mock("@/components/clubs/molecules/ClubGroupTree", () => ({
  ClubGroupBar: () => null,
  ClubGroupTree: () => null,
}));
vi.mock("@/components/clubs/molecules/ClubCoverEditor", () => ({ ClubCoverEditor: () => null }));
vi.mock("@/components/clubs/organisms/ClubFeedItem", () => ({ ClubFeedItem: () => null }));
vi.mock("@/components/clubs/organisms/ClubGlobalSearch", () => ({
  ClubGlobalSearchResults: () => null,
}));
vi.mock("@/components/mentions/MentionDirectory", () => ({
  MentionDirectoryProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useMentionEntity: () => null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

import { ClubHub } from "@/components/clubs/organisms/ClubHub";
import { networkApiMock, resetNetworkApiMock } from "@/test/clubs/workspaceApiMock";
import { boardNoticeRow, spotlightRow } from "@/test/clubs/networkScreenFixtures";
import { CLUB_IDS, clubViewRow } from "@/test/clubs/fixtures";

const ME = { user: { id: CLUB_IDS.me } };

/** Klub publiczny, w którym GOŚĆ czyta (`can_read`) - stan z gałęzi `anon`. */
const club = clubViewRow({ can_read: true, can_reply: true, can_see_members: true });

function hub(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ClubHub club={club} />
    </QueryClientProvider>
  );
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Trzy odczyty, które `anon` dostaje z 42501. */
function peopleReads(): number {
  return (
    networkApiMock.fetchClubBoardNotices.mock.calls.length +
    networkApiMock.fetchClubRosterSignal.mock.calls.length +
    networkApiMock.fetchClubSpotlight.mock.calls.length
  );
}

/** HTML serwera (dokument SSR jest ZAWSZE anonimowy) w kontenerze w DOM-ie. */
function serverHost(): HTMLDivElement {
  const session = h.session;
  h.session = null;
  const host = document.createElement("div");
  host.innerHTML = renderToString(hub(freshClient()));
  document.body.append(host);
  h.session = session;
  return host;
}

async function hydrate(host: HTMLDivElement) {
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(host, hub(freshClient()), {
      onRecoverableError: (error) => errors.push(error),
    });
  });
  return {
    errors,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  resetNetworkApiMock();
  networkApiMock.fetchClubBoardNotices.mockResolvedValue({
    rows: [boardNoticeRow({ body: "Szukam danych o magazynach energii" })],
    total: 1,
  });
  networkApiMock.fetchClubRosterSignal.mockResolvedValue({
    membersTotal: 12,
    new7d: 1,
    active24h: 2,
    active7d: 4,
    faces: [],
  });
  networkApiMock.fetchClubSpotlight.mockResolvedValue(spotlightRow());
  h.session = null;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ClubHub - panele ludzi u gościa (RPC zamknięte dla `anon`)", () => {
  it("gość: hub NIE pyta o tablicę, skład ani wyróżnienie i nie rysuje ich paneli", async () => {
    render(hub(freshClient()));

    // Strumień stoi (pusty klub), więc hub naprawdę się wyrenderował.
    expect(await screen.findAllByText("club.noThreads")).not.toHaveLength(0);
    expect(peopleReads()).toBe(0);
    expect(screen.queryByText("club.network.board.title")).toBeNull();
    expect(screen.queryByText("club.network.roster.title")).toBeNull();
    expect(screen.queryByText("club.network.spotlight.title")).toBeNull();
  });

  it("zalogowany: panele pytają jak dotąd i pokazują treść", async () => {
    h.session = ME;
    render(hub(freshClient()));

    expect(await screen.findAllByText("Szukam danych o magazynach energii")).not.toHaveLength(0);
    expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: CLUB_IDS.club }),
    );
    expect(networkApiMock.fetchClubRosterSignal).toHaveBeenCalledWith(CLUB_IDS.club, 24);
    expect(networkApiMock.fetchClubSpotlight).toHaveBeenCalledWith(CLUB_IDS.club);
    expect(screen.getAllByText("club.network.roster.title")).not.toHaveLength(0);
    expect(screen.getAllByText("club.network.spotlight.title")).not.toHaveLength(0);
  });

  it("HTML serwera nie niesie szkieletów paneli ludzi - nie ma czego zapadać u gościa", () => {
    const host = serverHost();
    expect(host.textContent).not.toContain("club.network.board.title");
    expect(host.textContent).not.toContain("club.network.roster.title");
    expect(host.querySelector("[aria-busy='true']")).toBeNull();
  });

  it("SSR gościa + hydratacja gościa: zero błędów hydratacji i zero zapytań o ludzi", async () => {
    const host = serverHost();
    const hydrated = await hydrate(host);
    try {
      expect(hydrated.errors).toEqual([]);
      // Dajemy szansę efektom zapytań - gdyby panel się zamontował, `fetch*`
      // poszedłby właśnie teraz.
      await act(async () => {
        await Promise.resolve();
      });
      expect(peopleReads()).toBe(0);
      expect(host.textContent).not.toContain("club.network.board.title");
    } finally {
      await hydrated.unmount();
    }
  });

  it("sesja rozstrzygnięta PRZED hydratacją: pierwszy render = HTML serwera, panele dopiero po nim", async () => {
    const host = serverHost();
    h.session = ME;
    const hydrated = await hydrate(host);
    try {
      expect(hydrated.errors).toEqual([]);
      await waitFor(() => expect(host.textContent).toContain("Szukam danych o magazynach energii"));
      expect(networkApiMock.fetchClubBoardNotices).toHaveBeenCalled();
    } finally {
      await hydrated.unmount();
    }
  });
});
