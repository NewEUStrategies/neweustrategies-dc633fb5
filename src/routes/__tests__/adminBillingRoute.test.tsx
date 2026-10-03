// Trasa /admin/billing - powłoka panelu rozliczeń subskrypcji.
//
// JAKIE RYZYKO TU PILNUJEMY. Sama trasa nie liczy pieniędzy - robi to
// `AdminBillingPanel` (osobny plik testów). Trasa odpowiada za dwie rzeczy,
// których złamania nie widać w testach panelu:
//   1. NAGŁÓWEK DOKUMENTU. Strona z listą subskrypcji, nieudanych płatności
//      i adresami kupujących NIE MOŻE trafić do indeksu wyszukiwarki
//      (`noindex, nofollow`). Zgubienie tego wpisu przy refaktorze `head()`
//      przechodziłoby przez CI bez śladu.
//   2. SKLEJENIE EKRANU. Nagłówek ma iść za językiem interfejsu
//      administratora (PL/EN), a pod nim ma stać panel rozliczeń - pusta
//      strona z samym tytułem wyglądałaby jak „brak subskrypcji".
//
// GRANICA ATRAPY. `AdminBillingPanel` zastępujemy znacznikiem: to sąsiad
// z własnym zestawem kilkunastu funkcji serwerowych (przypomnienia, katalog,
// dziennik webhooków, zamówienia, bilety), których ta trasa w ogóle nie
// dotyka - jego zachowanie dowodzi `AdminBillingPanel.test.tsx`. Słownik
// i router są PRAWDZIWE (`renderRoute`), więc `head()` przechodzi przez
// prawdziwe dopasowanie trasy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("@/components/admin/billing/AdminBillingPanel", () => ({
  AdminBillingPanel: () => <section data-testid="panel-rozliczen" />,
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { Route as AdminBillingRoute } from "@/routes/admin.billing";

const PATH = "/admin/billing";

async function mount() {
  const view = await renderRoute({ route: AdminBillingRoute, path: PATH, initialEntry: PATH });
  // Router domyka przejście asynchronicznie - asercje stoją na osiadłym ekranie.
  await screen.findByRole("heading", { level: 1 });
  return view;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("/admin/billing - nagłówek dokumentu", () => {
  it("strona rozliczeń jest wyłączona z indeksowania i ma własny tytuł", async () => {
    const view = await mount();

    expect(view.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(view.meta()).toContainEqual({
      title: "Rozliczenia subskrypcji | Panel New European Strategies",
    });
    expect(view.meta()).toContainEqual({
      name: "description",
      content:
        "Podgląd aktywnych subskrypcji, nieudanych płatności i historii zdarzeń operatora płatności.",
    });
  });
});

describe("/admin/billing - ekran", () => {
  it("po polsku: nagłówek „Rozliczenia” z opisem zakresu, a pod nim panel", async () => {
    await mount();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Rozliczenia" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Subskrypcje, miękka windykacja i historia zdarzeń od operatora płatności."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("panel-rozliczen")).toBeInTheDocument();
  });

  it("po angielsku: nagłówek „Billing” i angielski opis - bez polskich resztek", async () => {
    await i18n.changeLanguage("en");

    await mount();

    expect(await screen.findByRole("heading", { level: 1, name: "Billing" })).toBeInTheDocument();
    expect(
      screen.getByText("Subscriptions, dunning and payment provider event history."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Rozliczenia")).toBeNull();
    expect(screen.getByTestId("panel-rozliczen")).toBeInTheDocument();
  });
});
