// /admin/paywall - test SKLEJENIA trasy z organizmami (S1/T3).
//
// HISTORIA PLIKU (R-11). Do fali 2 ten plik był testem charakteryzującym
// ekranu z 1149 linii: przypinał zachowanie sprzed wyniesienia organizmów
// (łącznie z defektami z DIAGNOZY - zapis pełnym wierszem, cena w groszach,
// stały kafel „Skonfigurowane", „włączony 5" przy braku wiersza meteringu,
// plik opisany jako „Strona", podwójny `AdminShell`). Po kroku 4 asercje, które
// przypinały TE defekty, są odwrócone świadomie - każda ma komentarz „ZMIANA
// ZAMIERZONA" z numerem defektu. Asercje zachowania, które miało zostać
// (stany ładowania/błędu/pustki, szkic po błędzie zapisu, podgląd wpływu,
// tytuły i linki wyjątków, podgląd parametrów sesji), są przeniesione 1:1
// na nowe klucze `adminPaywall.*`.
//
// GRANICE. Prawdziwe: router (harness `renderRoute` - `validateSearch`,
// `head()`, nawigacja), React Query, mutatory i queryOptions S1 (planQueries,
// meteringQueries, contentAccessQueries, useCheckoutSettings). Atrapowane:
// klient Supabase (łańcuch PostgREST), toasty, dialogi potwierdzeń, i18n
// (echo klucza z parametrami), Radix Select/Switch/Tabs/Dialog (happy-dom nie
// otwiera ich zdarzeniami wskaźnika) i przelicznik walut (bez sieci NBP).
import type { ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, type SupabaseFromStub, type SupabaseResult } from "@/test/supabase";
import { renderRoute, type RenderedRoute } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  lang: "pl",
  roles: ["admin"] as string[],
  rpc: vi.fn(),
  session: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/components/ui/tabs", async () =>
  (await import("@/test/reactStubs")).radixTabsStub(await import("react")),
);
// Okno Radiksa montuje treść w portalu i zarządza fokusem - tu liczy się
// TREŚĆ i to, czy okno jest otwarte.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  // Drzewo testu ma jedną trasę - linki do edytorów wpisów i Członkostwa
  // sprawdzamy po adresie, bez montowania tych tras.
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: { slug: string };
    children: ReactNode;
    className?: string;
  }) => (
    <a href={params ? to.replace("$slug", params.slug) : to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, info: h.info } }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));
vi.mock("@/lib/appDialogs", () => ({ confirmDialog: h.confirm }));
vi.mock("@/lib/tenant", () => ({ useCurrentTenantId: () => "tenant-1" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ roles: h.roles }) }));
vi.mock("@/lib/billing/displayCurrency", () => ({
  convertToDisplayCurrency: (cents: number) => ({ cents: Math.round(cents / 4), currency: "EUR" }),
}));
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
import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";

const db: SupabaseFromStub = Reflect.get(client, "db");

/** Token z mikrosekundami - przechodzi do zapytania jako surowy napis. */
const TOKEN = "2026-10-19T10:00:00.123456+00:00";
const PLAN_ID = "0f9e1c7a-3b2d-4c5e-8f60-1a2b3c4d5e6f";

const plan = {
  id: PLAN_ID,
  tenant_id: "tenant-1",
  name_pl: "Plan Polski",
  name_en: "English plan",
  description_pl: "Opis",
  description_en: "Description",
  price_cents: 1900,
  currency: "PLN",
  interval: "month" as const,
  active: true,
  for_sale: true,
  sort_order: 0,
  features_pl: ["Archiwum"],
  features_en: ["Archive"],
  badge_pl: "Popularny",
  badge_en: "Popular",
  highlighted: true,
  trial_days: 7,
  tier_key: "plus",
  volume_price_cents: null,
  volume_threshold_seats: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: TOKEN,
};
const meteringRow = { ...METERING_DEFAULTS, updated_at: TOKEN };
const checkoutRow = { ...DEFAULT_CHECKOUT_SETTINGS, updated_at: TOKEN };
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

type Chain = { has(method: string): boolean };

/** Odczyt tabeli albo zapis - jedna funkcja odpowiedzi per tabela. */
function respond(
  table: string,
  handlers: { read: () => SupabaseResult; write: (chain: Chain) => SupabaseResult },
) {
  db.setResponse(table, (chain) =>
    chain.has("update") || chain.has("insert") || chain.has("delete")
      ? handlers.write(chain)
      : handlers.read(),
  );
}

let qc: QueryClient;
let route: RenderedRoute;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.lang = "pl";
  h.roles = ["admin"];
  db.reset();
  db.setResponse("access_plans", ok([plan]));
  db.setResponse("metering_settings", ok(meteringRow));
  db.setResponse("checkout_settings", ok(checkoutRow));
  db.setResponse("content_access", { data: [], error: null, count: 0 });
  db.setResponse("user_subscriptions", { data: null, error: null, count: 0 });
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

