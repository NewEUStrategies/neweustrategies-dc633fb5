import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { clubViewRow } from "@/test/clubs/fixtures";
import { ClubPageFrame } from "../organisms/ClubPageFrame";
const h = vi.hoisted(() => ({
  signedIn: true,
  loaded: true,
  navigate: vi.fn(),
  events: vi.fn(),
  meeting: vi.fn(),
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.signedIn ? { user: { id: "member" } } : null }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/lib/clubs/useClubs", () => ({
  useClubGroups: () => ({ data: h.loaded ? [] : undefined }),
}));
vi.mock("@/lib/clubs/useClubWorkspace", () => ({
  useClubDocuments: () => ({ data: h.loaded ? { rows: [], total: 0 } : undefined }),
  useClubEvents: (args: { from: string }) => {
    h.events(args);
    return { data: h.loaded ? [] : undefined };
  },
  useClubMilestones: () => ({ data: h.loaded ? [] : undefined }),
}));
vi.mock("@/components/Breadcrumbs", () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => i.label).join(" / ")}</nav>
  ),
}));
vi.mock("@/components/clubs/molecules/ClubHubIdentity", () => ({ ClubHubIdentity: () => null }));
vi.mock("@/components/clubs/molecules/ClubHubRail", () => ({
  ClubHubRail: ({ onGroupChange }: { onGroupChange: () => void }) => (
    <button onClick={onGroupChange}>Change group</button>
  ),
  ClubHubSectionBar: () => null,
}));
vi.mock("@/components/clubs/molecules/ClubMeetingPanel", () => ({
  ClubMeetingPanel: (props: Record<string, unknown>) => {
    h.meeting(props);
    return null;
  },
}));
vi.mock("@/components/clubs/molecules/ClubBoardPanel", () => ({ ClubBoardPanel: () => null }));
vi.mock("@/components/clubs/molecules/ClubRosterPanel", () => ({ ClubRosterPanel: () => null }));
vi.mock("@/components/clubs/molecules/ClubSpotlightPanel", () => ({
  ClubSpotlightPanel: () => null,
}));
vi.mock("@/components/clubs/molecules/ClubHubContext", () => ({
  ClubFreshDocsPanel: () => null,
  ClubStagePanel: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.signedIn = true;
  h.loaded = true;
});
describe("club detail frame", () => {
  it("keeps the event cursor stable and returns group navigation to the club", () => {
    const club = clubViewRow();
    const { rerender } = render(
      <ClubPageFrame club={club} trailingCrumb="Thread">
        Content
      </ClubPageFrame>,
    );
    const first = h.events.mock.calls[0][0].from;
    rerender(
      <ClubPageFrame club={club} trailingCrumb="Thread">
        Updated content
      </ClubPageFrame>,
    );
    expect(h.events.mock.calls.at(-1)?.[0].from).toBe(first);
    expect(screen.getByRole("navigation").textContent).toContain("Thread");
    fireEvent.click(screen.getByRole("button", { name: "Change group" }));
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/club/$clubSlug",
      params: { clubSlug: club.slug },
      search: {},
    });
    expect(screen.getByText("Updated content")).toBeTruthy();
  });
  it.each([undefined, ""])(
    "renders while data loads and gates member actions for visitors (%s)",
    (trailingCrumb) => {
      h.signedIn = false;
      h.loaded = false;
      render(
        <ClubPageFrame
          club={clubViewRow({ can_see_members: true, can_reply: true, can_manage: true })}
          trailingCrumb={trailingCrumb}
        >
          Content
        </ClubPageFrame>,
      );
      expect(h.meeting).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [],
          canSeeMembers: false,
          canRsvp: false,
          canManage: false,
        }),
      );
      expect(screen.getByText("Content")).toBeTruthy();
    },
  );
});
