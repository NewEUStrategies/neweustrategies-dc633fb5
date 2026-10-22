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
// (I9) Sygnał Diagnostyki ma własne testy (`RevenueSignalChip.test.tsx`) - tu
// sprawdzamy wyłącznie MIEJSCE montażu i ekran (`surface`).
vi.mock("@/components/admin/revenue/molecules/RevenueSignalChip", () => ({
  RevenueSignalChip: (props: { surface?: string; variant?: string }) => (
    <div
      data-testid="revenue-signal-mount"
      data-surface={props.surface}
      data-variant={props.variant}
    />
  ),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { Route as AdminBillingRoute } from "@/routes/admin.billing";

const PATH = "/admin/billing";

async function mount(search = "") {
  const view = await renderRoute({
    route: AdminBillingRoute,
    path: PATH,
    initialEntry: `${PATH}${search}`,
  });
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
    // ZMIANA ZAMIERZONA (S1, AGENTS `adminPageHead`): tytuł w jednym formacie
    // całego panelu zamiast ręcznie składanego „| Panel …".
    expect(view.meta()).toContainEqual({
      title: "Rozliczenia subskrypcji | New European Strategies",
    });
    expect(view.meta()).toContainEqual({
      name: "description",
      content:
        "Podgląd aktywnych subskrypcji, zamówień, nieudanych płatności i historii zdarzeń operatora płatności.",
    });
  });
});

describe("/admin/billing - sygnał huba (I9, SPEC §2.7)", () => {
  it("pasek Diagnostyki windykacji, jakości danych i katalogu stoi między nagłówkiem a panelem", async () => {
    await mount();
    const mount_ = screen.getByTestId("revenue-signal-mount");
    expect(mount_).toHaveAttribute("data-surface", "billing");
    expect(mount_).toHaveAttribute("data-variant", "bar");
    expect(
      mount_.compareDocumentPosition(screen.getByTestId("panel-rozliczen")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("/admin/billing - adres (SPEC §2.6, kontrakt z S2)", () => {
  it("poprawna zakładka i status z huba przechodzą walidację adresu", async () => {
    const view = await mount("?tab=orders&status=past_due");

    expect(view.search()).toMatchObject({ tab: "orders", status: "past_due" });
    expect(screen.getByTestId("panel-rozliczen")).toBeInTheDocument();
  });

  it("nieznana zakładka i status w złym kształcie znikają, zamiast wywracać stronę", async () => {
    const view = await mount("?tab=faktury&status=DROP%20TABLE");

    expect(view.search().tab).toBeUndefined();
    expect(view.search().status).toBeUndefined();
    expect(screen.getByTestId("panel-rozliczen")).toBeInTheDocument();
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
