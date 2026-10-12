// DYSKUSJE na froncie: to, co po zepsuciu albo ujawnia nazwisko w rozmowie
// prowadzonej w regule Chatham House, albo pokazuje atrapę tam, gdzie miało
// stać jedno zdanie zaproszenia.
//
// PIĘĆ RZECZY, KTÓRE MUSZĄ TRZYMAĆ:
// 1. wydarzenie BEZ przypiętej grupy klubu pokazuje JEDNO ZDANIE zaproszenia -
//    nie pustą ramkę, nie atrapę rozmowy i nie komunikat o błędzie,
// 2. odmowa dostępu z `club_capabilities` zamienia się w zdanie z NASTĘPNYM
//    KROKIEM (kod stanu -> klucz słownika), a nie w surowy kod,
// 3. każdy wiersz wątku jest ODNOŚNIKIEM do wątku w klubie - ten komponent nie
//    jest drugim silnikiem dyskusji,
// 4. wątek anonimowy (tryb Chatham House grupy) rysuje etykietę uczestnika,
//    a nie puste miejsce po nazwisku - i NIE jest przyciskiem okna profilu,
// 5. autor podpisany nazwiskiem otwiera okno profilu (z firmą z profilu
//    członka), a przycisk autora nie siedzi w odnośniku wątku.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { EventDiscussions } from "@/lib/events/publicEventApi";
import type { MemberProfile } from "@/lib/profile/memberProfile";

const fetchDiscussions = vi.fn<() => Promise<EventDiscussions>>();
const fetchMemberProfile = vi.fn<(slug: string) => Promise<MemberProfile | null>>();

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

// `useRouter` bez routera to `null`: `AppLink` w oknie profilu rysuje wtedy
// zwykłe `<a href>` bez przechwytywania nawigacji.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => null,
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={`${to}:${JSON.stringify(params ?? {})}`} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/events/publicEventApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events/publicEventApi")>(
    "@/lib/events/publicEventApi",
  );
  return {
    ...actual,
    fetchEventDiscussions: () => fetchDiscussions(),
    // Źródła wzbogacające okno (program, partnerzy) budzi pierwszy sygnał
    // zamiaru na autorze - w teście są puste, bez sieci.
    fetchEventAgenda: () => Promise.resolve([]),
    fetchEventSponsors: () => Promise.resolve([]),
  };
});

// Identyfikator wydarzenia dla katalogu okien - bez sieci; `null` wyłącza też
// zapytanie o prelegentów (czeka na identyfikator).
vi.mock("@/lib/community/publicQueries", async () => {
  const actual = await vi.importActual<typeof import("@/lib/community/publicQueries")>(
    "@/lib/community/publicQueries",
  );
  return {
    ...actual,
    publicEventBySlugQueryOptions: (slug: string) => ({
      queryKey: ["public-event", slug],
      queryFn: () => Promise.resolve(null),
    }),
  };
});

// Autor wątku przychodzi z samym nazwiskiem - stanowisko i firmę zna profil
// członka, o który okno pyta dopiero po kliknięciu.
vi.mock("@/lib/profile/memberProfile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/memberProfile")>(
    "@/lib/profile/memberProfile",
  );
  return {
    ...actual,
    memberProfileQueryOptions: (slug: string, userId: string | null) => ({
      queryKey: ["member-profile", slug, userId],
      queryFn: () => fetchMemberProfile(slug),
    }),
  };
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

const THREAD_HREF =
  '/club/$clubSlug/t/$threadSlug:{"clubSlug":"klub-cee","threadSlug":"czy-europa-ma-plan"}';
const OPEN_ANNA = 'eventFront.directory.openPerson:{"name":"Anna Adamska"}';

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

