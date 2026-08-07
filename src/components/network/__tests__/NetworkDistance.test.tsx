// NetworkDistance (organizm): dystans w sieci na profilu osoby.
//
// Kontrakt: te same bramki co reszta powierzchni sieci (moduł w tenancie,
// zalogowanie, cudzy profil) ORAZ zero dodatkowych zapytań - komponent jeździ
// na tym samym batchowanym `connection_statuses`, co ConnectButton i
// MutualConnectionsHint. Gdy bramka jest zamknięta, lista id idzie do hooka
// PUSTA (nie „prawie pusta"), więc React Query w ogóle nie strzela do RPC.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  NETWORK_IDS,
  connectionBridge,
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

import { NetworkDistance } from "@/components/network/organisms/NetworkDistance";

function setStatuses(stub: QueryStub<ReadonlyMap<string, ConnectionState>>): void {
  h.statuses = stub;
}

function renderDistance() {
  return renderWithQueryClient(
    <NetworkDistance userId={NETWORK_IDS.peer} displayName="Anna Nowak" />,
  );
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
  h.modules = { connections_enabled: true };
  h.requestedIds = [];
  setStatuses(queryStub(statusMap({})));
});

describe("NetworkDistance", () => {
  it("2. stopień: odznaka + droga przez most", () => {
    setStatuses(
      queryStub(
        statusMap({
          [NETWORK_IDS.peer]: connectionState({
            mutualCount: 2,
            degree: 2,
            bridge: connectionBridge({ name: "Jan Kowalski" }),
          }),
        }),
      ),
    );
    renderDistance();
    expect(screen.getByText(k("network.degree.short.second"))).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
  });

  it("1. stopień: sama odznaka, bez ścieżki", () => {
    setStatuses(queryStub(statusMap({ [NETWORK_IDS.peer]: stateFor("connected", { degree: 1 }) })));
    renderDistance();
    expect(screen.getByText(k("network.degree.short.first"))).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("poza zasięgiem: nic - brak drogi zostaje w danych, nie na ekranie", () => {
    setStatuses(queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ degree: 0 }) })));
    const { container } = renderDistance();
    expect(container).toBeEmptyDOMElement();
  });

  it("status jeszcze się nie rozstrzygnął: nic się nie renderuje", () => {
    setStatuses(pendingQueryStub());
    const { container } = renderDistance();
    expect(container).toBeEmptyDOMElement();
  });

  it("moduł sieci wyłączony w tenancie: brak zapytania i brak odznaki", () => {
    h.modules = { connections_enabled: false };
    setStatuses(queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ degree: 2 }) })));
    const { container } = renderDistance();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("anon: brak zapytania i brak odznaki", () => {
    h.user = null;
    const { container } = renderDistance();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("własny profil: brak zapytania i brak odznaki", () => {
    h.user = { id: NETWORK_IDS.peer };
    const { container } = renderDistance();
    expect(container).toBeEmptyDOMElement();
    expect(h.requestedIds).toEqual([[]]);
  });

  it("jedzie na tym samym batchowanym RPC co reszta karty (jedno id, bez N+1)", () => {
    setStatuses(queryStub(statusMap({ [NETWORK_IDS.peer]: connectionState({ degree: 3 }) })));
    renderDistance();
    expect(h.requestedIds).toEqual([[NETWORK_IDS.peer]]);
  });
});
