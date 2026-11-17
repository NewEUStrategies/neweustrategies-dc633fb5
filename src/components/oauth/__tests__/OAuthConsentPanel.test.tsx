// Panel zgody OAuth: co widzi użytkownik przed udzieleniem dostępu i jak
// przekazuje decyzję. Przełączniki motywu/języka są osobnym atomem
// (`chromeWidgets`, testowany przy portalu logowania), a logo czyta
// ustawienia witryny - tu oba zastąpione, bo nie są przedmiotem dowodu.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";

vi.mock("@/components/atoms/Logo", () => ({ Logo: () => null }));
vi.mock("@/components/builder/organisms/widget-view/chromeWidgets", () => ({
  ThemeToggleWidget: () => null,
  LangSwitcherDropdown: () => null,
}));

import { OAuthConsentError, OAuthConsentPanel } from "@/components/oauth/OAuthConsentPanel";

const CLIENT = {
  name: "Claude",
  logoUri: null,
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  scope: "openid email custom:read",
};

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

describe("OAuthConsentPanel", () => {
  it("pokazuje klienta, konto, domenę powrotu i zakresy", () => {
    render(
      <OAuthConsentPanel
        client={CLIENT}
        userEmail="jan@example.com"
        pending={null}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Claude");
    expect(screen.getByText("jan@example.com")).toBeTruthy();
    expect(screen.getByText("claude.ai")).toBeTruthy();
    expect(screen.getByText(/custom:read/)).toBeTruthy();
  });

  it("przekazuje zgodę i odmowę", () => {
    const onDecide = vi.fn();
    render(
      <OAuthConsentPanel
        client={CLIENT}
        userEmail={null}
        pending={null}
        error={null}
        onDecide={onDecide}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: i18n.t("oauthConsent.approve") }));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("oauthConsent.deny") }));
    expect(onDecide.mock.calls).toEqual([["approve"], ["deny"]]);
  });

  it("w trakcie decyzji blokuje oba przyciski", () => {
    render(
      <OAuthConsentPanel
        client={CLIENT}
        userEmail={null}
        pending="approve"
        error={null}
        onDecide={vi.fn()}
      />,
    );
    for (const button of screen.getAllByRole("button")) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
  });

  it("błąd decyzji jest ogłaszany", () => {
    render(
      <OAuthConsentPanel
        client={CLIENT}
        userEmail={null}
        pending={null}
        error="Nie udało się."
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Nie udało się.");
  });

  it("pusta nazwa klienta nie daje pustego nagłówka", () => {
    render(
      <OAuthConsentPanel
        client={{ ...CLIENT, name: "  " }}
        userEmail={null}
        pending={null}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      i18n.t("oauthConsent.unknownClient"),
    );
  });

  it("ma wersję angielską", async () => {
    await i18n.changeLanguage("en");
    render(
      <OAuthConsentPanel
        client={CLIENT}
        userEmail={null}
        pending={null}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Connect Claude to New European Strategies",
    );
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(
      <OAuthConsentPanel
        client={CLIENT}
        userEmail="jan@example.com"
        pending={null}
        error={null}
        onDecide={vi.fn()}
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("OAuthConsentError", () => {
  it("ogłasza błąd i daje drogę powrotu", () => {
    render(<OAuthConsentError message="Żądanie wygasło." />);
    expect(screen.getByRole("alert").textContent).toContain("Żądanie wygasło.");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/");
  });
});
