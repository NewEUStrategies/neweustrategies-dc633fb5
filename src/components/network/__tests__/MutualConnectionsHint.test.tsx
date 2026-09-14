// MutualConnectionsHint: dowód społeczny „N wspólnych kontaktów" przy profilu.
// Kontrakt, którego pilnujemy: hint jeździ na TYM SAMYM batchowanym zapytaniu
// co ConnectButton (zero dodatkowych RPC), znika przy zerze wspólnych kontaktów
// i - po naprawie z 08.2026 - bierze etykietę czytnika ekranu ze SŁOWNIKA,
// a nie z polskiego `defaultValue` w kodzie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  NETWORK_IDS,
  connectionState,
  pendingQueryStub,
  queryStub,
  stateFor,
  statusMap,
  translateKey as k,
  type QueryStub,
} from "@/test/network/fixtures";
import type { ConnectionState } from "@/lib/network/useConnections";

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
  modules: { connections_enabled: true },
  statuses: null as unknown,
  requestedIds: [] as ReadonlyArray<string>[],
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/lib/community/useCommunityModules", () => ({ useCommunityModules: () => h.modules }));
vi.mock("@/lib/network/useConnections", () => ({
  useConnectionStatuses: (ids: ReadonlyArray<string>) => {
    h.requestedIds.push(ids);
    return h.statuses;
  },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { MutualConnectionsHint } from "@/components/network/MutualConnectionsHint";

function setStatuses(stub: QueryStub<ReadonlyMap<string, ConnectionState>>): void {
  h.statuses = stub;
}

function renderHint() {
  return renderWithQueryClient(<MutualConnectionsHint userId={NETWORK_IDS.peer} />);
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.modules = { connections_enabled: true };
  h.requestedIds = [];
  setStatuses(queryStub(statusMap({})));
});

describe("MutualConnectionsHint", () => {
  it("pokazuje liczbę wspólnych kontaktów i link do ich listy", () => {
    setStatuses(
      queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ mutualVisibleCount: 3 }) })),
    );
    renderHint();
    const link = screen.getByRole("link", { name: k("network.mutualLinkAria", { count: 3 }) });
    expect(link).toHaveAttribute("href", `/network/mutual/${NETWORK_IDS.peer}`);
    expect(link).toHaveTextContent(k("network.mutual", { count: 3 }));
  });

  it("etykieta czytnika ekranu idzie ze słownika (bez defaultValue w kodzie)", () => {
    setStatuses(
      queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ mutualVisibleCount: 1 }) })),
    );
    renderHint();
    // Klucz z licznikiem - i18next rozwinie go na formę mnogą właściwą dla
    // języka; w teście liczy się, że w aria trafia KLUCZ, nie polski tekst.
    expect(
      screen.getByRole("link", { name: k("network.mutualLinkAria", { count: 1 }) }),
    ).toBeInTheDocument();
  });

  it("zero wspólnych kontaktów: nic się nie renderuje", () => {
    setStatuses(
      queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ mutualVisibleCount: 0 }) })),
    );
    const { container } = renderHint();
    expect(container).toBeEmptyDOMElement();
  });

  // To jest cały defekt A4 zamknięty w jednym przypadku: podpowiedź prowadzi do
  // `mutual_connections`, które odsiewa po `discoverable` i najemcy, więc liczba
  // NIE MOŻE pochodzić z `mutualCount` (fakt grafu). Przed 20260913172000
  // ten stan renderował "7 wspólnych kontaktów" i otwierał pustą listę.
  it("liczy MOSTY WIDOCZNE, nie fakt grafu - inaczej link prowadzi w pustkę", () => {
    setStatuses(
      queryStub(
        statusMap({
          [NETWORK_IDS.peer]: connectionState({ mutualCount: 7, mutualVisibleCount: 4 }),
        }),
      ),
    );
    renderHint();
    expect(screen.getByText(k("network.mutual", { count: 4 }))).toBeInTheDocument();
    expect(screen.queryByText(k("network.mutual", { count: 7 }))).not.toBeInTheDocument();
  });

  it("same ukryte mosty: podpowiedzi NIE MA, choć graf zna drogę", () => {
    setStatuses(
      queryStub(
        statusMap({
          [NETWORK_IDS.peer]: connectionState({ mutualCount: 2, mutualVisibleCount: 0 }),
        }),
      ),
    );
    const { container } = renderHint();
    expect(container).toBeEmptyDOMElement();
  });

  it("status jeszcze się nie rozstrzygnął: nic się nie renderuje", () => {
    setStatuses(pendingQueryStub());
    const { container } = renderHint();
    expect(container).toBeEmptyDOMElement();
  });

  it("wspólne kontakty widać także przy istniejącej relacji", () => {
    setStatuses(
      queryStub(
        statusMap({ [NETWORK_IDS.peer]: stateFor("connected", { mutualVisibleCount: 8 }) }),
      ),
    );
    renderHint();
    expect(screen.getByText(k("network.mutual", { count: 8 }))).toBeInTheDocument();
  });

  it("moduł sieci wyłączony w tenancie: brak hintu i brak zapytania o status", () => {
    h.modules = { connections_enabled: false };
    setStatuses(
      queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ mutualVisibleCount: 5 }) })),
    );
    const { container } = renderHint();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("anon: brak hintu i brak zapytania", () => {
    h.user = null;
    const { container } = renderHint();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("własny profil: brak hintu i brak zapytania", () => {
    h.user = { id: NETWORK_IDS.peer };
    const { container } = renderHint();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("aktywny hint pyta o dokładnie jedną osobę (wspólny cache z ConnectButton)", () => {
    setStatuses(
      queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ mutualVisibleCount: 2 }) })),
    );
    renderHint();
    expect(h.requestedIds).toEqual([[NETWORK_IDS.peer]]);
  });
});
