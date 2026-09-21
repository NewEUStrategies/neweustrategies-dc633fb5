import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, type SupabaseFromStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  lang: "pl",
  rpc: vi.fn(),
  session: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.lang } }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/components/admin/AdminShell", () => ({
  AdminShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/ui/select", async () => await import("@/test/platform/nativeControls"));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params: { slug: string };
    children: ReactNode;
  }) => <a href={to.replace("$slug", params.slug)}>{children}</a>,
}));
vi.mock("@/hooks/useContentAccess", () => ({
  formatMoney: (cents: number, currency: string) => `${cents} ${currency}`,
}));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  return {
    supabase: {
      from: db.from,
      rpc: (...args: unknown[]) => h.rpc(...args),
      auth: { getSession: () => h.session() },
    },
    db,
  };
});
import { Route } from "@/routes/admin.paywall";
import * as client from "@/integrations/supabase/client";
import { DEFAULT_METERING_SETTINGS } from "@/lib/access/metering";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";
const db: SupabaseFromStub = Reflect.get(client, "db");
const plan = {
  id: "plan-one",
  name_pl: "Plan Polski",
  name_en: "English plan",
  description_pl: "Opis",
  description_en: "Description",
  price_cents: 1900,
  currency: "PLN",
  interval: "month",
  active: true,
  sort_order: 0,
  features_pl: ["Archiwum"],
  features_en: ["Archive"],
  badge_pl: "Popularny",
  badge_en: "Popular",
  highlighted: true,
  trial_days: 7,
};
const impact = {
  total_members: 10,
  members_blocked: 2,
  members_warning: 3,
  members_safe: 5,
  total_anon: 4,
  anon_blocked: 1,
  avg_used: 12,
  max_used: 30,
  total_views: 100,
};
let qc: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.lang = "pl";
  db.reset();
  db.setResponse("access_plans", ok([plan]));
  db.setResponse("metering_settings", ok(DEFAULT_METERING_SETTINGS));
  db.setResponse("checkout_settings", ok(DEFAULT_CHECKOUT_SETTINGS));
  db.setResponse("content_access", ok([]));
  h.rpc.mockResolvedValue(ok([impact]));
  h.session.mockResolvedValue({ data: { session: { user: { id: "staff" } } }, error: null });
  h.confirm.mockResolvedValue(true);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function mount() {
  const Component = Route.options.component!;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}
function tab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name: `admin.paywall.tab${name}` }), {
    button: 0,
    ctrlKey: false,
  });
}
function change(key: string, value: string) {
  fireEvent.change(screen.getByLabelText(`admin.paywall.${key}`), { target: { value } });
}
function select(value: string, index = 0) {
  fireEvent.change(screen.getAllByRole("combobox")[index], { target: { value } });
}
function toggle(key: string) {
  fireEvent.click(screen.getByRole("switch", { name: `admin.paywall.${key}` }));
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "admin.save" }));
}