function memberProfile(over: Partial<MemberProfile> = {}): MemberProfile {
  return {
    id: "p1",
    slug: "anna-adamska",
    display_name: "Anna Adamska",
    avatar_url: null,
    cover_url: null,
    job_title: "Analityczka ds. energii",
    company: "WiseEuropa",
    location: null,
    bio_pl: null,
    bio_en: null,
    specialization: null,
    linkedin_url: null,
    website_url: null,
    verified: false,
    is_self: false,
    is_author: false,
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
  authState.user = { id: "u1" };
  fetchDiscussions.mockResolvedValue(discussions());
  fetchMemberProfile.mockResolvedValue(memberProfile());
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
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("odmowa dostępu z klubu zamienia się w zdanie, nie w surowy kod", async () => {
    fetchDiscussions.mockResolvedValue(
      discussions({ state: "not_open_yet", threads: [], totalCount: 0 }),
    );
    renderList();

    expect(await screen.findByText("eventFront.discussions.state.notOpenYet")).toBeInTheDocument();
    expect(screen.queryByText("not_open_yet")).not.toBeInTheDocument();
  });

  it("wiersz wątku prowadzi do wątku W KLUBIE", async () => {
    renderList();

    expect(await screen.findByText("Czy Europa ma plan")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", THREAD_HREF);
    expect(screen.getByText('eventFront.discussions.replies:{"count":4}')).toBeInTheDocument();
    expect(
      screen.getByText('eventFront.directory.participantsCount:{"count":3}'),
    ).toBeInTheDocument();
  });

  it("cały wiersz otwiera wątek, a przycisk autora leży obok odnośnika, nie w nim", async () => {
    renderList();

    const link = (await screen.findByText("Czy Europa ma plan")).closest("a");
    expect(link).toHaveAttribute("href", THREAD_HREF);
    // Rozciągnięty odnośnik: jego `::after` przykrywa wiersz `li.relative`.
    expect(link).toHaveClass("after:absolute", "after:inset-0");
    const row = link?.closest("li");
    expect(row).toHaveClass("relative");

    const author = screen.getByRole("button", { name: OPEN_ANNA });
    expect(author).toHaveAttribute("aria-haspopup", "dialog");
    expect(author).toHaveClass("relative", "z-10");
    expect(link).not.toContainElement(author);
    expect(row).toContainElement(author);
    // Jedyny odnośnik wiersza to wątek - zero zagnieżdżonych celów kliknięcia.
    expect(within(row as HTMLElement).getAllByRole("link")).toEqual([link]);
  });

  it("klik w autora otwiera okno profilu z nazwiskiem i firmą z profilu członka", async () => {
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: OPEN_ANNA }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Anna Adamska" })).toBeInTheDocument();
    expect(within(dialog).getByText("eventFront.directory.kind.author")).toBeInTheDocument();
    expect(await within(dialog).findByText("Analityczka ds. energii")).toBeInTheDocument();
    expect(fetchMemberProfile).toHaveBeenCalledWith("anna-adamska");

    // Firma z profilu członka prowadzi dalej - do okna instytucji, w tym samym oknie.
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: 'eventFront.directory.openCompany:{"name":"WiseEuropa"}',
      }),
    );
    expect(await within(dialog).findByRole("heading", { name: "WiseEuropa" })).toBeInTheDocument();
  });

  it("profilu autora nie pobiera nikt, kto okna nie otworzył", async () => {
    renderList();

    await screen.findByRole("button", { name: OPEN_ANNA });
    expect(fetchMemberProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wątek anonimowy pokazuje etykietę uczestnika, nie puste miejsce i nie przycisk", async () => {
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
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("eventFront.discussions.anonymousAuthor").closest("button")).toBeNull();
  });

  it("anonimowość wygrywa z nazwiskiem, które przyszło mimo flagi", async () => {
    fetchDiscussions.mockResolvedValue(discussions({ threads: [thread({ isAnonymous: true })] }));
    renderList();

    expect(await screen.findByText("eventFront.discussions.anonymousAuthor")).toBeInTheDocument();
    expect(screen.queryByText("Anna Adamska")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OPEN_ANNA })).toBeNull();
  });

  it("autor bez slugu profilu jest podpisem, nie przyciskiem okna", async () => {
    fetchDiscussions.mockResolvedValue(discussions({ threads: [thread({ authorSlug: null })] }));
    renderList();

    expect(await screen.findByText("Anna Adamska")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: OPEN_ANNA })).toBeNull();
  });

  it("wątek przypięty i ostatnia aktywność mówią się w wierszu", async () => {
    fetchDiscussions.mockResolvedValue(
      discussions({
        threads: [
          thread({
            pinnedAt: "2026-10-01T08:00:00Z",
            createdAt: "2026-10-01T08:00:00Z",
            lastReplyAt: "2026-10-09T12:00:00Z",
            participantCount: 0,
          }),
        ],
      }),
    );
    const { container } = renderList();

    expect(await screen.findByText("eventFront.directory.pinned")).toBeInTheDocument();
    expect(screen.getByText("eventFront.discussions.kind.question")).toBeInTheDocument();
    // Ostatnia odpowiedź wygrywa z datą założenia; znacznik maszynowy zostaje ISO.
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", "2026-10-09T12:00:00Z");
    expect(time?.textContent).toMatch(
      /^eventFront\.directory\.lastActivity:\{"date":"9 .+2026"\}$/,
    );
    // Zero osób w rozmowie to brak licznika, nie „0 osób”.
    expect(screen.queryByText(/participantsCount/)).toBeNull();
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

  it("podpis listy mówi, ile wątków czeka w klubie, gdy lista jest przycięta", async () => {
    fetchDiscussions.mockResolvedValue(discussions({ totalCount: 34 }));
    renderList();

    expect(await screen.findByText("Klub CEE · Kongres")).toBeInTheDocument();
    expect(screen.getByText('eventFront.directory.threadsCount:{"count":34}')).toBeInTheDocument();
  });
});
