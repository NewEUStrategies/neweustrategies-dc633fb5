// DossierFollowers: „kto jeszcze śledzi ten plik" - obserwujący dossier jako
// powierzchnia networkingowa. Twarde reguły: tylko dla zalogowanych, RPC pyta
// wyłącznie o dossier w tenancie wołającego i zwraca wyłącznie profile z opt-in
// widoczności, a przycisk relacji renderuje się DOPIERO gdy jest batchowana
// mapa statusów (karta nie może odpytywać statusu per osoba).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  NETWORK_IDS,
  PEER_NAME,
  pendingQueryStub,
  policyFollowerRow,
  queryStub,
  stateFor,
  statusMap,
  translateKey as k,
  type QueryStub,
} from "@/test/network/fixtures";
import type { ConnectionState, PolicyItemFollowerRow } from "@/lib/network/useConnections";

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  modules: { connections_enabled: true },
  followers: null as unknown,
  statuses: null as unknown,
  online: new Set<string>(),
  followerRequests: [] as Array<string | null | undefined>,
  statusRequests: [] as ReadonlyArray<string>[],
  connectStates: [] as Array<{ userId: string; state?: ConnectionState; compact?: boolean }>,
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, tenantId: NETWORK_IDS.tenant }),
}));
vi.mock("@/lib/community/useCommunityModules", () => ({ useCommunityModules: () => h.modules }));
vi.mock("@/lib/chat/presence", () => ({ useOnlineUsers: () => h.online }));
vi.mock("@/lib/network/useConnections", () => ({
  usePolicyItemFollowers: (itemId: string | null | undefined) => {
    h.followerRequests.push(itemId);
    return h.followers;
  },
  useConnectionStatuses: (ids: ReadonlyArray<string>) => {
    h.statusRequests.push(ids);
    return h.statuses;
  },
}));
// Awatar bez treści tekstowej - inaczej nazwa osoby byłaby w DOM dwukrotnie
// i zapytania po tekście przestałyby rozróżniać nazwę od linku do profilu.
vi.mock("@/components/chat/ChatAvatar", () => ({
  ChatAvatar: ({ name, online }: { name: string; online?: boolean }) => (
    <span data-testid="avatar" data-name={name} data-online={online ? "true" : "false"} />
  ),
}));
vi.mock("@/components/network/ConnectButton", () => ({
  ConnectButton: (props: { userId: string; state?: ConnectionState; compact?: boolean }) => {
    h.connectStates.push(props);
    return <button type="button" data-testid={`connect-${props.userId}`} />;
  },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { DossierFollowers } from "@/components/network/DossierFollowers";

function setFollowers(rows: ReadonlyArray<PolicyItemFollowerRow>): void {
  h.followers = queryStub(rows);
}

function setStatuses(stub: QueryStub<ReadonlyMap<string, ConnectionState>> | undefined): void {
  h.statuses = stub ?? pendingQueryStub<ReadonlyMap<string, ConnectionState>>();
}

function renderSection() {
  return renderWithQueryClient(<DossierFollowers itemId={NETWORK_IDS.item} />);
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.modules = { connections_enabled: true };
  h.online = new Set<string>();
  h.followerRequests = [];
  h.statusRequests = [];
  h.connectStates = [];
  setFollowers([]);
  setStatuses(queryStub(statusMap({})));
});

describe("DossierFollowers - bramki", () => {
  it("anon: sekcja niewidoczna i RPC pytane o `null` (bez wycieku id dossier)", () => {
    h.user = null;
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(h.followerRequests).toEqual([null]);
  });

  it("moduł sieci wyłączony w tenancie: sekcja niewidoczna, RPC nietrafione", () => {
    h.modules = { connections_enabled: false };
    setFollowers([policyFollowerRow()]);
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(h.followerRequests).toEqual([null]);
  });

  it("brak widocznych obserwujących: sekcja się nie renderuje (bez pustego nagłówka)", () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(h.followerRequests).toEqual([NETWORK_IDS.item]);
  });

  it("dane jeszcze się nie wczytały: sekcja się nie renderuje", () => {
    h.followers = pendingQueryStub<ReadonlyArray<PolicyItemFollowerRow>>();
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DossierFollowers - lista", () => {
  it("nagłówek, podpowiedź i siatka dwukolumnowa od sm", () => {
    setFollowers([policyFollowerRow()]);
    const { container } = renderSection();
    expect(
      screen.getByRole("region", { name: k("network.dossierFollowersTitle") }),
    ).toBeInTheDocument();
    expect(screen.getByText(k("network.dossierFollowersHint"))).toBeInTheDocument();
    expect(container.querySelector("ul")?.className).toContain("sm:grid-cols-2");
  });

  it("obserwujący ze slugiem: nazwa linkuje na profil autora", () => {
    setFollowers([policyFollowerRow({ slug: "anna-nowak" })]);
    renderSection();
    expect(screen.getByRole("link", { name: PEER_NAME })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
  });

  it("obserwujący bez sluga: nazwa bez linku (profil jeszcze nieopublikowany)", () => {
    setFollowers([policyFollowerRow({ slug: "" })]);
    renderSection();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(PEER_NAME)).toBeInTheDocument();
  });

  it("profil zweryfikowany zawodowo dostaje odznakę", () => {
    setFollowers([policyFollowerRow({ verified: true, slug: "anna-nowak" })]);
    renderSection();
    expect(screen.getByLabelText(k("people.verifiedBadge"))).toBeInTheDocument();
  });

  it("rola i firma złączone półpauzą; brak obu - brak wiersza podpisu", () => {
    setFollowers([
      policyFollowerRow({ user_id: "u1", display_name: "Z rolą" }),
      policyFollowerRow({
        user_id: "u2",
        display_name: "Bez roli",
        job_title: "",
        current_company: "",
      }),
    ]);
    renderSection();
    expect(screen.getByText("Analityk - NES")).toBeInTheDocument();
    expect(screen.getByText("Bez roli")).toBeInTheDocument();
  });

  it("sama firma bez roli: podpis bez wiszącej półpauzy", () => {
    setFollowers([policyFollowerRow({ job_title: "" })]);
    renderSection();
    expect(screen.getByText("NES")).toBeInTheDocument();
  });

  it("obecność online idzie do awatara (kanał presence tenanta)", () => {
    setFollowers([
      policyFollowerRow({ user_id: "u-online", display_name: "Online" }),
      policyFollowerRow({ user_id: "u-offline", display_name: "Offline" }),
    ]);
    h.online = new Set(["u-online"]);
    renderSection();
    const avatars = screen.getAllByTestId("avatar");
    expect(avatars[0]).toHaveAttribute("data-online", "true");
    expect(avatars[1]).toHaveAttribute("data-online", "false");
  });
});

describe("DossierFollowers - przycisk relacji", () => {
  it("statusy pytane jednym batchem dla wszystkich obserwujących", () => {
    setFollowers([policyFollowerRow({ user_id: "u1" }), policyFollowerRow({ user_id: "u2" })]);
    renderSection();
    expect(h.statusRequests.at(-1)).toEqual(["u1", "u2"]);
  });

  it("bez mapy statusów przycisk się nie renderuje (zero zapytań per karta)", () => {
    setFollowers([policyFollowerRow()]);
    setStatuses(undefined);
    renderSection();
    expect(screen.queryByTestId(`connect-${NETWORK_IDS.peer}`)).not.toBeInTheDocument();
    expect(h.connectStates).toEqual([]);
  });

  it("z mapą statusów przycisk dostaje gotowy stan relacji w wersji compact", () => {
    setFollowers([policyFollowerRow()]);
    setStatuses(queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("connected") })));
    renderSection();
    expect(screen.getByTestId(`connect-${NETWORK_IDS.peer}`)).toBeInTheDocument();
    expect(h.connectStates).toEqual([
      {
        userId: NETWORK_IDS.peer,
        displayName: PEER_NAME,
        state: stateFor("connected"),
        compact: true,
      },
    ]);
  });
});