describe("paywall plan editor", () => {
  it("renders persisted plans, edit state and cancel without mutating persisted data", async () => {
    mount();
    await screen.findByText("Plan Polski");
    expect(screen.getByText("English plan")).toBeTruthy();
    expect(screen.getByText("1900 PLN")).toBeTruthy();
    expect(db.lastChain("access_plans")?.argsOf("order")).toEqual(["sort_order"]);
    fireEvent.click(screen.getByRole("button", { name: "admin.paywall.edit" }));
    expect(screen.getByLabelText("admin.paywall.namePl")).toHaveValue("Plan Polski");
    change("namePl", "Unsaved");
    fireEvent.click(screen.getByRole("button", { name: "admin.cancel" }));
    expect(screen.getByLabelText("admin.paywall.namePl")).toHaveValue("");
    expect(screen.getByText("Plan Polski")).toBeTruthy();
  });
  it("saves all editable fields with correct number, boolean, interval and feature-list values", async () => {
    mount();
    await screen.findByText("Plan Polski");
    fireEvent.click(screen.getByRole("button", { name: "admin.paywall.edit" }));
    for (const [key, value] of Object.entries({
      namePl: "Nowy",
      nameEn: "New",
      descPl: "Opis 2",
      descEn: "Description 2",
      priceCents: "3200",
      currency: "EUR",
      trialDays: "14",
      sort: "2",
      badgePl: "PL",
      badgeEn: "EN",
      featuresPl: "  Alfa \n\n Beta ",
      featuresEn: " One \n Two ",
    }))
      change(key, value);
    select("year");
    toggle("active");
    toggle("highlighted");
    save();
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("admin.paywall.savedPlan"));
    const write = db.chainsFor("access_plans").find((c) => c.has("update"))!;
    expect(write.argsOf("eq")).toEqual(["id", "plan-one"]);
    expect(write.argsOf("update")?.[0]).toMatchObject({
      id: "plan-one",
      name_pl: "Nowy",
      name_en: "New",
      description_pl: "Opis 2",
      description_en: "Description 2",
      price_cents: 3200,
      currency: "EUR",
      interval: "year",
      trial_days: 14,
      sort_order: 2,
      active: false,
      highlighted: false,
      badge_pl: "PL",
      badge_en: "EN",
      features_pl: ["Alfa", "Beta"],
      features_en: ["One", "Two"],
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "admin.paywall.addPlan" })).not.toBeDisabled(),
    );
  });
  it("inserts a new plan and reloads the list only after a successful write", async () => {
    db.setResponse("access_plans", ok(null));
    mount();
    await screen.findByText("admin.paywall.empty");
    change("namePl", "Nowy plan");
    fireEvent.click(screen.getByRole("button", { name: "admin.paywall.addPlan" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(
      db
        .chainsFor("access_plans")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ name_pl: "Nowy plan", price_cents: 1900, active: true });
  });
  it.each(["database", "network"])(
    "preserves the draft and releases busy state on %s write failure",
    async (mode) => {
      db.setResponse("access_plans", (chain) => {
        if (chain.has("insert")) {
          if (mode === "network") throw new Error("offline");
          return fail("denied");
        }
        return ok([]);
      });
      mount();
      await screen.findByText("admin.paywall.empty");
      change("namePl", "Keep me");
      fireEvent.click(screen.getByRole("button", { name: "admin.paywall.addPlan" }));
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save"));
      expect(screen.getByLabelText("admin.paywall.namePl")).toHaveValue("Keep me");
      expect(screen.getByRole("button", { name: "admin.paywall.addPlan" })).not.toBeDisabled();
      expect(h.success).not.toHaveBeenCalled();
    },
  );
  it.each(["cancel", "success", "database", "network"])(
    "delete confirmation handles %s",
    async (mode) => {
      h.confirm.mockResolvedValue(mode !== "cancel");
      db.setResponse("access_plans", (chain) => {
        if (chain.has("delete")) {
          if (mode === "network") throw new Error("offline");
          return mode === "database" ? fail("referenced") : ok(null);
        }
        return ok([plan]);
      });
      mount();
      await screen.findByText("Plan Polski");
      fireEvent.click(screen.getByRole("button", { name: "admin.delete" }));
      await waitFor(() => expect(h.confirm).toHaveBeenCalled());
      if (mode === "cancel")
        expect(db.chainsFor("access_plans").some((c) => c.has("delete"))).toBe(false);
      else if (mode === "success") {
        await waitFor(() => expect(h.success).toHaveBeenCalledWith("admin.paywall.removed"));
        expect(
          db
            .chainsFor("access_plans")
            .find((c) => c.has("delete"))
            ?.argsOf("eq"),
        ).toEqual(["id", "plan-one"]);
      } else {
        await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "delete"));
        expect(h.success).not.toHaveBeenCalled();
      }
    },
  );
  it("distinguishes loading and failure from an empty plan catalog", async () => {
    let resolve!: (data: ReturnType<typeof fail>) => void;
    db.setResponse(
      "access_plans",
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("common.loading");
    expect(screen.queryByText("admin.paywall.empty")).toBeNull();
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    await act(async () => {
      resolve(fail("denied"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("admin.paywall.readError");
    expect(screen.queryByText("admin.paywall.empty")).toBeNull();
  });
  it("renders unhighlighted, inactive and English-only plans without a PLN conversion", async () => {
    db.setResponse(
      "access_plans",
      ok([{ ...plan, name_pl: "", currency: "EUR", highlighted: false, active: false }]),
    );
    mount();
    await screen.findByText("English plan");
    expect(screen.queryByText(/^EN:/)).toBeNull();
    expect(screen.queryByText(/×/)).toBeNull();
  });
});

describe("metering and checkout settings writes", () => {
  it("saves metering toggles and clamps limits to the database contract", async () => {
    mount();
    tab("Metering");
    await screen.findByLabelText("admin.paywall.meteringMemberLimit");
    change("meteringMemberLimit", "1200");
    change("meteringAnonLimit", "-5");
    for (const key of ["meteringMeterPaid", "meteringMeterMembers", "meteringShowCounter"])
      toggle(key);
    save();
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("admin.paywall.meteringSaved"));
    expect(
      db
        .chainsFor("metering_settings")
        .find((c) => c.has("upsert"))
        ?.argsOf("upsert"),
    ).toEqual([
      {
        enabled: true,
        member_monthly_limit: 1000,
        anon_monthly_limit: 0,
        meter_paid: false,
        meter_members: false,
        show_counter: false,
        updated_by: "staff",
      },
      { onConflict: "tenant_id" },
    ]);
  });
  it("disabled metering disables dependent controls and avoids the impact RPC", async () => {
    db.setResponse("metering_settings", ok({ ...DEFAULT_METERING_SETTINGS, enabled: false }));
    mount();
    tab("Metering");
    await screen.findByText("admin.paywall.meteringImpactDisabled");
    expect(screen.getByLabelText("admin.paywall.meteringMemberLimit")).toBeDisabled();
    expect(h.rpc).not.toHaveBeenCalled();
    toggle("meteringEnabled");
    change("meteringMemberLimit", "");
    expect(screen.getByLabelText("admin.paywall.meteringMemberLimit")).toHaveValue(0);
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
  });
  it("previews checkout flags from the shared session serializer and saves all fields", async () => {
    mount();
    tab("Checkout");
    await screen.findByText("admin.paywall.planManaged");
    for (const key of ["allowPromo", "automaticTax", "taxIdCollection", "invoiceCreation"])
      toggle(key);
    select("required");
    expect(screen.getByText("admin.paywall.planMerchant")).toBeTruthy();
    save();
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("admin.paywall.checkoutSaved"));
    expect(
      db
        .chainsFor("checkout_settings")
        .find((c) => c.has("upsert"))
        ?.argsOf("upsert"),
    ).toEqual([
      {
        allow_promotion_codes: false,
        automatic_tax: true,
        tax_id_collection: false,
        invoice_creation: false,
        billing_address_collection: "required",
        updated_by: "staff",
      },
      { onConflict: "tenant_id" },
    ]);
    select("auto");
  });
  it.each(["Metering", "Checkout"])(
    "%s supports missing session metadata without inventing an actor",
    async (section) => {
      h.session.mockResolvedValue({ data: { session: null }, error: null });
      mount();
      tab(section);
      await screen.findByRole("button", { name: "admin.save" });
      save();
      await waitFor(() => expect(h.success).toHaveBeenCalled());
      const table = section === "Metering" ? "metering_settings" : "checkout_settings";
      expect(
        db
          .chainsFor(table)
          .find((c) => c.has("upsert"))
          ?.argsOf("upsert")?.[0],
      ).toHaveProperty("updated_by", null);
    },
  );
  it.each(["Metering", "Checkout"])(
    "%s distinguishes a read failure from editable defaults",
    async (section) => {
      db.setResponse(
        section === "Metering" ? "metering_settings" : "checkout_settings",
        fail("denied"),
      );
      mount();
      tab(section);
      expect(await screen.findByRole("alert")).toHaveTextContent("admin.paywall.readError");
      expect(screen.queryByRole("button", { name: "admin.save" })).toBeNull();
    },
  );
  it.each(["Metering", "Checkout"])(
    "%s releases busy state after all forms of persistence failure",
    async (section) => {
      const table = section === "Metering" ? "metering_settings" : "checkout_settings";
      mount();
      tab(section);
      await screen.findByRole("button", { name: "admin.save" });
      for (const mode of ["database", "network", "session"]) {
        db.setResponse(table, (chain) => {
          if (chain.has("upsert")) {
            if (mode === "network") throw new Error("offline");
            return fail("denied");
          }
          return ok(section === "Metering" ? DEFAULT_METERING_SETTINGS : DEFAULT_CHECKOUT_SETTINGS);
        });
        if (mode === "session")
          h.session.mockResolvedValue({ data: { session: null }, error: new Error("expired") });
        h.error.mockClear();
        save();
        await waitFor(() =>
          expect(h.error).toHaveBeenCalledWith(
            `admin.paywall.${section === "Metering" ? "metering" : "checkout"}SaveError`,
          ),
        );
        expect(screen.getByRole("button", { name: "admin.save" })).not.toBeDisabled();
        expect(h.success).not.toHaveBeenCalled();
      }
    },
  );
});

describe("metering impact preview", () => {
  it.each(["pl", "en"])("renders localized month and measured impact in %s", async (lang) => {
    h.lang = lang;
    mount();
    tab("Metering");
    await screen.findByText("admin.paywall.meteringImpactSummary");
    expect(screen.getByText(lang === "pl" ? "wrzesień 2026" : "September 2026")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    change("meteringMemberLimit", "7");
    await waitFor(() =>
      expect(h.rpc).toHaveBeenLastCalledWith("metering_impact_preview", {
        _proposed_member_limit: 7,
      }),
    );
  });
  it.each([null, [], [{ ...impact, total_members: 0, total_anon: 0 }]])(
    "reports an empty preview without fabricated statistics",
    async (rows) => {
      h.rpc.mockResolvedValue(ok(rows));
      mount();
      tab("Metering");
      await screen.findByText("admin.paywall.meteringImpactEmpty");
      expect(screen.queryByText("admin.paywall.meteringImpactSummary")).toBeNull();
    },
  );
  it("reports an RPC failure and handles numeric average data", async () => {
    h.rpc.mockResolvedValue(fail("forbidden"));
    mount();
    tab("Metering");
    await screen.findByText("admin.paywall.meteringImpactError");
    h.rpc.mockResolvedValue(ok([{ ...impact, avg_used: null }]));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["metering-impact-preview"] });
    });
    await screen.findByText("admin.paywall.meteringImpactSummary");
    expect(screen.getByText("0")).toBeTruthy();
  });
});

