// Organizmy paywalla w trybie `readOnly` (hub S7: redaktor ogląda, nie
// zapisuje) i ich dostępność (axe, cele 24 px, opisy podpowiedzi).
//
// PO CO. Hub „Przychód i lejek" montuje te same organizmy co /admin/paywall
// (PLAN S1 §4.7). Podgląd, w którym da się kliknąć „Zapisz", to zapis
// z ekranu, który obiecuje, że niczego nie zmienia - więc każdy przycisk
// zapisu ma być wyłączony Z POWODEM (`DisabledReason`), a pola zablokowane.
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, type SupabaseFromStub } from "@/test/supabase";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({ rpc: vi.fn(), roles: ["admin"] as string[] }));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  // Radix wiąże okno z tytułem (`aria-labelledby`) - atrapa robi to samo,
  // inaczej axe zgłosiłby artefakt atrapy, a nie organizmu.
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog" aria-labelledby="dialog-title">
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2 id="dialog-title">{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => "tenant-1" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ roles: h.roles }) }));
vi.mock("@/lib/billing/displayCurrency", () => ({
  convertToDisplayCurrency: (cents: number) => ({ cents, currency: "EUR" }),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  return {
    supabase: {
      from: db.from,
      rpc: (...args: unknown[]) => h.rpc(...args),
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
    db,
  };
});

import * as client from "@/integrations/supabase/client";
import { AccessPlanEditorDialog } from "@/components/admin/paywall/AccessPlanEditorDialog";
import { CheckoutSettingsCard } from "@/components/admin/paywall/CheckoutSettingsCard";
import { MeteringOverridesCard } from "@/components/admin/paywall/MeteringOverridesCard";
import { MeteringSettingsCard } from "@/components/admin/paywall/MeteringSettingsCard";
import { PaywallKpiStrip } from "@/components/admin/paywall/PaywallKpiStrip";
import { planMissingCatalogPair } from "@/components/admin/paywall/accessPlanDraft";
import { PaywallPlansSection } from "@/components/admin/paywall/PaywallPlansSection";
import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";

const db: SupabaseFromStub = Reflect.get(client, "db");
const TOKEN = "2026-10-19T10:00:00.123456+00:00";
const plan = {
  id: "plan-1",
  tenant_id: "tenant-1",
  name_pl: "Plus",
  name_en: "Plus EN",
  description_pl: null,
  description_en: null,
  price_cents: 4900,
  currency: "PLN",
  interval: "month",
  active: true,
  for_sale: true,
  sort_order: 0,
  features_pl: [],
  features_en: [],
  badge_pl: null,
  badge_en: null,
  highlighted: false,
  trial_days: 0,
  tier_key: null,
  volume_price_cents: null,
  volume_threshold_seats: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: TOKEN,
};

let qc: QueryClient;
beforeEach(() => {
  db.reset();
  h.roles = ["admin"];
  h.rpc.mockResolvedValue(ok([]));
  db.setResponse("access_plans", ok([plan]));
  db.setResponse("metering_settings", ok({ ...METERING_DEFAULTS, updated_at: TOKEN }));
  db.setResponse("checkout_settings", ok({ ...DEFAULT_CHECKOUT_SETTINGS, updated_at: TOKEN }));
  db.setResponse("content_access", {
    data: [
      {
        id: "r1",
        entity_type: "post",
        entity_id: "p1",
        mode: "paid",
        metering_policy: "exempt",
        updated_at: TOKEN,
      },
    ],
    error: null,
    count: 1,
  });
  db.setResponse("posts", ok([{ id: "p1", title_pl: "Wpis", title_en: null, slug: "wpis" }]));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
});

function mount(node: ReactNode) {
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** Każdy przycisk zapisu: wyłączony, a jego opakowanie wskazuje powód. */
function expectDisabledWithReason(name: string) {
  const button = screen.getByRole("button", { name });
  expect(button).toBeDisabled();
  const describedBy = button.parentElement?.getAttribute("aria-describedby");
  expect(describedBy && document.getElementById(describedBy)).toHaveTextContent(
    "adminPaywall.readOnly.hint",
  );
}

describe("readOnly organisms (hub S7)", () => {
  it("plan list: no new plan, no delete - each with the read-only reason", async () => {
    mount(<PaywallPlansSection onEdit={() => {}} readOnly />);
    await screen.findByText("Plus");
    expectDisabledWithReason("adminPaywall.plans.add");
    expectDisabledWithReason("adminPaywall.plans.deleteLabel(name=Plus)");
    // Edycja zostaje - otwiera edytor, który sam jest tylko do odczytu.
    expect(
      screen.getByRole("button", { name: "adminPaywall.plans.editLabel(name=Plus)" }),
    ).not.toBeDisabled();
  });

  it("plan editor: every field and the save are locked", async () => {
    mount(<AccessPlanEditorDialog planId="plan-1" open onOpenChange={() => {}} readOnly />);
    const name = await screen.findByLabelText("adminPaywall.editor.namePl");
    expect(name).toBeDisabled();
    expect(screen.getByRole("switch", { name: "adminPaywall.editor.forSale" })).toBeDisabled();
    expectDisabledWithReason("adminPaywall.editor.save");
  });

  it("quota settings: switches locked, save disabled with the reason", async () => {
    mount(<MeteringSettingsCard readOnly />);
    await screen.findByLabelText("adminPaywall.metering.memberLimit");
    expect(screen.getByRole("switch", { name: "adminPaywall.metering.enabled" })).toBeDisabled();
    expectDisabledWithReason("adminPaywall.metering.save");
  });

  it("quota settings without a row: the enable action is disabled too", async () => {
    db.setResponse("metering_settings", ok(null));
    mount(<MeteringSettingsCard readOnly />);
    await screen.findByText("adminPaywall.metering.missingTitle");
    expectDisabledWithReason("adminPaywall.metering.enableDefaults");
  });

  it("overrides: the policy select is locked", async () => {
    mount(<MeteringOverridesCard readOnly />);
    expect(
      await screen.findByLabelText("adminPaywall.overrides.policyLabel(title=Wpis)"),
    ).toBeDisabled();
  });

  it("checkout: toggles locked, save disabled with the reason", async () => {
    mount(<CheckoutSettingsCard readOnly />);
    await screen.findByText("adminPaywall.checkout.plane.managed");
    expect(screen.getByRole("switch", { name: "adminPaywall.checkout.allowPromo" })).toBeDisabled();
    expectDisabledWithReason("adminPaywall.checkout.save");
  });
});

describe("accessibility (axe)", () => {
  it.each([
    ["plan list", () => <PaywallPlansSection onEdit={() => {}} />, "Plus"],
    ["KPI strip", () => <PaywallKpiStrip />, "adminPaywall.kpi.meteringOn(limit=5)"],
    [
      "plan editor",
      () => <AccessPlanEditorDialog planId="plan-1" open onOpenChange={() => {}} />,
      "adminPaywall.editor.forSale",
    ],
    ["quota settings", () => <MeteringSettingsCard />, "adminPaywall.metering.enabled"],
    ["overrides", () => <MeteringOverridesCard />, "Wpis"],
    ["checkout", () => <CheckoutSettingsCard />, "adminPaywall.checkout.plane.managed"],
  ])("%s has no axe violations", async (_, node, marker) => {
    const { container } = mount(node());
    await screen.findAllByText(marker);
    await waitFor(() => expect(screen.queryAllByRole("status")).toHaveLength(0));
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("checkout catalogue pair rule", () => {
  it.each([
    [{ for_sale: true, interval: "month", tier_key: "pro" }, false],
    [{ for_sale: true, interval: "month", tier_key: null }, true],
    [{ for_sale: true, interval: "month", tier_key: "nieznana" }, true],
    [{ for_sale: false, interval: "month", tier_key: null }, false],
    [{ for_sale: true, interval: "one_time", tier_key: null }, false],
  ] as const)("%o -> missing pair: %s", (input, expected) => {
    expect(planMissingCatalogPair(input)).toBe(expected);
  });
});
