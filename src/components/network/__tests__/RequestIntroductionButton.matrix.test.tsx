// Macierz testow RequestIntroductionButton: stan polaczenia (mutual/brak),
// stan zapytania statusow (pending/available) x widocznosc, etykiety i18n,
// stabilny placeholder podczas ladowania (brak layout-shiftu / znikniecia)
// i akcja klikniecia (otwarcie dialogu wprowadzenia).
// Uwaga: ten przycisk nie ma wlasnej bramki po warstwie czlonkostwa (tier) -
// widocznosc zalezy od modulu "connections_enabled", auth i stanu polaczenia
// (status/mutualCount) zwracanego przez useConnectionStatuses.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import type { ConnectionState } from "@/lib/network/useConnections";

const h = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  modules: { connections_enabled: true },
  statuses: {
    data: undefined as ReadonlyMap<string, ConnectionState> | undefined,
    isPending: false,
  },
  intros: { data: [] as unknown[] },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock("@/lib/i18n-network", () => ({}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user }),
}));

vi.mock("@/lib/community/useCommunityModules", () => ({
  useCommunityModules: () => h.modules,
}));

vi.mock("@/lib/network/useConnections", () => ({
  useConnectionStatuses: () => h.statuses,
}));

vi.mock("@/lib/network/useIntroductions", () => ({
  useMyIntroductions: () => h.intros,
}));

vi.mock("@/components/network/RequestIntroductionDialog", () => ({
  RequestIntroductionDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="intro-dialog">dialog-open</div> : null,
}));

import { RequestIntroductionButton } from "@/components/network/RequestIntroductionButton";

function state(overrides: Partial<ConnectionState>): ConnectionState {
  return {
    status: "none",
    connectionId: null,
    mutualCount: 0,
    canInvite: true,
    degree: 3,
    ...overrides,
  };
}

function renderButton() {
  return renderWithQueryClient(
    <RequestIntroductionButton userId="target-1" displayName="Anna Nowak" />,
  );
}

beforeEach(() => {
  h.user = { id: "me" };
  h.modules = { connections_enabled: true };
  h.statuses = { data: undefined, isPending: false };
  h.intros = { data: [] };
});

describe("RequestIntroductionButton - macierz", () => {
  it("anon: nic sie nie renderuje", () => {
    h.user = null;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("wlasny profil: nic sie nie renderuje", () => {
    h.user = { id: "target-1" };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("modul polaczen wylaczony w tenancie: nic sie nie renderuje", () => {
    h.modules = { connections_enabled: false };
    h.statuses = {
      data: new Map([["target-1", state({ mutualCount: 3 })]]),
      isPending: false,
    };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("quota/status pending: pokazuje stabilny disabled placeholder, nie znika", () => {
    h.statuses = { data: undefined, isPending: true };
    renderButton();
    const button = screen.getByRole("button", { hidden: true });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-hidden");
    expect(button).toHaveTextContent("network.introductions.requestCta");
  });

  it("brak wspolnego kontaktu (mutualCount=0): przycisk niewidoczny", () => {
    h.statuses = {
      data: new Map([["target-1", state({ mutualCount: 0 })]]),
      isPending: false,
    };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("juz polaczeni (status=connected): przycisk niewidoczny mimo wspolnych kontaktow", () => {
    h.statuses = {
      data: new Map([["target-1", state({ status: "connected", mutualCount: 5 })]]),
      isPending: false,
    };
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });

  it("wspolny kontakt + brak polaczenia (status=none): przycisk widoczny i klikalny", () => {
    h.statuses = {
      data: new Map([["target-1", state({ status: "none", mutualCount: 2 })]]),
      isPending: false,
    };
    renderButton();
    const button = screen.getByRole("button", { name: "network.introductions.requestCta" });
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId("intro-dialog")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByTestId("intro-dialog")).toBeInTheDocument();
  });

  it("zaproszenie oczekujace wychodzace (pending_out) + wspolny kontakt: nadal widoczny", () => {
    h.statuses = {
      data: new Map([["target-1", state({ status: "pending_out", mutualCount: 1 })]]),
      isPending: false,
    };
    renderButton();
    expect(
      screen.getByRole("button", { name: "network.introductions.requestCta" }),
    ).toBeInTheDocument();
  });

  it("zaproszenie oczekujace przychodzace (pending_in) + wspolny kontakt: nadal widoczny", () => {
    h.statuses = {
      data: new Map([["target-1", state({ status: "pending_in", mutualCount: 4 })]]),
      isPending: false,
    };
    renderButton();
    expect(
      screen.getByRole("button", { name: "network.introductions.requestCta" }),
    ).toBeInTheDocument();
  });
});
