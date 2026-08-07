// AuthorMoreMenu: menu „trzy kropki" na pasku akcji profilu autora. Trzyma
// akcje drugorzędne, żeby główny pasek został przy CTA. Testujemy bramki
// widoczności, etykietę ze SŁOWNIKA (kluczowy `common.more` żył wcześniej tylko
// jako polski `defaultValue`) i przekazanie sterowania dialogowi moderacji.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NETWORK_IDS, PEER_NAME, translateKey as k } from "@/test/network/fixtures";

const h = vi.hoisted(() => ({
  user: { id: "user-me" } as { id: string } | null,
}));

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@/lib/i18n-network", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/components/network/ReportUserDialog", () => ({
  ReportUserDialog: ({
    open,
    userId,
    displayName,
  }: {
    open: boolean;
    userId: string;
    displayName: string;
  }) =>
    open ? (
      <div data-testid="report-dialog" data-user={userId}>
        {displayName}
      </div>
    ) : null,
}));

import { AuthorMoreMenu } from "@/components/network/AuthorMoreMenu";

function renderMenu() {
  return render(<AuthorMoreMenu userId={NETWORK_IDS.peer} displayName={PEER_NAME} />);
}

beforeEach(() => {
  h.user = { id: NETWORK_IDS.me };
});

describe("AuthorMoreMenu", () => {
  it("anon: menu się nie renderuje (zgłaszać może tylko zalogowany)", () => {
    h.user = null;
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });

  it("własny profil: menu się nie renderuje", () => {
    h.user = { id: NETWORK_IDS.peer };
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });

  it("etykieta i tooltip biorą tekst ze słownika common.more", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: k("common.more") });
    expect(trigger).toHaveAttribute("title", k("common.more"));
    expect(trigger.className).toContain("h-8 w-8");
  });

  it("otwiera listę akcji drugorzędnych z pozycją zgłoszenia", () => {
    renderMenu();
    expect(screen.queryByRole("button", { name: k("network.report") })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: k("common.more") }));
    expect(screen.getByRole("button", { name: k("network.report") })).toBeInTheDocument();
  });

  it("zgłoszenie: zamyka menu i otwiera dialog moderacji z danymi osoby", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: k("common.more") }));
    fireEvent.click(screen.getByRole("button", { name: k("network.report") }));

    const dialog = screen.getByTestId("report-dialog");
    expect(dialog).toHaveTextContent(PEER_NAME);
    expect(dialog).toHaveAttribute("data-user", NETWORK_IDS.peer);
    // Menu zwinięte - akcja nie zostaje pod otwartym dialogiem.
    expect(screen.queryByRole("button", { name: k("network.report") })).not.toBeInTheDocument();
  });
});