describe("metering overrides use the same persisted policy as the editors", () => {
  function overrides() {
    const rows = ["post", "page"].flatMap((entity_type) =>
      ["pl", "en", "slug", "id"].map((variant) => ({
        id: `${entity_type}-${variant}`,
        entity_type,
        entity_id: `${entity_type}-${variant}`,
        mode: "paid",
        metering_policy: "exempt",
      })),
    );
    db.setResponse("content_access", ok(rows));
    for (const [table, type] of [
      ["posts", "post"],
      ["pages", "page"],
    ])
      db.setResponse(
        table,
        ok(
          ["pl", "en", "slug", "id"].map((variant) => ({
            id: `${type}-${variant}`,
            title_pl: variant === "pl" ? `${type} Polski` : "",
            title_en: variant === "en" ? `${type} English` : "",
            slug: variant !== "id" ? `${type}-${variant}` : null,
          })),
        ),
      );
  }
  it("resolves post/page titles with language, slug and id fallbacks and links to the correct editor", async () => {
    overrides();
    mount();
    tab("Overrides");
    await screen.findByText("post Polski");
    expect(screen.getByRole("link", { name: "post Polski" })).toHaveAttribute(
      "href",
      "/admin/posts/post-pl",
    );
    expect(screen.getByRole("link", { name: "page English" })).toHaveAttribute(
      "href",
      "/admin/pages/page-en",
    );
    expect(screen.getByText("post-id")).toBeTruthy();
    expect(screen.getByText("page-id")).toBeTruthy();
    const read = db.chainsFor("content_access")[0];
    expect(read.argsOf("neq")).toEqual(["metering_policy", "inherit"]);
    expect(read.argsOf("limit")).toEqual([200]);
  });
  it.each(["success", "database", "network"])(
    "policy update handles %s and targets only the chosen row",
    async (mode) => {
      overrides();
      mount();
      tab("Overrides");
      await screen.findByText("post Polski");
      db.setResponse("content_access", (chain) => {
        if (chain.has("update")) {
          if (mode === "network") throw new Error("offline");
          return mode === "database" ? fail("denied") : ok(null);
        }
        return ok([]);
      });
      const row = screen.getByText("post Polski").closest("tr")!;
      fireEvent.change(within(row).getByRole("combobox"), { target: { value: "inherit" } });
      if (mode === "success") {
        await waitFor(() => expect(h.success).toHaveBeenCalledWith("admin.paywall.overrideSaved"));
        await screen.findByText("admin.paywall.overridesEmpty");
      } else {
        await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save"));
        expect(h.success).not.toHaveBeenCalled();
      }
      const write = db.chainsFor("content_access").find((c) => c.has("update"))!;
      expect(write.argsOf("eq")).toEqual(["id", "post-pl"]);
      expect(write.argsOf("update")).toEqual([{ metering_policy: "inherit" }]);
    },
  );
  it.each(["content_access", "posts", "pages"])(
    "does not misreport a failed %s read as empty data",
    async (table) => {
      overrides();
      db.setResponse(table, fail("denied"));
      mount();
      tab("Overrides");
      expect(await screen.findByRole("alert")).toHaveTextContent("admin.paywall.readError");
      expect(screen.queryByText("admin.paywall.overridesEmpty")).toBeNull();
    },
  );
  it.each([null, []])("handles absent override rows without querying titles", async (rows) => {
    db.setResponse("content_access", ok(rows));
    mount();
    tab("Overrides");
    await screen.findByText("admin.paywall.overridesEmpty");
    expect(db.chainsFor("posts")).toHaveLength(0);
    expect(db.chainsFor("pages")).toHaveLength(0);
  });
  it("preserves orphaned records when related titles are absent", async () => {
    overrides();
    db.setResponse("posts", ok(null));
    db.setResponse("pages", ok(null));
    mount();
    tab("Overrides");
    await screen.findByText("post-pl");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("page-pl")).toBeTruthy();
  });
});
