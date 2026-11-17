// `/club/$clubSlug/t/$threadSlug` - gość nie woła RPC, których `anon` nie ma.
//
// CO TEN PLIK DOWODZI. Gość czyta wątki klubu publicznego (`club_capabilities`
// daje `anon` prawo czytania), ale trzy funkcje tej strony NIE mają EXECUTE dla
// `anon`: `club_my_subscription` (odczyt dzwonka), `club_subscribe_thread`
// (zmiana dzwonka) i `club_thread_experts` (panel ekspertów). Do tej pory każde
// wejście gościa wysyłało odczyt subskrypcji i ekspertów (po dwa razy, z
// ponowieniem) i kończyło się 42501, a dzwonek po kliknięciu pokazywał „Nie
// udało się zapisać”.
//
// JAK. W odróżnieniu od `clubThreadRoute.test.tsx`, gdzie hooki są atrapami
// zapisującymi argumenty, tutaj hooki subskrypcji i ekspertów, przycisk
// obserwowania i panel ekspertów są PRAWDZIWE, a atrapą jest dopiero WARSTWA
// DANYCH (`@/lib/clubs/api`, `@/lib/clubs/networkApi`). Asercja „funkcja RPC
// nie została wywołana” stoi więc na tym samym poziomie, na którym produkcja
// wysyła żądanie - bez pośredniego wnioskowania z argumentów hooka.
//
// Atrapami są tylko odczyty TREŚCI wątku (karta klubu, wątek, odpowiedzi,
// reakcje), bo ich zachowanie ma własny plik i nie jest tu przedmiotem dowodu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  /** Sesja - `null` znaczy gość. */
  user: null as { id: string } | null,
  club: null as unknown,
  thread: null as unknown,
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.user === null ? null : { user: h.user },
    user: h.user,
    loading: false,
    isStaff: false,
  }),
}));

// Warstwa danych - JEDYNE atrapy na ścieżce dzwonka i ekspertów.
vi.mock("@/lib/clubs/api", () => clubApiMock);
vi.mock("@/lib/clubs/networkApi", () => networkApiMock);

// Odczyty treści wątku: atrapy ze stałymi danymi. Hooki subskrypcji
// (`useMyThreadSubscription`, `useSetThreadSubscription`) zostają PRAWDZIWE.
vi.mock("@/lib/clubs/useClubs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clubs/useClubs")>()),
  useClubBySlug: () => ({ data: h.club, isPending: false, isError: false, refetch: vi.fn() }),
  useClubThread: () => ({ data: h.thread, isPending: false, isError: false, refetch: vi.fn() }),
  useClubReplies: () => ({ data: { rows: [], total: 0 }, isPending: false }),
  useClubReactions: () => ({ data: undefined }),
  useClubReactionActors: () => ({ data: undefined }),
  useClubStanceSummary: () => ({ data: undefined }),
}));
vi.mock("@/lib/clubs/useClubWorkspace", () => ({
  useClubThreadWorkspace: () => ({ data: undefined }),
}));
vi.mock("@/lib/clubs/useClubTopics", () => ({ useClubTopics: () => ({ topics: [] }) }));

vi.mock("@/components/clubs/organisms/ClubPageFrame", () => ({
  ClubPageFrame: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/clubs/organisms/ClubThreadWorkspace", () => ({
  ClubThreadWorkspace: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/clubs/molecules/ClubReportButton", () => ({
  ClubReportButton: () => <span data-testid="report" />,
}));
vi.mock("@/components/clubs/atoms/ClubProse", () => ({
  ClubProse: ({ body }: { body: string }) => <div data-testid="prose">{body}</div>,
}));
vi.mock("@/components/mentions/MentionTextarea", () => ({
  MentionTextarea: ({ id, label }: { id?: string; label: string }) => (
    <textarea id={id} aria-label={label} readOnly />
  ),
}));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

import { QueryClient } from "@tanstack/react-query";
import { clubApiMock, resetClubApiMock } from "@/test/clubs/apiMock";
import { networkApiMock, resetNetworkApiMock } from "@/test/clubs/workspaceApiMock";
import { renderRoute } from "@/test/routeHarness";
import { CLUB_BASE_ISO, CLUB_IDS, clubViewRow } from "@/test/clubs/fixtures";
import { Route as ThreadRoute } from "@/routes/club.$clubSlug.t.$threadSlug";

