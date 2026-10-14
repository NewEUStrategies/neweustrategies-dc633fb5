// `/admin/events/account-bindings` - dowiązania kont do kartotek uczestników
// (REG-01, D14).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TYTUŁ OGÓLNY ZAMIAST SEKCJI. AGENTS.md: prywatne ekrany panelu mają
//      `adminPageHead` z metadanymi TEJ sekcji - karta przeglądarki i historia
//      mają mówić „Participant account links", a nie „Admin".
//   2. EKRAN W WYSZUKIWARCE. Lista kartotek z adresami - `noindex, nofollow`.
//   3. PANEL DLA REDAKTORA. Trzy RPC stoją za `assert_event_admin_tenant()`;
//      redaktor dostałby `forbidden` na każdym wierszu. Trasa ma powiedzieć to
//      zdaniem i NIE montować organizmu (który od razu pytałby bazę).
//
// Organizm ma własny plik (`AccountBindingsPanel.test.tsx`) - tutaj jest atrapą.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ isAdmin: false, panele: 0 }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-registration", () => ({ ensureI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: h.isAdmin }) }));
vi.mock("@/components/admin/events/organisms/AccountBindingsPanel", () => ({
  AccountBindingsPanel: () => {
    h.panele += 1;
    return <div data-testid="dowiazania" />;
  },
}));

const { renderRoute } = await import("@/test/routeHarness");
const { Route } = await import("@/routes/admin.events.account-bindings");

const PATH = "/admin/events/account-bindings";

beforeEach(() => {
  h.isAdmin = false;
  h.panele = 0;
});
afterEach(() => cleanup());

describe("admin.events.account-bindings - metadane sekcji", () => {
  it("tytuł i opis TEJ sekcji, `noindex, nofollow`", () => {
    const head = Route.options.head?.({} as never) as
      { meta: Array<Record<string, string>> } | undefined;
    const meta = head?.meta ?? [];

    expect(meta.find((entry) => "title" in entry)?.title).toBe(
      "Participant account links | New European Strategies",
    );
    expect(meta.find((entry) => entry.name === "description")?.content).toMatch(/account/i);
    expect(meta.find((entry) => entry.name === "robots")?.content).toBe("noindex, nofollow");
  });
});

describe("admin.events.account-bindings - bramka roli", () => {
  it("administrator: nagłówek ekranu i organizm dowiązań", async () => {
    h.isAdmin = true;
    await renderRoute({ route: Route, path: PATH, initialEntry: PATH });

    expect(await screen.findByTestId("dowiazania")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "adminEventRegistration.bindings.title" }),
    ).toBeInTheDocument();
  });

  it("bez roli administratora: zdanie o braku uprawnień, organizm NIE montowany", async () => {
    await renderRoute({ route: Route, path: PATH, initialEntry: PATH });

    expect(await screen.findByText("adminEventRegistration.errors.forbidden")).toBeInTheDocument();
    expect(screen.queryByTestId("dowiazania")).toBeNull();
    expect(h.panele).toBe(0);
  });
});
