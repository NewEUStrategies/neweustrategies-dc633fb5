// Trasa `/profile/invoices`: rejestr dokumentow platnosci i - od funkcji faktur
// wydarzen - karta "Faktury za wydarzenia" (dokumenty ORGANIZATOROW, nie
// operatora platnosci). Karty maja wlasne testy; tu dowodzimy, ze trasa je
// sklada w tej kolejnosci i nie wpuszcza strony do wyszukiwarki.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderRoute } from "@/test/routeHarness";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-invoices", () => ({ ensureI18n: () => undefined }));
vi.mock("@/components/billing/organisms/InvoiceLedgerCard", () => ({
  InvoiceLedgerCard: () => <section data-testid="card">ledger</section>,
}));
vi.mock("@/components/events/invoices/organisms/EventInvoicesProfileCard", () => ({
  EventInvoicesProfileCard: () => <section data-testid="card">event-invoices</section>,
}));
vi.mock("@/components/billing/organisms/InvoiceCrmSyncCard", () => ({
  InvoiceCrmSyncCard: () => <section data-testid="card">crm-sync</section>,
}));
vi.mock("@/components/billing/molecules/InvoiceLookupCard", () => ({
  InvoiceLookupCard: () => <section data-testid="card">lookup</section>,
}));

const { Route } = await import("@/routes/profile.invoices");

describe("/profile/invoices", () => {
  it("karta faktur za wydarzenia stoi po rejestrze dokumentow platnosci", async () => {
    await renderRoute({
      route: Route,
      path: "/profile/invoices",
      initialEntry: "/profile/invoices",
    });
    expect(await screen.findByText("invoices.pageTitle")).toBeTruthy();
    expect(screen.getAllByTestId("card").map((card) => card.textContent)).toEqual([
      "ledger",
      "event-invoices",
      "crm-sync",
      "lookup",
    ]);
  });

  it("strona prywatna: noindex, nofollow", async () => {
    const view = await renderRoute({
      route: Route,
      path: "/profile/invoices",
      initialEntry: "/profile/invoices",
    });
    await screen.findByText("invoices.pageTitle");
    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});