const SLUG = "klub-energetyczny";
const THREAD_SLUG = "temat-pierwszy";

/** Wiersz `club_thread_view` wątku klubu PUBLICZNEGO, który gość może czytać. */
function threadRow(): Record<string, unknown> {
  return {
    id: CLUB_IDS.thread,
    club_id: CLUB_IDS.club,
    group_id: CLUB_IDS.group,
    slug: THREAD_SLUG,
    title: "Ceny energii w pakiecie zimowym",
    body: "Treść postu otwierającego.",
    kind: "discussion",
    status: "published",
    topic: "energy",
    icon: null,
    anchor_type: null,
    anchor_id: null,
    attribution_mode: "named",
    author_id: CLUB_IDS.member,
    author_name: "Anna Nowak",
    author_avatar: null,
    author_slug: "anna-nowak",
    author_alias: null,
    posted_by_admin_name: null,
    is_anonymous: false,
    can_moderate: false,
    can_reply: false,
    created_at: CLUB_BASE_ISO,
    edited_at: null,
    locked_at: null,
    pinned_at: null,
    poll_id: null,
    resolved_reply_id: null,
    participant_count: 3,
    reaction_count: 0,
    reply_count: 0,
    reason: "",
  };
}

async function mount() {
  return renderRoute({
    route: ThreadRoute,
    path: "/club/$clubSlug/t/$threadSlug",
    initialEntry: `/club/${SLUG}/t/${THREAD_SLUG}`,
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  });
}

/** Kilka obrotów pętli zdarzeń - leniwy panel i zapytania mają czas wystartować. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

beforeEach(() => {
  cleanup();
  resetClubApiMock();
  resetNetworkApiMock();
  h.club = clubViewRow();
  h.thread = threadRow();
  clubApiMock.fetchMyThreadSubscription.mockResolvedValue(null);
  clubApiMock.setClubThreadSubscription.mockResolvedValue(true);
  networkApiMock.fetchClubThreadExperts.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("strona wątku - gość nie woła RPC bez EXECUTE dla `anon`", () => {
  it("gość: brak dzwonka, zero odczytów subskrypcji i ekspertów", async () => {
    h.user = null;
    await mount();
    expect(await screen.findByTestId("club-thread-lead")).toBeTruthy();
    // Leniwy moduł panelu ekspertów jest w cache'u importów - gdyby trasa go
    // montowała, jego zapytanie wystartowałoby w tym oknie.
    await import("@/components/clubs/organisms/ClubThreadExpertsPanel");
    await settle();

    expect(screen.queryByRole("button", { name: "club.subscription.follow" })).toBeNull();
    expect(clubApiMock.fetchMyThreadSubscription).not.toHaveBeenCalled();
    expect(clubApiMock.setClubThreadSubscription).not.toHaveBeenCalled();
    expect(networkApiMock.fetchClubThreadExperts).not.toHaveBeenCalled();
  });

  it("zalogowany: dzwonek czyta i zapisuje subskrypcję, panel pyta o ekspertów", async () => {
    h.user = { id: CLUB_IDS.me };
    await mount();
    expect(await screen.findByTestId("club-thread-lead")).toBeTruthy();

    await waitFor(() =>
      expect(clubApiMock.fetchMyThreadSubscription).toHaveBeenCalledWith(CLUB_IDS.thread),
    );
    await waitFor(() =>
      expect(networkApiMock.fetchClubThreadExperts).toHaveBeenCalledWith(CLUB_IDS.thread, 6),
    );

    // Dzwonek jest WYGASZONY, dopóki stan subskrypcji nie dojdzie - potem czynny.
    const bell = await screen.findByRole("button", { name: "club.subscription.follow" });
    await waitFor(() => expect(bell).toBeEnabled());
    fireEvent.click(bell);
    await waitFor(() =>
      expect(clubApiMock.setClubThreadSubscription).toHaveBeenCalledWith({
        threadId: CLUB_IDS.thread,
        state: "subscribed",
      }),
    );
  });
});
