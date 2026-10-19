// `RelatedModulesBar` - nazwany punkt orientacyjny z odnośnikami do modułów
// źródłowych, każdy z nazwą w języku interfejsu i adresem z `RELATED_MODULES`.
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { RELATED_MODULES } from "@/lib/admin/revenue/hubTabs";
import { axeViolations, summarize } from "@/test/axe";
import { RelatedModulesBar } from "@/components/admin/revenue/molecules/RelatedModulesBar";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

async function renderInRouter(ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("RelatedModulesBar", () => {
  it("nawigacja nazwana „Powiązane moduły” z odnośnikiem do każdego modułu", async () => {
    await renderInRouter(<RelatedModulesBar items={RELATED_MODULES} />);

    const nav = await screen.findByRole("navigation", { name: "Powiązane moduły" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(RELATED_MODULES.map((m) => m.to));
    expect(within(nav).getByRole("link", { name: "Paywall i plany" })).toHaveAttribute(
      "href",
      "/admin/paywall",
    );
    expect(within(nav).getByRole("link", { name: "Analityka BI" })).toHaveAttribute(
      "href",
      "/admin/analytics/bi",
    );
  });

  it("pozycja z parametrem search prowadzi pod konkretną zakładkę modułu", async () => {
    await renderInRouter(
      <RelatedModulesBar
        items={[
          {
            to: "/admin/pricing",
            search: { tab: "retention" },
            labelKey: "adminRevenue.related.pricing",
          },
        ]}
      />,
    );

    expect(await screen.findByRole("link", { name: "Cennik" })).toHaveAttribute(
      "href",
      "/admin/pricing?tab=retention",
    );
  });

  it("pusta lista nie rysuje pustego landmarku", async () => {
    await renderInRouter(<RelatedModulesBar items={[]} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("wersja angielska", async () => {
    await i18n.changeLanguage("en");
    await renderInRouter(<RelatedModulesBar items={RELATED_MODULES} />);

    const nav = await screen.findByRole("navigation", { name: "Related modules" });
    expect(within(nav).getByRole("link", { name: "Billing" })).toHaveAttribute(
      "href",
      "/admin/billing",
    );
  });

  it("nie ma naruszeń dostępności", async () => {
    const view = await renderInRouter(<RelatedModulesBar items={RELATED_MODULES} />);
    await screen.findByRole("navigation");
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});
