import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ lang: "pl", rpc: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.lang } }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/components/ui/select", async () => await import("@/test/platform/nativeControls"));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const db = supabaseFromStub();
  return { supabase: { from: db.from, rpc: (...args: unknown[]) => h.rpc(...args) }, db };
});
import { Route } from "@/routes/admin.monetization";
import * as client from "@/integrations/supabase/client";
import { ok, fail, type SupabaseFromStub } from "@/test/supabaseChain";
const db = (client as unknown as { db: SupabaseFromStub }).db;
const dashboard = {
  range: { from: "2026-08-07", to: "2026-09-06" },
  metered_views: { total: 123, members: 23, anonymous: 100 },
  metering_events: { denied: 17, reg_wall: 14, consumed: 9 },
  orders: { total: 8, paid: 5, revenue_cents: 123400 },
  coupons: { active: 2, total: 9, redemptions: 4 },
  redemptions: { in_range: 4, discount_cents: 3000 },
  checkout_settings: { allow_promotion_codes: true, automatic_tax: false, tax_id_collection: true },
};
let qc: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  h.lang = "pl";
  db.reset();
  db.setResponse(
    "access_plans",
    ok([
      { id: "plan", name_pl: "Plan Polski", name_en: "English plan" },
      { id: "pl-only", name_pl: "Tylko PL", name_en: "" },
      { id: "en-only", name_pl: "", name_en: "Only EN" },
      { id: "unnamed", name_pl: "", name_en: "" },
    ]),
  );
  db.setResponse("member_organizations", ok([{ id: "org", name: "Organizacja A" }]));
  db.setResponse("retention_feedback", ok([]));
  h.rpc.mockResolvedValue(ok(dashboard));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.useRealTimers();
});
function mount() {
  const Component = Route.options.component!;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}

describe("monetization read contract and truthful status", () => {
  it.each(["pl", "en"])("renders confirmed metrics and checkout flags in %s", async (lang) => {
    h.lang = lang;
    mount();
    await screen.findByText("123");
    expect(screen.getByText("17")).toBeTruthy();
    expect(screen.getByText("2 / 9")).toBeTruthy();
    expect(screen.getAllByText(lang === "pl" ? "Włączone" : "On")).toHaveLength(2);
    expect(screen.getAllByText(lang === "pl" ? "Wyłączone" : "Off")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "unnamed" })).toBeTruthy();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/pricing");
    expect(h.rpc).toHaveBeenCalledWith("monetization_dashboard", {
      _from: "2026-08-07T00:00:00.000Z",
      _to: "2026-09-06T23:59:59.999Z",
      _plan_id: "00000000-0000-0000-0000-000000000000",
      _organization_id: "00000000-0000-0000-0000-000000000000",
    });
  });
  it("applies the inclusive UTC date range and selected plan and organisation", async () => {
    mount();
    await screen.findByText("123");
    fireEvent.change(screen.getByLabelText("Od"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Do"), { target: { value: "2026-09-03" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "plan" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "org" } });
    await waitFor(() =>
      expect(h.rpc).toHaveBeenLastCalledWith("monetization_dashboard", {
        _from: "2026-09-01T00:00:00.000Z",
        _to: "2026-09-03T23:59:59.999Z",
        _plan_id: "plan",
        _organization_id: "org",
      }),
    );
  });
  it.each(["", "2026-12-31"])(
    "does not query or display stale metrics for invalid range %s",
    async (from) => {
      mount();
      await screen.findByText("123");
      h.rpc.mockClear();
      fireEvent.change(screen.getByLabelText("Od"), { target: { value: from } });
      expect(screen.getByRole("alert")).toHaveTextContent("adminMonetization.rangeError");
      expect(screen.queryByText("123")).toBeNull();
      expect(h.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    "access_plans",
    "member_organizations",
    "retention_feedback",
    "dashboard",
    "empty-dashboard",
  ])("shows a visible error for %s without inventing results", async (source) => {
    if (source === "dashboard") h.rpc.mockResolvedValue(fail("permission denied"));
    else if (source === "empty-dashboard") h.rpc.mockResolvedValue(ok(null));
    else db.setResponse(source, fail("permission denied"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/adminMonetization\..*Error/);
    if (source.includes("dashboard")) expect(screen.queryByText("Przychód (opłacone)")).toBeNull();
  });
  it("accepts empty filter data and hides metrics until the RPC resolves", async () => {
    db.setResponse("access_plans", ok(null));
    db.setResponse("member_organizations", ok(null));
    db.setResponse("retention_feedback", ok(null));
    let resolve!: (data: unknown) => void;
    h.rpc.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mount();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.queryByText("Przychód (opłacone)")).toBeNull();
    await act(async () => {
      resolve(ok(dashboard));
    });
    await screen.findByText("123");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
  it("aggregates only the last 90 days and calculates acceptance using shown offers", async () => {
    db.setResponse(
      "retention_feedback",
      ok([
        { created_at: "2026-09-01", reason_label: "Cena", offer_shown: true, offer_accepted: true },
        {
          created_at: "2026-08-01",
          reason_label: "Cena",
          offer_shown: true,
          offer_accepted: false,
        },
        {
          created_at: "2026-07-01",
          reason_label: "Treść",
          offer_shown: false,
          offer_accepted: false,
        },
        {
          created_at: "2026-01-01",
          reason_label: "Zbyt stare",
          offer_shown: true,
          offer_accepted: true,
        },
      ]),
    );
    mount();
    await screen.findByText("(50%)");
    expect(screen.getByText("Cena")).toBeTruthy();
    expect(screen.getByText("Treść")).toBeTruthy();
    expect(screen.queryByText("Zbyt stare")).toBeNull();
  });
  it("shows no percentage when no retention offer was shown", async () => {
    db.setResponse(
      "retention_feedback",
      ok([
        {
          created_at: "2026-09-01",
          reason_label: "Inne",
          offer_shown: false,
          offer_accepted: false,
        },
      ]),
    );
    mount();
    await screen.findByText("Inne");
    expect(screen.queryByText(/\(\d+%\)/)).toBeNull();
  });
});
