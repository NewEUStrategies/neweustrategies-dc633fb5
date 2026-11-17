import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { clubViewRow } from "@/test/clubs/fixtures";
import { ClubPageFrame } from "../organisms/ClubPageFrame";
const h = vi.hoisted(() => ({
  signedIn: true,
  loaded: true,
  navigate: vi.fn(),
  events: vi.fn(),
  meeting: vi.fn(),
  /** Montaże paneli ludzi - ich RPC są dla `anon` zamknięte. */
  people: vi.fn(),
}));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.signedIn ? { user: { id: "member" } } : null }),
}));
// `useHydrated` PRAWDZIWY: `false` w `renderToString` i w pierwszym renderze
// `hydrateRoot`, `true` w zwykłym renderze klienta - bramka paneli ludzi
// (`useClubViewer`) stoi właśnie na tej różnicy.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  useNavigate: () => h.navigate,
  useHydrated: (await importOriginal<typeof import("@tanstack/react-router")>()).useHydrated,
}));
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
vi.mock("@/components/clubs/molecules/ClubBoardPanel", () => ({
  ClubBoardPanel: (props: Record<string, unknown>) => {
    h.people("board", props);
    return <div data-testid="people-board" />;
  },
}));
vi.mock("@/components/clubs/molecules/ClubRosterPanel", () => ({
  ClubRosterPanel: (props: Record<string, unknown>) => {
    h.people("roster", props);
    return <div data-testid="people-roster" />;
  },
}));
vi.mock("@/components/clubs/molecules/ClubSpotlightPanel", () => ({
  ClubSpotlightPanel: (props: Record<string, unknown>) => {
    h.people("spotlight", props);
    return <div data-testid="people-spotlight" />;
  },
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

  // GOŚĆ NIE MONTUJE paneli ludzi: tablica (`club_board_notices_list`), skład
  // (`club_roster_signal`) i „poznaj członka” (`club_member_spotlight_current`)
  // nie mają EXECUTE dla `anon`. Montaż = zapytanie = 42501 przy każdym wejściu
  // gościa w wątek (ta sama szyna, co w hubie).
  it("gość nie montuje paneli ludzi - ich RPC są dla `anon` zamknięte", () => {
    h.signedIn = false;
    render(
      <ClubPageFrame club={clubViewRow({ can_see_members: true, can_reply: true })}>
        Content
      </ClubPageFrame>,
    );
    expect(h.people).not.toHaveBeenCalled();
    expect(screen.queryByTestId("people-board")).toBeNull();
    expect(screen.queryByTestId("people-roster")).toBeNull();
    expect(screen.queryByTestId("people-spotlight")).toBeNull();
  });

  it("zalogowany montuje panele ludzi z prawami z karty klubu, jak dotąd", () => {
    render(
      <ClubPageFrame club={clubViewRow({ can_see_members: true, can_reply: true })}>
        Content
      </ClubPageFrame>,
    );
    // Szyna stoi dwa razy (pod treścią i w kolumnie) - każdy panel po dwa.
    expect(screen.getAllByTestId("people-board")).toHaveLength(2);
    expect(screen.getAllByTestId("people-roster")).toHaveLength(2);
    expect(screen.getAllByTestId("people-spotlight")).toHaveLength(2);
    expect(h.people).toHaveBeenCalledWith("board", expect.objectContaining({ canPost: true }));
    expect(h.people).toHaveBeenCalledWith(
      "roster",
      expect.objectContaining({ canSeeMembers: true, canDeclare: true }),
    );

    cleanup();
    h.people.mockClear();
    render(
      <ClubPageFrame club={clubViewRow({ can_see_members: false, can_reply: false })}>
        Content
      </ClubPageFrame>,
    );
    expect(h.people).toHaveBeenCalledWith("board", expect.objectContaining({ canPost: false }));
    expect(h.people).toHaveBeenCalledWith(
      "roster",
      expect.objectContaining({ canSeeMembers: false, canDeclare: false }),
    );
  });

  it("HTML serwera = pierwszy render klienta, gdy sesja rozstrzygnęła się PRZED hydratacją", async () => {
    // Dokument SSR jest anonimowy; leniwa trasa wątku bywa hydratowana po
    // rozstrzygnięciu sesji. Bramka na samej sesji dałaby rozjazd hydratacji.
    const club = clubViewRow({ can_see_members: true, can_reply: true });
    h.signedIn = false;
    const view = <ClubPageFrame club={club}>Content</ClubPageFrame>;
    const host = document.createElement("div");
    host.innerHTML = renderToString(view);
    document.body.append(host);
    expect(host.querySelector("[data-testid^='people-']")).toBeNull();

    h.signedIn = true;
    h.people.mockClear();
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
    });
    try {
      expect(errors).toEqual([]);
      // Po hydratacji zalogowany dostaje panele - bez przebudowy dokumentu.
      expect(host.querySelectorAll("[data-testid='people-board']")).toHaveLength(2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
