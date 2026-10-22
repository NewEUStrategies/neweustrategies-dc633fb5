// Stan „w przygotowaniu" zakładki huba (I9a) - render, odnośniki i dostępność.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładka nie jest pustym ekranem: nagłówek z nazwą zakładki, zdanie
//      „w przygotowaniu" (kontrakt testów tras I0), co pokaże, etap i skoki do
//      modułów z ich parametrami (`?tab=definitions` dociera do odnośnika).
//   2. Zakładka z treścią (S7, Integrator S7 2026-10-22) nie ma wpisu
//      - molekuła nic nie rysuje zamiast starego „w przygotowaniu".
//   3. Angielski panel mówi po angielsku.
//   4. Brak naruszeń axe (lista definicji, nazwy odnośników).
//
// Tłumacz PRAWDZIWY, wstrzykiwany do atrapy po imporcie - fabryka `vi.mock`
// importująca `@/test/i18nReal` zakleszcza plik (`ReputationLevelChip.test`).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { RevenueTabPreparing } from "@/components/admin/revenue/molecules/RevenueTabPreparing";
import { TAB_PREPARING } from "@/lib/admin/revenue/tabPreparing";
import { REVENUE_TABS } from "@/lib/revenue/search";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-revenue-preparing";

h.fixedT = realT;

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

describe("RevenueTabPreparing", () => {
  it("ścieżki: nazwa zakładki, stan, co pokaże, etap S5 + S8 i skoki do modułów", () => {
    const t = realT("pl");
    render(<RevenueTabPreparing tab="journeys" />);

    const section = screen.getByRole("region", { name: t("adminRevenue.tab.journeys") });
    expect(section).toHaveAttribute("data-tab-state", "preparing");
    expect(section).toHaveTextContent("Ta sekcja huba jest w przygotowaniu.");
    expect(section).toHaveTextContent(t("adminRevenue.preparing.what.journeys"));
    expect(section).toHaveTextContent(t("adminRevenue.preparing.stage.s5s8"));

    const links = within(section).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(
      (TAB_PREPARING.journeys?.links ?? []).map((link) => t(link.labelKey)),
    );
    expect(
      within(section).getByRole("link", { name: t("adminRevenue.preparing.link.outbox") }),
    ).toHaveAttribute("href", "/admin/newsletter/outbox");
  });

  it.each(REVENUE_TABS.filter((tab) => tab !== "journeys"))(
    "%s: zakładka z treścią S7 nie ma stanu „w przygotowaniu” - nic się nie rysuje",
    (tab) => {
      const { container } = render(<RevenueTabPreparing tab={tab} />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("angielski panel mówi po angielsku", () => {
    h.lang = "en";
    render(<RevenueTabPreparing tab="journeys" />);
    const section = screen.getByRole("region", { name: "Journeys" });
    expect(section).toHaveTextContent("This hub section is being prepared.");
    expect(section).toHaveTextContent(realT("en")("adminRevenue.preparing.whatLabel"));
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(<RevenueTabPreparing tab="journeys" />);
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