async function mount(search = "") {
  route = await renderRoute({
    route: Route,
    path: "/admin/paywall",
    initialEntry: `/admin/paywall${search}`,
    queryClient: qc,
  });
  return route;
}
function tab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name: `adminPaywall.tabs.${name}` }));
}
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function toggle(label: string) {
  fireEvent.click(screen.getByRole("switch", { name: label }));
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function writes(table: string, method: "update" | "insert" | "delete") {
  return db.chainsFor(table).filter((c) => c.has(method));
}

describe("route contract (SPEC §2.6, AGENTS adminPageHead)", () => {
  it("publishes a section-specific head and lands on the plans tab by default", async () => {
    await mount();
    expect(route.meta()).toContainEqual({ title: "Paywall i plany | New European Strategies" });
    expect(route.meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(screen.getByRole("tab", { name: "adminPaywall.tabs.plans" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await screen.findByText("Plan Polski");
  });

  it.each([
    ["metering", "adminPaywall.metering.title"],
    ["overrides", "adminPaywall.overrides.title"],
    ["checkout", "adminPaywall.checkout.title"],
  ])("?tab=%s lands on that tab", async (id, heading) => {
    await mount(`?tab=${id}`);
    expect(screen.getByRole("tab", { name: `adminPaywall.tabs.${id}` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
  });

  it("an unknown tab falls back to plans instead of an error page", async () => {
    await mount("?tab=pricing");
    expect(route.search().tab).toBeUndefined();
    await screen.findByText("Plan Polski");
  });

  it("switching tabs writes ?tab= so a refresh or a hub link lands in the same place", async () => {
    await mount();
    tab("checkout");
    await waitFor(() => expect(route.search().tab).toBe("checkout"));
    expect(
      await screen.findByRole("heading", { name: "adminPaywall.checkout.title" }),
    ).toBeTruthy();
  });

  it("?plan=<id> opens the editor of that plan; closing clears the parameter", async () => {
    await mount(`?plan=${PLAN_ID.toUpperCase()}`);
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole("heading", {
        name: "adminPaywall.editor.titleEdit(name=Plan Polski)",
      }),
    ).toBeTruthy();
    expect(within(dialog).getByLabelText("adminPaywall.editor.namePl")).toHaveValue("Plan Polski");
    fireEvent.click(within(dialog).getByRole("button", { name: "adminPaywall.editor.cancel" }));
    await waitFor(() => expect(route.search().plan).toBeUndefined());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("?plan= with an unknown id says the plan is gone instead of showing an empty form", async () => {
    await mount("?plan=11111111-2222-4333-8444-555555555555");
    expect(await screen.findByText("adminPaywall.editor.notFound")).toBeTruthy();
    expect(screen.queryByLabelText("adminPaywall.editor.namePl")).toBeNull();
  });

  it("ZMIANA ZAMIERZONA (DIAGNOZA #9): no second admin shell inside the /admin layout", async () => {
    // Charakteryzacja przypinała `<main>` z owijki `AdminShell` - trasa nie
    // renderuje go wcale, `<main id="main-content">` daje layout `/admin`.
    const { container } = await mount();
    await screen.findByText("Plan Polski");
    expect(container.querySelectorAll("main")).toHaveLength(0);
  });
});

describe("plan catalogue", () => {
  it("renders plans from the shared all-plans query with translated cycle, sale and status", async () => {
    await mount();
    await screen.findByText("Plan Polski");
    expect(screen.getByText("English plan")).toBeTruthy();
    // ZMIANA ZAMIERZONA (DIAGNOZA #4): cykl przetłumaczony, nie surowy enum.
    expect(screen.getByText("adminPaywall.interval.month")).toBeTruthy();
    expect(screen.getByText("adminPaywall.plans.forSale")).toBeTruthy();
    expect(screen.getByText("adminPaywall.plans.active")).toBeTruthy();
    expect(screen.getByText(/^adminPaywall\.plans\.eurApprox/)).toBeTruthy();
    const read = db.chainsFor("access_plans")[0];
    expect(read.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("marks a withdrawn plan and a plan on sale without a checkout catalogue pair", async () => {
    db.setResponse(
      "access_plans",
      ok([
        { ...plan, id: "a", name_pl: "Wycofany", for_sale: false },
        { ...plan, id: "b", name_pl: "Bez pary", tier_key: null },
        { ...plan, id: "c", name_pl: "Jednorazowy", tier_key: null, interval: "one_time" },
      ]),
    );
    await mount();
    await screen.findByText("Wycofany");
    expect(screen.getByText("adminPaywall.plans.withdrawn")).toBeTruthy();
    const missing = screen.getAllByText("adminPaywall.plans.noCatalogPair");
    expect(missing).toHaveLength(1);
    expect(missing[0].closest("tr")).toHaveTextContent("Bez pary");
  });

  it("distinguishes loading and failure from an empty plan catalogue", async () => {
    let resolve!: (data: SupabaseResult) => void;
    db.setResponse(
      "access_plans",
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await mount();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("common.loading");
    expect(screen.queryByText("adminPaywall.plans.empty")).toBeNull();
    await waitFor(() => expect(resolve).toBeTypeOf("function"));
    await act(async () => {
      resolve(fail("denied"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("adminPaywall.plans.readError");
    expect(screen.queryByText("adminPaywall.plans.empty")).toBeNull();
  });

  it("an empty catalogue says so", async () => {
    db.setResponse("access_plans", ok([]));
    await mount();
    expect(await screen.findByText("adminPaywall.plans.empty")).toBeTruthy();
  });

  it("renders English-only and unhighlighted plans without the PLN conversion", async () => {
    db.setResponse(
      "access_plans",
      ok([{ ...plan, name_pl: "", currency: "EUR", highlighted: false, active: false }]),
    );
    await mount();
    await screen.findByText("English plan");
    expect(screen.queryByText(/eurApprox/)).toBeNull();
    expect(screen.queryByText("adminPaywall.plans.highlighted")).toBeNull();
    expect(screen.getByText("adminPaywall.plans.inactive")).toBeTruthy();
  });
});

describe("plan editor (S1 def. 3)", () => {
  async function openEditor() {
    await mount();
    await screen.findByText("Plan Polski");
    click("adminPaywall.plans.editLabel(name=Plan Polski)");
    await waitFor(() => expect(route.search().plan).toBe(PLAN_ID));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText("adminPaywall.editor.namePl");
    return dialog;
  }

  it("cancel discards the draft without writing", async () => {
    const dialog = await openEditor();
    change("adminPaywall.editor.namePl", "Unsaved");
    fireEvent.click(within(dialog).getByRole("button", { name: "adminPaywall.editor.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes("access_plans", "update")).toHaveLength(0);
    expect(screen.getByText("Plan Polski")).toBeTruthy();
  });

  it("saves ONLY the changed columns with the raw updated_at token - never tier_key or identity", async () => {
    respond("access_plans", {
      read: () => ok([plan]),
      write: () => ok([{ ...plan, name_pl: "Nowy" }]),
    });
    await openEditor();
    change("adminPaywall.editor.namePl", "Nowy");
    // ZMIANA ZAMIERZONA (DIAGNOZA #4): cena w jednostkach głównych, nie w groszach.
    change("adminPaywall.editor.price", "32,50");
    change("adminPaywall.editor.currency", "EUR");
    change("adminPaywall.editor.interval", "year");
    change("adminPaywall.editor.featuresPl", "  Alfa \n\n Beta ");
    toggle("adminPaywall.editor.highlighted");
    click("adminPaywall.editor.save");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.editor.saved"));
    const [write] = writes("access_plans", "update");
    expect(write.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", PLAN_ID],
      ["updated_at", TOKEN],
    ]);
    expect(write.argsOf("update")?.[0]).toEqual({
      name_pl: "Nowy",
      price_cents: 3250,
      currency: "EUR",
      interval: "year",
      features_pl: ["Alfa", "Beta"],
      highlighted: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the „On sale” switch is visible, explained by a tooltip text and saved as a one-column patch", async () => {
    respond("access_plans", {
      read: () => ok([plan]),
      write: () => ok([{ ...plan, for_sale: false }]),
    });
    await openEditor();
    const forSale = screen.getByRole("switch", { name: "adminPaywall.editor.forSale" });
    expect(forSale).toBeChecked();
    const hintId = forSale.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)).toHaveTextContent("adminPaywall.editor.forSaleHint");
    toggle("adminPaywall.editor.forSale");
    click("adminPaywall.editor.save");
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(writes("access_plans", "update")[0].argsOf("update")?.[0]).toEqual({ for_sale: false });
  });

  it("tier_key is read-only with a link to the membership mapping tab", async () => {
    const dialog = await openEditor();
    expect(within(dialog).getByText("plus")).toBeTruthy();
    expect(
      within(dialog).getByRole("link", { name: /admin\.linkedSource\.manage/ }),
    ).toHaveAttribute("href", "/admin/membership?tab=mapping");
  });

  it("warns inside the editor about a missing checkout catalogue pair, from the DRAFT", async () => {
    // Plan „plus" miesięczny nie ma pozycji w `BILLING_CATALOG` - kasa skończy
    // zakup błędem `plan_price_missing`. Wycofanie ze sprzedaży w szkicu
    // zdejmuje ostrzeżenie od razu, przed zapisem.
    const dialog = await openEditor();
    expect(within(dialog).getByRole("note")).toHaveTextContent("adminPaywall.plans.noCatalogPair");

    toggle("adminPaywall.editor.forSale");

    await waitFor(() =>
      expect(within(dialog).queryByText("adminPaywall.plans.noCatalogPair")).toBeNull(),
    );
  });

  it("a stale token raises the conflict toast; the draft survives and „Load current” rebases it", async () => {
    let reads = 0;
    const fresh = {
      ...plan,
      tier_key: "pro",
      name_en: "Renamed elsewhere",
      updated_at: "2026-10-19T11:00:00.654321+00:00",
    };
    respond("access_plans", {
      read: () => ok([reads++ === 0 ? plan : fresh]),
      write: () => ok([]),
    });
    await openEditor();
    change("adminPaywall.editor.namePl", "Mój szkic");
    click("adminPaywall.editor.save");
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminPaywall.sync.staleWrite", expect.anything()),
    );
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.getByLabelText("adminPaywall.editor.namePl")).toHaveValue("Mój szkic");
    const options = h.error.mock.calls[0][1] as {
      description: string;
      action: { label: string; onClick: () => void };
    };
    expect(options.description).toBe("adminPaywall.sync.staleWriteHint");
    expect(options.action.label).toBe("adminPaywall.sync.reload");
    await act(async () => options.action.onClick());
    await waitFor(() => expect(h.info).toHaveBeenCalledWith("adminPaywall.sync.reloaded"));
    // Cudza zmiana pola, którego admin nie dotykał, przychodzi z serwera;
    // pole zmienione przez admina zostaje jego.
    expect(screen.getByLabelText("adminPaywall.editor.nameEn")).toHaveValue("Renamed elsewhere");
    expect(screen.getByLabelText("adminPaywall.editor.namePl")).toHaveValue("Mój szkic");
    respond("access_plans", { read: () => ok([fresh]), write: () => ok([fresh]) });
    click("adminPaywall.editor.save");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.editor.saved"));
    const retry = writes("access_plans", "update").at(-1)!;
    expect(retry.calls.find((c) => c.method === "eq" && c.args[0] === "updated_at")?.args).toEqual([
      "updated_at",
      fresh.updated_at,
    ]);
    expect(retry.argsOf("update")?.[0]).toEqual({ name_pl: "Mój szkic" });
  });

  it.each(["database", "network"])(
    "other failures go through toastError(save) and keep the draft (%s)",
    async (mode) => {
      respond("access_plans", {
        read: () => ok([plan]),
        write: () => {
          if (mode === "network") throw new Error("offline");
          return fail("denied", "42501");
        },
      });
      await openEditor();
      change("adminPaywall.editor.namePl", "Keep me");
      click("adminPaywall.editor.save");
      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save"));
      expect(screen.getByLabelText("adminPaywall.editor.namePl")).toHaveValue("Keep me");
      expect(screen.getByRole("button", { name: "adminPaywall.editor.save" })).not.toBeDisabled();
      expect(h.success).not.toHaveBeenCalled();
    },
  );

  it("an ambiguous price blocks the save with an inline message", async () => {
    await openEditor();
    change("adminPaywall.editor.price", "1.299");
    click("adminPaywall.editor.save");
    expect(await screen.findByRole("alert")).toHaveTextContent("adminPaywall.editor.priceInvalid");
    expect(writes("access_plans", "update")).toHaveLength(0);
  });

  it("inserts a new plan (paywall columns only, default 19,00 PLN monthly, on sale)", async () => {
    respond("access_plans", { read: () => ok([]), write: () => ok({ ...plan, id: "new" }) });
    await mount();
    await screen.findByText("adminPaywall.plans.empty");
    click("adminPaywall.plans.add");
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "adminPaywall.editor.titleNew" }),
    ).toBeTruthy();
    change("adminPaywall.editor.namePl", "Nowy plan");
    click("adminPaywall.editor.create");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.editor.created"));
    const insert = writes("access_plans", "insert")[0].argsOf("insert")?.[0] as Record<
      string,
      unknown
    >;
    expect(insert).toMatchObject({
      name_pl: "Nowy plan",
      price_cents: 1900,
      currency: "PLN",
      interval: "month",
      active: true,
      for_sale: true,
    });
    for (const column of ["id", "tenant_id", "tier_key", "updated_at"]) {
      expect(insert).not.toHaveProperty(column);
    }
  });

  it("switching off „Active” on a plan with subscriptions needs a confirmation that counts them", async () => {
    db.setResponse("user_subscriptions", { data: null, error: null, count: 3 });
    h.confirm.mockResolvedValueOnce(false);
    await openEditor();
    toggle("adminPaywall.editor.active");
    await waitFor(() =>
      expect(h.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "adminPaywall.editor.activeOffTitle",
          description: "adminPaywall.editor.activeOffDescription(count=3)",
          destructive: true,
        }),
      ),
    );
    expect(screen.getByRole("switch", { name: "adminPaywall.editor.active" })).toBeChecked();
    h.confirm.mockResolvedValueOnce(true);
    toggle("adminPaywall.editor.active");
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "adminPaywall.editor.active" })).not.toBeChecked(),
    );
  });
});

describe("plan deletion (S1 def. 4, D-S1-05)", () => {
  const deleteLabel = "adminPaywall.plans.deleteLabel(name=Plan Polski)";

  it("an editor sees the delete action disabled with the reason", async () => {
    h.roles = ["editor"];
    await mount();
    await screen.findByText("Plan Polski");
    const button = screen.getByRole("button", { name: deleteLabel });
    expect(button).toBeDisabled();
    const wrapper = button.parentElement!;
    expect(document.getElementById(wrapper.getAttribute("aria-describedby")!)).toHaveTextContent(
      "adminPaywall.plans.deleteAdminOnly",
    );
  });

  it("a super_admin without the admin role cannot delete either (SQL would refuse)", async () => {
    h.roles = ["super_admin"];
    await mount();
    await screen.findByText("Plan Polski");
    expect(screen.getByRole("button", { name: deleteLabel })).toBeDisabled();
  });

  it.each(["cancel", "success"])(
    "an admin deletes a plan without subscriptions after a confirmation (%s)",
    async (mode) => {
      h.confirm.mockResolvedValue(mode === "success");
      respond("access_plans", { read: () => ok([plan]), write: () => ok([{ id: PLAN_ID }]) });
      await mount();
      await screen.findByText("Plan Polski");
      click(deleteLabel);
      await waitFor(() =>
        expect(h.confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "adminPaywall.plans.deleteTitle(name=Plan Polski)",
            destructive: true,
          }),
        ),
      );
      if (mode === "cancel") {
        expect(writes("access_plans", "delete")).toHaveLength(0);
        return;
      }
      await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.plans.deleted"));
      expect(writes("access_plans", "delete")[0].argsOf("eq")).toEqual(["id", PLAN_ID]);
      expect(db.lastChain("user_subscriptions")?.argsOf("eq")).toEqual(["plan_id", PLAN_ID]);
    },
  );

  it("a plan with subscriptions is never deleted - the dialog offers withdrawing it from sale", async () => {
    db.setResponse("user_subscriptions", { data: null, error: null, count: 4 });
    respond("access_plans", {
      read: () => ok([plan]),
      write: () => ok([{ ...plan, for_sale: false }]),
    });
    await mount();
    await screen.findByText("Plan Polski");
    click(deleteLabel);
    await waitFor(() =>
      expect(h.confirm).toHaveBeenCalledWith({
        title: "adminPaywall.plans.deleteBlockedTitle(name=Plan Polski)",
        description: "adminPaywall.plans.deleteBlockedDescription(count=4)",
        confirmLabel: "adminPaywall.plans.withdraw",
      }),
    );
    await waitFor(() =>
      expect(h.success).toHaveBeenCalledWith("adminPaywall.plans.withdrawnToast"),
    );
    expect(writes("access_plans", "delete")).toHaveLength(0);
    const [update] = writes("access_plans", "update");
    expect(update.argsOf("update")?.[0]).toEqual({ for_sale: false });
  });

  it("a failed subscription count holds the deletion", async () => {
    db.setResponse("user_subscriptions", fail("denied"));
    await mount();
    await screen.findByText("Plan Polski");
    click(deleteLabel);
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("adminPaywall.plans.countError"));
    expect(h.confirm).not.toHaveBeenCalled();
    expect(writes("access_plans", "delete")).toHaveLength(0);
  });
});

describe("KPI strip reads the server state (DIAGNOZA #5)", () => {
  function tile(label: string) {
    return screen.getByText(`adminPaywall.kpi.${label}`).parentElement!.textContent;
  }

  it("counts plans, active plans, plans on sale and currencies", async () => {
    db.setResponse(
      "access_plans",
      ok([
        plan,
        { ...plan, id: "b", name_pl: "Drugi", currency: "eur", active: false, for_sale: false },
      ]),
    );
    await mount();
    await screen.findByText("Drugi");
    expect(tile("plans")).toContain("2");
    expect(tile("active")).toContain("1");
    expect(tile("forSale")).toContain("1");
    expect(tile("currencies")).toContain("PLN / EUR");
  });

  it.each([
    ["on with its limit", ok(meteringRow), "adminPaywall.kpi.meteringOn(limit=5)"],
    ["off", ok({ ...meteringRow, enabled: false }), "adminPaywall.kpi.meteringOff"],
    ["a missing row", ok(null), "adminPaywall.kpi.meteringMissing"],
    ["an unreadable row", fail("denied"), "adminPaywall.kpi.meteringUnknown"],
  ])(
    "ZMIANA ZAMIERZONA: the quota tile reports %s instead of a constant",
    async (_, result, text) => {
      db.setResponse("metering_settings", result);
      await mount();
      await waitFor(() => expect(tile("metering")).toContain(text));
    },
  );
});

describe("article quota settings (S1 def. 14)", () => {
  it("ZMIANA ZAMIERZONA: a missing row is „off - not configured”, never an editable „on 5”", async () => {
    db.setResponse("metering_settings", ok(null));
    await mount("?tab=metering");
    expect(await screen.findByText("adminPaywall.metering.missingTitle")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "adminPaywall.metering.enabled" })).toBeNull();
    expect(screen.queryByLabelText("adminPaywall.metering.memberLimit")).toBeNull();
  });

  it("„Switch on with defaults” proposes METERING_DEFAULTS and only the save INSERTS the row", async () => {
    respond("metering_settings", { read: () => ok(null), write: () => ok(meteringRow) });
    await mount("?tab=metering");
    await screen.findByText("adminPaywall.metering.missingTitle");
    click("adminPaywall.metering.enableDefaults");
    expect(screen.getByLabelText("adminPaywall.metering.memberLimit")).toHaveValue(
      METERING_DEFAULTS.member_monthly_limit,
    );
    expect(screen.getByText("adminPaywall.sync.serverMissing")).toBeTruthy();
    expect(writes("metering_settings", "insert")).toHaveLength(0);
    click("adminPaywall.metering.save");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.metering.saved"));
    expect(writes("metering_settings", "insert")[0].argsOf("insert")?.[0]).toMatchObject({
      enabled: METERING_DEFAULTS.enabled,
      member_monthly_limit: METERING_DEFAULTS.member_monthly_limit,
      tenant_id: "tenant-1",
      updated_by: "staff",
    });
  });

  it("saves toggles and clamps limits with a CAS update on the row token", async () => {
    respond("metering_settings", { read: () => ok(meteringRow), write: () => ok([meteringRow]) });
    await mount("?tab=metering");
    await screen.findByLabelText("adminPaywall.metering.memberLimit");
    change("adminPaywall.metering.memberLimit", "1200");
    change("adminPaywall.metering.anonLimit", "-5");
    for (const key of ["meterPaid", "meterMembers", "showCounter"]) {
      toggle(`adminPaywall.metering.${key}`);
    }
    click("adminPaywall.metering.save");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.metering.saved"));
    const [write] = writes("metering_settings", "update");
    expect(write.argsOf("eq")).toEqual(["updated_at", TOKEN]);
    expect(write.argsOf("update")?.[0]).toEqual({
      enabled: METERING_DEFAULTS.enabled,
      member_monthly_limit: 1000,
      anon_monthly_limit: 0,
      meter_paid: !METERING_DEFAULTS.meter_paid,
      meter_members: !METERING_DEFAULTS.meter_members,
      show_counter: !METERING_DEFAULTS.show_counter,
      updated_by: "staff",
    });
  });

  it("a stale token shows the shared conflict toast, not the generic save error", async () => {
    respond("metering_settings", { read: () => ok(meteringRow), write: () => ok([]) });
    await mount("?tab=metering");
    await screen.findByLabelText("adminPaywall.metering.memberLimit");
    click("adminPaywall.metering.save");
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith("adminPaywall.sync.staleWrite", expect.anything()),
    );
    expect(h.error).not.toHaveBeenCalledWith("adminPaywall.metering.saveError");
  });

  it("disabled metering disables dependent controls and avoids the impact RPC", async () => {
    db.setResponse("metering_settings", ok({ ...meteringRow, enabled: false }));
    await mount("?tab=metering");
    await screen.findByText("adminPaywall.metering.impact.disabled");
    expect(screen.getByLabelText("adminPaywall.metering.memberLimit")).toBeDisabled();
    expect(h.rpc).not.toHaveBeenCalled();
    toggle("adminPaywall.metering.enabled");
    change("adminPaywall.metering.memberLimit", "");
    expect(screen.getByLabelText("adminPaywall.metering.memberLimit")).toHaveValue(0);
    await waitFor(() => expect(h.rpc).toHaveBeenCalled());
  });

  it("a read failure is not editable defaults", async () => {
    db.setResponse("metering_settings", fail("denied"));
    await mount("?tab=metering");
    expect(await screen.findByRole("alert")).toHaveTextContent("adminPaywall.metering.readError");
    expect(screen.queryByRole("button", { name: "adminPaywall.metering.save" })).toBeNull();
  });

  it.each(["database", "network"])(
    "a %s write failure releases the button and reports it",
    async (mode) => {
      respond("metering_settings", {
        read: () => ok(meteringRow),
        write: () => {
          if (mode === "network") throw new Error("offline");
          return fail("denied");
        },
      });
      await mount("?tab=metering");
      await screen.findByLabelText("adminPaywall.metering.memberLimit");
      click("adminPaywall.metering.save");
      await waitFor(() => expect(h.error).toHaveBeenCalledWith("adminPaywall.metering.saveError"));
      expect(screen.getByRole("button", { name: "adminPaywall.metering.save" })).not.toBeDisabled();
      expect(h.success).not.toHaveBeenCalled();
    },
  );
});

describe("metering impact preview", () => {
  it.each(["pl", "en"])(
    "renders the localized month and the measured impact in %s",
    async (lang) => {
      h.lang = lang;
      await mount("?tab=metering");
      await screen.findByText(/^adminPaywall\.metering\.impact\.summary/);
      expect(screen.getByText(lang === "pl" ? "wrzesień 2026" : "September 2026")).toBeTruthy();
      expect(screen.getByText("12")).toBeTruthy();
      change("adminPaywall.metering.memberLimit", "7");
      await waitFor(() =>
        expect(h.rpc).toHaveBeenLastCalledWith("metering_impact_preview", {
          _proposed_member_limit: 7,
        }),
      );
    },
  );

  it.each([null, [], [{ ...impact, total_members: 0, total_anon: 0 }]])(
    "reports an empty preview without fabricated statistics",
    async (rows) => {
      h.rpc.mockResolvedValue(ok(rows));
      await mount("?tab=metering");
      await screen.findByText("adminPaywall.metering.impact.empty");
      expect(screen.queryByText(/impact\.summary/)).toBeNull();
    },
  );

  it("reports an RPC failure and survives a null average", async () => {
    h.rpc.mockResolvedValue(fail("forbidden"));
    await mount("?tab=metering");
    await screen.findByText("adminPaywall.metering.impact.error");
    h.rpc.mockResolvedValue(ok([{ ...impact, avg_used: null }]));
    await act(async () => {
      await qc.invalidateQueries();
    });
    await screen.findByText(/^adminPaywall\.metering\.impact\.summary/);
    expect(screen.getByText("0")).toBeTruthy();
  });
});

describe("checkout settings", () => {
  it("previews the session parameters from the shared serializer and saves with the row token", async () => {
    respond("checkout_settings", { read: () => ok(checkoutRow), write: () => ok([checkoutRow]) });
    await mount("?tab=checkout");
    await screen.findByText("adminPaywall.checkout.plane.managed");
    expect(screen.getByText(/^adminPaywall\.checkout\.plane\.params\(params=/)).toBeTruthy();
    for (const key of ["allowPromo", "automaticTax", "taxIdCollection", "invoiceCreation"]) {
      toggle(`adminPaywall.checkout.${key}`);
    }
    change("adminPaywall.checkout.addressCollection", "required");
    expect(screen.getByText("adminPaywall.checkout.plane.merchant")).toBeTruthy();
    click("adminPaywall.checkout.save");
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.checkout.saved"));
    const [write] = writes("checkout_settings", "update");
    expect(write.argsOf("eq")).toEqual(["updated_at", TOKEN]);
    expect(write.argsOf("update")?.[0]).toEqual({
      allow_promotion_codes: !DEFAULT_CHECKOUT_SETTINGS.allow_promotion_codes,
      automatic_tax: !DEFAULT_CHECKOUT_SETTINGS.automatic_tax,
      tax_id_collection: !DEFAULT_CHECKOUT_SETTINGS.tax_id_collection,
      invoice_creation: !DEFAULT_CHECKOUT_SETTINGS.invoice_creation,
      billing_address_collection: "required",
      // I9a: karta zapisuje też widoczne okno porzucenia kasy - wiersz bez
      // kolumny pokazuje (i zapisuje) domyślne bazy, bez przycinania.
      abandon_after_minutes: 1440,
      updated_by: "staff",
    });
  });

  it("ZMIANA ZAMIERZONA (DIAGNOZA #8): the save also refreshes the monetization dashboard", async () => {
    respond("checkout_settings", { read: () => ok(checkoutRow), write: () => ok([checkoutRow]) });
    await mount("?tab=checkout");
    await screen.findByText("adminPaywall.checkout.plane.managed");
    const spy = vi.spyOn(qc, "invalidateQueries");
    click("adminPaywall.checkout.save");
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith({ queryKey: ["admin", "monetization"] });
  });

  it("a read failure is not editable defaults", async () => {
    db.setResponse("checkout_settings", fail("denied"));
    await mount("?tab=checkout");
    expect(await screen.findByRole("alert")).toHaveTextContent("adminPaywall.checkout.readError");
    expect(screen.queryByRole("button", { name: "adminPaywall.checkout.save" })).toBeNull();
  });

  it("a failed write releases the button and reports it", async () => {
    respond("checkout_settings", { read: () => ok(checkoutRow), write: () => fail("denied") });
    await mount("?tab=checkout");
    await screen.findByText("adminPaywall.checkout.plane.managed");
    click("adminPaywall.checkout.save");
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("adminPaywall.checkout.saveError"));
    expect(screen.getByRole("button", { name: "adminPaywall.checkout.save" })).not.toBeDisabled();
  });
});

describe("metering overrides share the content-access writer (DIAGNOZA #6)", () => {
  function overrides(total?: number) {
    const rows = (["post", "page", "media"] as const).flatMap((entity_type) =>
      ["pl", "en", "slug", "id"].map((variant) => ({
        id: `${entity_type}-${variant}`,
        entity_type,
        entity_id: `${entity_type}-${variant}`,
        mode: "paid",
        metering_policy: "exempt",
        updated_at: TOKEN,
      })),
    );
    db.setResponse("content_access", { data: rows, error: null, count: total ?? rows.length });
    for (const [table, type] of [
      ["posts", "post"],
      ["pages", "page"],
    ]) {
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
    db.setResponse(
      "media",
      ok([{ id: "media-pl", alt_text: "Raport PDF", filename: "raport.pdf" }]),
    );
  }

  it("resolves titles with language, slug and id fallbacks and links to the right editor", async () => {
    overrides();
    await mount("?tab=overrides");
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
    // ZMIANA ZAMIERZONA (DIAGNOZA #7): stronicowanie zamiast cichego `limit(200)`.
    expect(read.has("limit")).toBe(false);
    expect(read.argsOf("range")).toEqual([0, 49]);
  });

  it("ZMIANA ZAMIERZONA (DIAGNOZA #7): a media file has its own label, not „page”", async () => {
    overrides();
    await mount("?tab=overrides");
    const row = (await screen.findByText("Raport PDF")).closest("tr")!;
    expect(within(row).getByText("adminPaywall.overrides.entity.media")).toBeTruthy();
    expect(within(row).queryByRole("link")).toBeNull();
  });

  it.each(["success", "conflict", "database"])(
    "a policy update (%s) writes only metering_policy with the row token",
    async (mode) => {
      overrides();
      await mount("?tab=overrides");
      await screen.findByText("post Polski");
      db.setResponse("content_access", (chain) => {
        if (chain.has("update")) {
          if (mode === "database") return fail("denied", "42501");
          return ok(mode === "conflict" ? [] : [{ id: "post-pl", updated_at: TOKEN }]);
        }
        return { data: [], error: null, count: 0 };
      });
      change("adminPaywall.overrides.policyLabel(title=post Polski)", "inherit");
      if (mode === "success") {
        await waitFor(() => expect(h.success).toHaveBeenCalledWith("adminPaywall.overrides.saved"));
        await screen.findByText("adminPaywall.overrides.empty");
      } else if (mode === "conflict") {
        await waitFor(() =>
          expect(h.error).toHaveBeenCalledWith("adminPaywall.sync.staleWrite", expect.anything()),
        );
      } else {
        await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "save"));
      }
      const write = writes("content_access", "update")[0];
      expect(write.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
        ["entity_type", "post"],
        ["entity_id", "post-pl"],
        ["updated_at", TOKEN],
      ]);
      expect(write.argsOf("update")).toEqual([{ metering_policy: "inherit" }]);
    },
  );

  it.each(["content_access", "posts", "pages"])(
    "does not misreport a failed %s read as empty data",
    async (table) => {
      overrides();
      db.setResponse(table, fail("denied"));
      await mount("?tab=overrides");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "adminPaywall.overrides.readError",
      );
      expect(screen.queryByText("adminPaywall.overrides.empty")).toBeNull();
    },
  );

  it("an empty list queries no titles", async () => {
    await mount("?tab=overrides");
    await screen.findByText("adminPaywall.overrides.empty");
    expect(db.chainsFor("posts")).toHaveLength(0);
    expect(db.chainsFor("pages")).toHaveLength(0);
  });

  it("pages through exceptions beyond the first page", async () => {
    overrides(120);
    await mount("?tab=overrides");
    await screen.findByText("post Polski");
    expect(
      screen.getByText("adminPaywall.overrides.pageInfo(count=120,page=1,pages=3)"),
    ).toBeTruthy();
    click("adminPaywall.overrides.next");
    await waitFor(() => expect(db.lastChain("content_access")?.argsOf("range")).toEqual([50, 99]));
    expect(
      await screen.findByText("adminPaywall.overrides.pageInfo(count=120,page=2,pages=3)"),
    ).toBeTruthy();
  });

  it("searches by title - the phrase never reaches the PostgREST filter", async () => {
    overrides();
    await mount("?tab=overrides");
    await screen.findByText("post Polski");
    change("adminPaywall.overrides.search", "english");
    await waitFor(() => expect(screen.queryByText("post Polski")).toBeNull(), { timeout: 2000 });
    expect(screen.getByText("post English")).toBeTruthy();
    expect(screen.getByText("page English")).toBeTruthy();
    for (const chain of db.chainsFor("content_access")) {
      expect(JSON.stringify(chain.calls)).not.toContain("english");
    }
  });
});
