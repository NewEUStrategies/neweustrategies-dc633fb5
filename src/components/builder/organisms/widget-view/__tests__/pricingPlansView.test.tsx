// PricingPlansView: karty cennika synchronizowane z katalogiem access_plans
// (ten sam obraz danych co /pricing). Testujemy filtry (okres, tier_key,
// limit), stan pusty, skeleton ładowania, wyróżnienie planu (badge +
// obramowanie), etykiety okresów PL/EN oraz CTA do /checkout/$planId.
// Dodatkowo: routing z SimpleWidgets - widget "pricing" z source="plans".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "not", "order", "range", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: { from: (t: string) => makeBuilder(t), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PricingPlansView } from "../PricingPlansView";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const plan = (over: Record<string, unknown> = {}) => ({
  id: "plan-m",
  tenant_id: "t1",
  name_pl: "Miesięczny",
  name_en: "Monthly",
  description_pl: null,
  description_en: null,
  price_cents: 4900,
  currency: "PLN",
  interval: "month",
  active: true,
  sort_order: 1,
  features_pl: ["Dostęp do analiz", "Newsletter premium"],
  features_en: ["Analyses access", "Premium newsletter"],
  badge_pl: null,
  badge_en: null,
  highlighted: false,
  trial_days: 0,
  tier_key: "standard",
  ...over,
});

beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("PricingPlansView - katalog planów", () => {
  it("shows the loading skeleton, then renders cards with features and checkout CTA", async () => {
    db.tables.access_plans = [plan()];
    const { container } = wrap(<PricingPlansView lang="pl" />);

    // Zanim zapytanie się rozwiąże - szkielet z aria-busy.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    expect(await screen.findByText("Miesięczny")).toBeInTheDocument();
    expect(screen.getByText("Dostęp do analiz")).toBeInTheDocument();
    expect(screen.getByText("/mies.")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "Wybierz" });
    expect(cta).toHaveAttribute("href", "/checkout/plan-m");
  });

  it("marks the highlighted plan with a badge and brand styling", async () => {
    db.tables.access_plans = [
      plan({
        id: "plan-y",
        name_pl: "Roczny",
        interval: "year",
        highlighted: true,
        badge_pl: "Najpopularniejszy",
        badge_en: "Most popular",
      }),
    ];
    const { container } = wrap(<PricingPlansView lang="pl" ctaLabel="  Kup teraz  " />);

    expect(await screen.findByText("Najpopularniejszy")).toBeInTheDocument();
    expect(screen.getByText("/rok")).toBeInTheDocument();
    expect(container.querySelector(".border-brand")).not.toBeNull();
    // Własna etykieta CTA jest przycinana.
    expect(screen.getByRole("link", { name: "Kup teraz" })).toBeInTheDocument();
  });

  it("filters by interval and tier keys and applies the limit", async () => {
    db.tables.access_plans = [
      plan(),
      plan({ id: "plan-y", name_pl: "Roczny", interval: "year", tier_key: "pro" }),
      plan({ id: "plan-q", name_pl: "Kwartalny", interval: "quarter", tier_key: null }),
    ];
    const first = wrap(<PricingPlansView lang="pl" interval="year" />);
    expect(await screen.findByText("Roczny")).toBeInTheDocument();
    expect(screen.queryByText("Miesięczny")).not.toBeInTheDocument();
    first.unmount();

    // Filtr tier_key: plan bez tier_key nigdy nie przechodzi przez filtr.
    const second = wrap(<PricingPlansView lang="pl" tierKeysCsv=" standard , pro " />);
    expect(await screen.findByText("Miesięczny")).toBeInTheDocument();
    expect(screen.getByText("Roczny")).toBeInTheDocument();
    expect(screen.queryByText("Kwartalny")).not.toBeInTheDocument();
    second.unmount();

    // Limit przycina posortowaną listę.
    wrap(<PricingPlansView lang="pl" limit={1} />);
    expect(await screen.findByText("Miesięczny")).toBeInTheDocument();
    expect(screen.queryByText("Roczny")).not.toBeInTheDocument();
  });

  it("renders EN names, EN period labels and the EN empty state", async () => {
    db.tables.access_plans = [plan({ interval: "one_time", badge_en: "Deal", badge_pl: "Okazja" })];
    const first = wrap(<PricingPlansView lang="en" />);
    expect(await screen.findByText("Monthly")).toBeInTheDocument();
    expect(screen.getByText("once")).toBeInTheDocument();
    expect(screen.getByText("Deal")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose" })).toBeInTheDocument();
    first.unmount();

    db.tables.access_plans = [];
    wrap(<PricingPlansView lang="en" />);
    await waitFor(() => expect(screen.getByText("No active plans.")).toBeInTheDocument());
  });

  it("shows the Polish empty state and tolerates an unknown interval label", async () => {
    db.tables.access_plans = [plan({ interval: "eon" })];
    const first = wrap(<PricingPlansView lang="pl" />);
    // Nieznany okres -> brak etykiety, karta renderuje się poprawnie.
    expect(await screen.findByText("Miesięczny")).toBeInTheDocument();
    first.unmount();

    db.tables.access_plans = [];
    wrap(<PricingPlansView lang="pl" />);
    await waitFor(() => expect(screen.getByText("Brak aktywnych planów.")).toBeInTheDocument());
  });
});

describe("widget pricing w trybie source=plans (routing z SimpleWidgets)", () => {
  it("renders catalog cards with the widget-level CTA and plan limit", async () => {
    db.tables.access_plans = [plan(), plan({ id: "plan-2", name_pl: "Drugi", sort_order: 2 })];
    const node: WidgetNode = {
      id: "w-pricing",
      kind: "widget",
      type: "pricing",
      content: { source: "plans", planLimit: 1, cta_pl: "Dołącz" },
    };
    wrap(<WidgetView node={node} lang="pl" device="desktop" />);

    expect(await screen.findByText("Miesięczny")).toBeInTheDocument();
    expect(screen.queryByText("Drugi")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dołącz" })).toBeInTheDocument();
  });
});
