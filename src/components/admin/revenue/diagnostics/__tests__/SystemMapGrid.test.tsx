// `SystemMapGrid` (S7, SPEC §2.2 `?view=map`, §3.2) - „Mapa systemu"
// z `HUB_SYNC_MANIFEST`: byt → pisarze → zdarzenia → zakładki → właściciel.
//
// CO TEN PLIK DOWODZI: tabela ma `caption` i nagłówki `scope` (kolumny
// i wiersze), po jednym wierszu na byt manifestu (ten sam manifest co
// nagłówki źródeł w naprawach - bez drugiej listy), szeroka treść jest
// w przewijalnym regionie z nazwą i fokusem z klawiatury; axe bez naruszeń.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { SystemMapGrid } from "@/components/admin/revenue/diagnostics/SystemMapGrid";
import { ownerAddress, writerLabel } from "@/components/admin/revenue/diagnostics/systemMap";
import { HUB_SYNC_MANIFEST, type HubEntity } from "@/lib/revenue/syncManifest";

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

describe("SystemMapGrid", () => {
  it("jeden wiersz na byt manifestu, tabela z caption i scope", () => {
    render(<SystemMapGrid />);
    const t = realT("pl");
    const table = screen.getByRole("table", { name: t("adminRevenue.diagnostics.map.caption") });
    const columns = within(table).getAllByRole("columnheader");
    expect(columns.map((c) => c.getAttribute("scope"))).toEqual(Array(5).fill("col"));
    expect(columns.map((c) => c.textContent)).toEqual([
      t("adminRevenue.diagnostics.map.entity"),
      t("adminRevenue.diagnostics.map.writers"),
      t("adminRevenue.diagnostics.map.events"),
      t("adminRevenue.diagnostics.map.tabs"),
      t("adminRevenue.diagnostics.map.owner"),
    ]);
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(HUB_SYNC_MANIFEST.length);
    expect(rowHeaders.every((th) => th.getAttribute("scope") === "row")).toBe(true);
    expect(
      [...table.querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-entity")),
    ).toEqual(HUB_SYNC_MANIFEST.map((e) => e.id));
  });

  it("wiersz planu: pisarz z manifestu, zdarzenie, zakładki huba i ekran właściciela", () => {
    render(<SystemMapGrid />);
    const plan = HUB_SYNC_MANIFEST.find((e) => e.id === "access_plan");
    if (!plan) throw new Error("brak bytu access_plan w manifeście");
    const t = realT("pl");
    const row = screen.getByRole("row", { name: new RegExp(t("adminRevenue.source.entity.access_plan")) });
    for (const writer of plan.writers) {
      expect(within(row).getByText(writerLabel(writer.ref))).toBeInTheDocument();
    }
    for (const event of plan.events) {
      expect(within(row).getByText(event)).toBeInTheDocument();
    }
    for (const tab of plan.hubTabs) {
      expect(row).toHaveTextContent(t(`adminRevenue.tab.${tab}`));
    }
    for (const owner of plan.owners) {
      expect(within(row).getAllByText(ownerAddress(owner)).length).toBeGreaterThan(0);
    }
  });

  it("byt bez ekranu i bez zdarzeń mówi to słowem", () => {
    const systemOnly: HubEntity = {
      id: "journey_run",
      tables: [],
      writers: [{ kind: "trigger", ref: "journey_runs_emit" }],
      owners: [],
      keys: [],
      events: [],
      hubTabs: [],
      metrics: [],
    };
    render(<SystemMapGrid entities={[systemOnly]} />);
    const t = realT("pl");
    const row = screen.getByRole("row", { name: new RegExp(t("adminRevenue.source.entity.journey_run")) });
    expect(within(row).getByText(t("adminRevenue.diagnostics.map.systemOnly"))).toBeInTheDocument();
    expect(within(row).getByText(/wyzwalacz/)).toBeInTheDocument();
  });

  it("przewijalny region z nazwą i fokusem; axe bez naruszeń", async () => {
    const { container } = render(<SystemMapGrid />);
    const region = screen.getByRole("region", {
      name: realT("pl")("adminRevenue.diagnostics.map.scrollRegion"),
    });
    expect(region).toHaveAttribute("tabindex", "0");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("napisy mapy systemu", () => {
  it("pisarz: eksport, plik albo funkcja SQL", () => {
    expect(writerLabel("src/lib/billing/planQueries.ts#useSaveAccessPlanPatch")).toBe(
      "useSaveAccessPlanPatch",
    );
    expect(writerLabel("src/lib/billing/webhookDispatch.server.ts")).toBe(
      "webhookDispatch.server.ts",
    );
    expect(writerLabel("admin_revenue_diagnostic_snooze")).toBe("admin_revenue_diagnostic_snooze");
  });

  it("adres właściciela: parametry trasy i kontrakt `?tab=`, szablon bez wartości zostaje", () => {
    expect(ownerAddress({ to: "/admin/paywall", search: { tab: "plans" } })).toBe(
      "/admin/paywall?tab=plans",
    );
    expect(
      ownerAddress({ to: "/admin/revenue/$tab", params: { tab: "inputs" } }),
    ).toBe("/admin/revenue/inputs");
    expect(ownerAddress({ to: "/admin/posts/$slug" })).toBe("/admin/posts/$slug");
  });
});
