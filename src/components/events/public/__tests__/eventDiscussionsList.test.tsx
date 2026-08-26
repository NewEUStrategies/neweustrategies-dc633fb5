// DYSKUSJE na froncie: to, co po zepsuciu albo ujawnia nazwisko w rozmowie
// prowadzonej w regule Chatham House, albo pokazuje atrapę tam, gdzie miało
// stać jedno zdanie zaproszenia.
//
// CZTERY RZECZY, KTÓRE MUSZĄ TRZYMAĆ:
// 1. wydarzenie BEZ przypiętej grupy klubu pokazuje JEDNO ZDANIE zaproszenia -
//    nie pustą ramkę, nie atrapę rozmowy i nie komunikat o błędzie,
// 2. odmowa dostępu z `club_capabilities` zamienia się w zdanie z NASTĘPNYM
//    KROKIEM (kod stanu -> klucz słownika), a nie w surowy kod,
// 3. każda karta wątku jest ODNOŚNIKIEM do wątku w klubie - ten komponent nie
//    jest drugim silnikiem dyskusji,
// 4. wątek anonimowy (tryb Chatham House grupy) rysuje etykietę uczestnika,
//    a nie puste miejsce po nazwisku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { EventDiscussions } from "@/lib/events/publicEventApi";

const fetchDiscussions = vi.fn<() => Promise<EventDiscussions>>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}:${JSON.stringify(options)}`,
    i18n: { language: "pl", exists: () => true, changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const authState = { user: { id: "u1" } as { id: string } | null };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: unknown;
  }) => (
    <a href={`${to}:${JSON.stringify(params ?? {})}`} {...rest}>
      {children as never}
    </a>
  ),
}));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return { ...actual, fetchEventDiscussions: () => fetchDiscussions() };
});

const { EventDiscussionsList } =
  await import("@/components/events/public/organisms/EventDiscussionsList");

const CLUB = {
  id: "c1",
  slug: "klub-cee",
  namePl: "Klub CEE",
  nameEn: "CEE Club",
  icon: "MessagesSquare",
  accentColor: null,
};

function thread(over: Partial<EventDiscussions["threads"][number]> = {}) {
  return {
    id: "t1",
    slug: "czy-europa-ma-plan",
    title: "Czy Europa ma plan",
    excerpt: "Fragment wątku",
    kind: "question",
    status: "open",
    isAnonymous: false,
    authorName: "Anna Adamska",
    authorAvatar: null,
    authorSlug: "anna-adamska",
    replyCount: 4,
    participantCount: 3,
    pinnedAt: null,
    lastReplyAt: null,
    createdAt: null,
    ...over,
  };
}

function discussions(over: Partial<EventDiscussions> = {}): EventDiscussions {
  return {
    state: "ok",
    club: CLUB,
    group: {
      id: "g1",
      slug: "kongres",
      namePl: "Kongres",
      nameEn: "Congress",
      status: "active",
    },
    attribution: "attributed",
    canPost: false,
    totalCount: 1,
    threads: [thread()],
    ...over,
  };
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EventDiscussionsList slug="kongres" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchDiscussions.mockResolvedValue(discussions());
});

describe("EventDiscussionsList", () => {
  it("bez przypiętej grupy klubu pokazuje jedno zdanie zaproszenia", async () => {
    fetchDiscussions.mockResolvedValue(
      discussions({ state: "not_configured", club: null, group: null, threads: [], totalCount: 0 }),
    );
    renderList();

    expect(await screen.findByText("eventFront.discussions.invite")).toBeInTheDocument();
    expect(screen.queryByText("eventFront.discussions.empty")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("odmowa dostępu z klubu zamienia się w zdanie, nie w surowy kod", async () => {
    fetchDiscussions.mockResolvedValue(
      discussions({ state: "not_open_yet", threads: [], totalCount: 0 }),
    );
    renderList();

    expect(await screen.findByText("eventFront.discussions.state.notOpenYet")).toBeInTheDocument();
    expect(screen.queryByText("not_open_yet")).not.toBeInTheDocument();
  });

  it("karta wątku prowadzi do wątku W KLUBIE", async () => {
    renderList();

    expect(await screen.findByText("Czy Europa ma plan")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute(
      "href",
      '/club/$clubSlug/t/$threadSlug:{"clubSlug":"klub-cee","threadSlug":"czy-europa-ma-plan"}',
    );
    expect(screen.getByText('eventFront.discussions.replies:{"count":4}')).toBeInTheDocument();
  });

  it("wątek anonimowy pokazuje etykietę uczestnika, nie puste miejsce", async () => {
    fetchDiscussions.mockResolvedValue(
      discussions({
        attribution: "chatham",
        threads: [thread({ isAnonymous: true, authorName: null, authorSlug: null })],
      }),
    );
    renderList();

    expect(await screen.findByText("eventFront.discussions.anonymousAuthor")).toBeInTheDocument();
    // Reguła jest powiedziana WPROST, zanim ktokolwiek napisze.
    expect(screen.getByText("eventFront.discussions.chathamNote")).toBeInTheDocument();
    expect(screen.queryByText("Anna Adamska")).not.toBeInTheDocument();
  });

  it("przycisk zakładania wątku pojawia się TYLKO z prawem z club_capabilities", async () => {
    renderList();
    await screen.findByText("Czy Europa ma plan");
    expect(screen.queryByText("eventFront.discussions.startThread")).not.toBeInTheDocument();

    fetchDiscussions.mockResolvedValue(discussions({ canPost: true }));
    renderList();
    expect(await screen.findByText("eventFront.discussions.startThread")).toBeInTheDocument();
  });

  it("grupa bez wątków mówi, że jest pusta - i nadal prowadzi do klubu", async () => {
    fetchDiscussions.mockResolvedValue(discussions({ threads: [], totalCount: 0 }));
    renderList();

    expect(await screen.findByText("eventFront.discussions.empty")).toBeInTheDocument();
    expect(
      screen.getByText('eventFront.discussions.openInClub:{"club":"Klub CEE"}'),
    ).toBeInTheDocument();
  });
});
