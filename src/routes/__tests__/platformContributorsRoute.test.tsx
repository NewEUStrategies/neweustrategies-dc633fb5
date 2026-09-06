import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry, MyReputation } from "@/lib/community/reputation";
const h = vi.hoisted(() => ({
  lang: "pl",
  user: { id: "me" } as { id: string } | null,
  board: undefined as LeaderboardEntry[] | undefined,
  my: undefined as MyReputation | undefined,
  loading: false,
  error: false,
  boardHook: vi.fn(),
  myHook: vi.fn(),
  badgeHook: vi.fn(),
  badgeData: undefined as Map<string, string[]> | undefined,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: h.lang },
    t: (key: string, options?: { count?: number; level?: string }) =>
      `${key}${options?.count === undefined ? "" : `:${options.count}`}${options?.level ? `:${options.level}` : ""}`,
  }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/lib/i18n-community", () => ({ ensureI18n() {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/components/ui/select", async () => await import("@/test/platform/nativeControls"));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/components/profile/AuthGate", () => ({
  AuthGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/chat/ChatAvatar", () => ({
  ChatAvatar: ({ name, to }: { name: string; to?: string }) => (
    <span data-testid="avatar" data-href={to}>
      {name.slice(0, 1)}
    </span>
  ),
}));
vi.mock("@/components/community/ReputationLevelChip", () => ({
  ReputationLevelChip: ({ points }: { points: number }) => (
    <span data-testid="level">{points}</span>
  ),
}));
vi.mock("@/components/profile/ProfileBadges", () => ({
  ProfileBadges: ({ badges }: { badges?: string[] }) => <span>{badges?.join(",")}</span>,
}));
vi.mock("@/lib/profile/badges", () => ({
  useBadgesForUsers: (ids: string[]) => {
    h.badgeHook(ids);
    return { data: h.badgeData };
  },
}));
vi.mock("@/lib/community/reputation", async (original) => ({
  ...(await original<typeof import("@/lib/community/reputation")>()),
  useContributorLeaderboard: (days: number, count: number) => {
    h.boardHook(days, count);
    return { data: h.board, isLoading: h.loading, isError: h.error };
  },
  useMyReputation: (days: number, userId?: string) => {
    h.myHook(days, userId);
    return { data: h.my };
  },
}));
import { Route } from "@/routes/contributors";
function entry(position: number): LeaderboardEntry {
  return {
    position,
    user_id: `user-${position}`,
    display_name: `Person ${position}`,
    avatar_url: null,
    slug: position === 1 ? "first" : null,
    points: 110,
    breakdown: {
      comments: { points: 10, count: 5 },
      events_attended: { points: 100, count: 1 },
      poll_votes: { points: 0, count: 0 },
      qa_answered: undefined,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.lang = "pl";
  h.user = { id: "me" };
  h.board = [entry(1), entry(4)];
  h.my = { points: 110, breakdown: {}, window_days: 90, board_visible: false, position: 7 };
  h.loading = false;
  h.error = false;
  h.badgeData = new Map([["user-1", ["expert"]]]);
});
afterEach(cleanup);
function mount() {
  const Component = Route.options.component!;
  return render(<Component />);
}
describe("contributor leaderboard route", () => {
  it.each(["pl", "en-GB"])(
    "renders scores, public links, badges and privacy action in %s",
    (lang) => {
      h.lang = lang;
      mount();
      expect(screen.getByRole("link", { name: "Person 1" })).toHaveAttribute(
        "href",
        "/author/first",
      );
      expect(screen.getByText("Person 4").tagName).toBe("SPAN");
      expect(screen.getByText("expert")).toBeTruthy();
      expect(h.badgeHook).toHaveBeenCalledWith(["user-1", "user-4"]);
      expect(screen.getByRole("link", { name: "community.reputation.privacyCta" })).toHaveAttribute(
        "href",
        "/profile/edit",
      );
      expect(
        screen.getByText(
          `community.reputation.nextLevel:${lang === "pl" ? "Głos społeczności" : "Community voice"}`,
        ),
      ).toBeTruthy();
      expect(screen.queryByText("community.reputation.sources.poll_votes")).toBeNull();
      const breakdown = screen
        .getAllByText("community.reputation.sources.events_attended")[0]
        .closest("ul")!;
      expect(breakdown.firstElementChild?.textContent).toContain("events_attended");
    },
  );
  it("changes both reputation queries to the selected time window", () => {
    mount();
    expect(h.boardHook).toHaveBeenLastCalledWith(90, 25);
    expect(h.myHook).toHaveBeenLastCalledWith(90, "me");
    for (const days of [30, 365, 90]) {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: String(days) } });
      expect(h.boardHook).toHaveBeenLastCalledWith(days, 25);
      expect(h.myHook).toHaveBeenLastCalledWith(days, "me");
    }
  });
  it("shows the highest level without a privacy prompt for a visible member", () => {
    h.my = {
      ...h.my!,
      points: 1500,
      board_visible: true,
      position: null,
      breakdown: {
        comments: { points: 20, count: 10 },
        events_attended: { points: 100, count: 2 },
      },
    };
    mount();
    expect(screen.getByText("community.reputation.topLevel")).toBeTruthy();
    expect(screen.queryByText("community.reputation.notVisible")).toBeNull();
  });
  it("does not expose a personal card before its data arrives", () => {
    h.my = undefined;
    h.user = null;
    h.badgeData = undefined;
    mount();
    expect(screen.queryByRole("region", { name: "community.reputation.yourScore" })).toBeNull();
    expect(h.myHook).toHaveBeenLastCalledWith(90, undefined);
  });
  it.each(["loading", "error", "empty"])("distinguishes leaderboard state %s", (state) => {
    h.board = state === "empty" ? [] : undefined;
    h.loading = state === "loading";
    h.error = state === "error";
    h.my = undefined;
    const view = mount();
    if (state === "loading")
      expect(view.container.querySelectorAll(".animate-pulse")).toHaveLength(5);
    if (state === "error") expect(screen.getByText("community.common.loadError")).toBeTruthy();
    if (state === "empty") expect(screen.getByText("community.reputation.empty")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(h.badgeHook).toHaveBeenLastCalledWith([]);
  });
  it("does not prompt a member with no contributions to reveal their profile", () => {
    h.my = { ...h.my!, points: 0, board_visible: false };
    mount();
    expect(screen.queryByText("community.reputation.notVisible")).toBeNull();
  });
  it("keeps the members-only board out of search indexes", () => {
    const head = Route.options.head as () => { meta: unknown[] };
    expect(head().meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});
