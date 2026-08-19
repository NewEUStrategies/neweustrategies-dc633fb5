// Panel diagnostyki płatności - 0 z 22 funkcji pokrytych do 18.08.2026,
// przy 372 liniach.
//
// Razem z warstwą serwerową (`diagnostics.server.ts`, test obok) to narzędzie
// odpowiadające na jedno pytanie: „dlaczego zakup nie nadał uprawnień".
// Kontrola świecąca zielono przy zepsutej integracji jest GORSZA niż jej brak,
// bo kieruje operatora w złe miejsce - dlatego panel musi pokazywać stan
// Z SERWERA, bez własnych domysłów.
//
// Cztery rzeczy pilnowane najmocniej:
//
//   1. STAN KONTROLI POCHODZI Z RAPORTU, nie z komponentu. Panel mapuje
//      identyfikator kontroli na tłumaczenie, a NIEZNANEJ kontroli pokazuje
//      nazwę techniczną, zamiast ją ukryć - nowa kontrola po stronie serwera
//      nie może zniknąć z listy tylko dlatego, że nikt nie dopisał klucza.
//   2. TEST CHECKOUTU NIE URUCHAMIA SIĘ NA CUDZYM ŚRODOWISKU. Nakładka
//      płatności działa w środowisku BUDOWANIA aplikacji, więc wybranie
//      w panelu innego środowiska musi zablokować test, a nie otworzyć
//      nakładkę mówiącą o czymś innym niż raport.
//   3. BRAKUJĄCA CENA W KATALOGU JEST WIDOCZNA PRZY PRZYCISKU TESTU - to
//      najczęstsza przyczyna „zakup nie działa".
//   4. SYNCHRONIZACJA KUPONÓW raportuje trzy liczby (utworzone / istniejące /
//      nieudane) i odświeża raport.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub } from "@/test/billing/fixtures";

interface DiagnosticsShape {
  environment: string;
  checks: Array<{ id: string; state: "ok" | "warn" | "error"; detail: string }>;
  catalog: Array<{ priceId: string; providerPriceId: string | null }>;
  coupons: Array<Record<string, unknown>>;
  webhooks: {
    total: number;
    failed: number;
    lastEventAt: string | null;
    avgDurationMs: number | null;
  };
  destinations: Array<Record<string, unknown>>;
}

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  user: { current: { id: "user-admin" } as { id: string } | null },
  clientEnv: { current: "sandbox" as "sandbox" | "live" },
  diag: { current: null as DiagnosticsShape | null },
  diagThrows: { current: false },
  plans: { current: [] as Array<Record<string, unknown>> },
  sync: vi.fn(),
  openPlanCheckout: vi.fn(),
  checkoutLoading: { current: false },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  dialogSecrets: [] as Array<string | null>,
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/lib/i18n-admin-billing", () => ({}));

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSelectStub(react);
});

vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => h.clientEnv.current }));

vi.mock("@/hooks/useCheckout", () => ({
  useCheckout: () => ({
    openPlanCheckout: (arg: unknown) => h.openPlanCheckout(arg),
    loading: h.checkoutLoading.current,
  }),
}));

// Nakładka płatności jest tu atrapą wystawiającą JEDEN fakt: czy panel podał
// jej sekret sesji. Sama nakładka ma własne testy w `components/checkout`.
vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: (props: { clientSecret: string | null }) => {
    h.dialogSecrets.push(props.clientSecret);
    return null;
  },
}));

vi.mock("@/lib/billing/diagnostics.functions", () => ({
  getPaymentsDiagnostics: () =>
    h.diagThrows.current ? Promise.reject(new Error("forbidden")) : Promise.resolve(h.diag.current),
  syncCouponsToProvider: (arg: unknown) => h.sync(arg),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.chain!.from(table) },
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { AdminPaymentsDiagnosticsPanel } from "@/components/admin/billing/AdminPaymentsDiagnosticsPanel";

function diagnostics(overrides: Partial<DiagnosticsShape> = {}): DiagnosticsShape {
  return {
    environment: "sandbox",
    checks: [
      { id: "gateway_configured", state: "ok", detail: "sandbox" },
      { id: "webhook_endpoint", state: "ok", detail: "https://example.test/hook" },
      { id: "catalog", state: "ok", detail: "10/10" },
      { id: "webhook_failures", state: "ok", detail: "0/12" },
      { id: "webhook_traffic", state: "ok", detail: "2026-08-18T10:00:00.000Z" },
    ],
    catalog: [{ priceId: "plus_monthly", providerPriceId: "price_1" }],
    coupons: [],
    webhooks: { total: 12, failed: 0, lastEventAt: "2026-08-18T10:00:00.000Z", avgDurationMs: 88 },
    destinations: [],
    ...overrides,
  };
}

const render = () => renderWithQueryClient(<AdminPaymentsDiagnosticsPanel />);
const envSelect = () => screen.getAllByRole("combobox")[0];
const planSelect = () => screen.getAllByRole("combobox")[1];
const awaitReport = () =>
  waitFor(() => expect(screen.getByText("adminBilling.checks.gateway")).toBeTruthy());

beforeEach(() => {
  h.lang.current = "pl";
  h.user.current = { id: "user-admin" };
  h.clientEnv.current = "sandbox";
  h.diag.current = diagnostics();
  h.diagThrows.current = false;
  h.plans.current = [
    { id: "plan-1", name_pl: "Członek", name_en: "Member", tier_key: "member", interval: "month" },
  ];
  h.sync.mockReset().mockResolvedValue({ created: 1, existing: 2, failed: 0 });
  h.openPlanCheckout
    .mockReset()
    .mockResolvedValue({ ok: true, session: { clientSecret: "cs_secret_syntetyczny" } });
  h.checkoutLoading.current = false;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.dialogSecrets.length = 0;
  h.chain = supabaseFromStub();
  h.chain.setResponse("access_plans", () => ok(h.plans.current));
});

describe("AdminPaymentsDiagnosticsPanel - raport kontroli", () => {
  it("pokazuje pięć kontroli z ich detalami z serwera", async () => {
    render();

    await awaitReport();
    expect(screen.getByText("adminBilling.checks.endpoint")).toBeTruthy();
    expect(screen.getByText("https://example.test/hook")).toBeTruthy();
  });

  it("NIEZNANA kontrola pokazuje nazwę techniczną, zamiast zniknąć z listy", async () => {
    h.diag.current = diagnostics({
      checks: [{ id: "nowa_kontrola_serwerowa", state: "warn", detail: "szczegół" }],
    });
    render();

    await waitFor(() => expect(screen.getByText("nowa_kontrola_serwerowa")).toBeTruthy());
    expect(screen.getByText("szczegół")).toBeTruthy();
  });

  it("stan kontroli pochodzi z raportu - trzy stany dają trzy różne ikony", async () => {
    h.diag.current = diagnostics({
      checks: [
        { id: "gateway_configured", state: "ok", detail: "sandbox" },
        { id: "webhook_endpoint", state: "warn", detail: "0" },
        { id: "catalog", state: "error", detail: "8/10" },
      ],
    });
    render();

    await awaitReport();
    const icons = document.querySelectorAll("li svg.lucide");
    // Trzy różne klasy ikon = trzy różne stany, nie jedna ikona dla wszystkich.
    expect(new Set(Array.from(icons).map((icon) => icon.getAttribute("class"))).size).toBe(3);
    expect(screen.getByText("8/10")).toBeTruthy();
  });

  it("podsumowanie dziennika niesie liczby z serwera", async () => {
    h.diag.current = diagnostics({
      webhooks: {
        total: 40,
        failed: 3,
        lastEventAt: "2026-08-18T10:00:00.000Z",
        avgDurationMs: 150,
      },
    });
    render();

    await awaitReport();
    const summary = screen.getByText(/adminBilling\.webhookSummary/);
    expect(summary.textContent).toContain('"total":40');
    expect(summary.textContent).toContain('"failed":3');
  });

  it("brak średniego czasu obsługi pokazuje kreskę, nie „null”", async () => {
    h.diag.current = diagnostics({
      webhooks: { total: 0, failed: 0, lastEventAt: null, avgDurationMs: null },
    });
    render();

    await awaitReport();
    const summary = screen.getByText(/adminBilling\.webhookSummary/);
    expect(summary.textContent).toContain('"avgMs":"-"');
    expect(summary.textContent).not.toContain('"avgMs":null');
  });

  it("BŁĄD WCZYTANIA raportu mówi to wprost, zamiast pokazywać puste kontrole", async () => {
    h.diagThrows.current = true;
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.couldLoadDiagnostics")).toBeTruthy());
    expect(screen.queryByText("adminBilling.checks.gateway")).toBeNull();
  });

  it("zmiana środowiska przeładowuje raport dla nowego środowiska", async () => {
    render();
    await awaitReport();
    h.diag.current = diagnostics({
      environment: "live",
      checks: [{ id: "gateway_configured", state: "error", detail: "missing_keys" }],
    });

    fireEvent.change(envSelect(), { target: { value: "live" } });

    await waitFor(() => expect(screen.getByText("missing_keys")).toBeTruthy());
  });

  it("ręczne powtórzenie kontroli pyta serwer ponownie", async () => {
    render();
    await awaitReport();
    h.diag.current = diagnostics({
      checks: [{ id: "catalog", state: "error", detail: "PO ODSWIEZENIU" }],
    });

    fireEvent.click(screen.getByText("adminBilling.reRunChecks"));

    await waitFor(() => expect(screen.getByText("PO ODSWIEZENIU")).toBeTruthy());
  });
});

describe("AdminPaymentsDiagnosticsPanel - katalog cen", () => {
  it("BRAKUJĄCE CENY są policzone przy przycisku testu", async () => {
    h.diag.current = diagnostics({
      catalog: [
        { priceId: "plus_monthly", providerPriceId: null },
        { priceId: "pro_monthly", providerPriceId: null },
        { priceId: "pro_annual", providerPriceId: "price_ok" },
      ],
    });
    render();

    await awaitReport();
    const warning = screen.getByText(/adminBilling\.missingProviderPrices/);
    expect(warning.textContent).toContain('"count":2');
  });

  it("kompletny katalog nie pokazuje ostrzeżenia o brakach", async () => {
    render();

    await awaitReport();
    expect(screen.queryByText(/adminBilling\.missingProviderPrices/)).toBeNull();
  });

  it("lista katalogu pokazuje brak ceny jako „brakuje”, nie jako pustkę", async () => {
    h.diag.current = diagnostics({
      catalog: [{ priceId: "plus_monthly", providerPriceId: null }],
    });
    render();

    await awaitReport();
    expect(screen.getByText("adminBilling.missing")).toBeTruthy();
    expect(screen.getByText("plus_monthly")).toBeTruthy();
  });

  it("cena obecna u operatora jest pokazana identyfikatorem", async () => {
    render();

    await awaitReport();
    expect(screen.getByText("price_1")).toBeTruthy();
    expect(screen.queryByText("adminBilling.missing")).toBeNull();
  });
});

describe("AdminPaymentsDiagnosticsPanel - kontrolowany test checkoutu", () => {
  it("bez wybranego planu przycisk testu jest wyłączony", async () => {
    render();
    await awaitReport();

    expect(
      screen.getByText("adminBilling.runTest").closest("button")?.hasAttribute("disabled"),
    ).toBe(true);
    expect(h.openPlanCheckout).not.toHaveBeenCalled();
  });

  it("wybrany plan uruchamia nakładkę z sekretem sesji", async () => {
    render();
    await awaitReport();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    fireEvent.change(planSelect(), { target: { value: "plan-1" } });
    fireEvent.click(screen.getByText("adminBilling.runTest"));

    await waitFor(() => expect(h.dialogSecrets.at(-1)).toBe("cs_secret_syntetyczny"));
    expect(h.openPlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "plan-1", priceId: "plus_monthly" }),
    );
  });

  it("TEST NIE URUCHAMIA SIĘ NA CUDZYM ŚRODOWISKU", async () => {
    render();
    await awaitReport();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
    fireEvent.change(planSelect(), { target: { value: "plan-1" } });

    // Panel przestawiony na produkcję, a aplikacja zbudowana pod sandbox.
    fireEvent.change(envSelect(), { target: { value: "live" } });
    fireEvent.click(screen.getByText("adminBilling.runTest"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminBilling.checkoutOverlayRunsBuildS"),
    );
    expect(h.openPlanCheckout).not.toHaveBeenCalled();
  });

  it("NIEZALOGOWANY nie uruchamia testu", async () => {
    h.user.current = null;
    render();
    await awaitReport();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    fireEvent.change(planSelect(), { target: { value: "plan-1" } });
    fireEvent.click(screen.getByText("adminBilling.runTest"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("adminBilling.signRunTest"));
    expect(h.openPlanCheckout).not.toHaveBeenCalled();
  });

  it("plan BEZ odpowiednika w katalogu cen nie otwiera nakładki", async () => {
    h.plans.current = [
      {
        id: "plan-widmo",
        name_pl: "Widmo",
        name_en: "Ghost",
        tier_key: "nieznany",
        interval: "month",
      },
    ];
    render();
    await awaitReport();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    fireEvent.change(planSelect(), { target: { value: "plan-widmo" } });
    fireEvent.click(screen.getByText("adminBilling.runTest"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminBilling.matchingStripePriceCatalog"),
    );
    expect(h.openPlanCheckout).not.toHaveBeenCalled();
  });

  it("ODMOWA otwarcia kasy jest pokazywana z powodem, bez nakładki", async () => {
    h.openPlanCheckout.mockResolvedValue({ ok: false, error: "plan nieaktywny" });
    render();
    await awaitReport();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    fireEvent.change(planSelect(), { target: { value: "plan-1" } });
    fireEvent.click(screen.getByText("adminBilling.runTest"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("plan nieaktywny"));
    expect(h.dialogSecrets.every((secret) => secret === null)).toBe(true);
  });

  it("wyjątek przy otwieraniu kasy nie zostawia panelu w ciszy", async () => {
    h.openPlanCheckout.mockRejectedValue(new Error("sieć padła"));
    render();
    await awaitReport();
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    fireEvent.change(planSelect(), { target: { value: "plan-1" } });
    fireEvent.click(screen.getByText("adminBilling.runTest"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("sieć padła"));
    expect(h.dialogSecrets.every((secret) => secret === null)).toBe(true);
  });

  it("nazwa planu na liście idzie za językiem interfejsu", async () => {
    h.lang.current = "en";
    render();
    await awaitReport();

    await waitFor(() => expect(screen.getByRole("option", { name: "Member" })).toBeTruthy());
    expect(screen.queryByRole("option", { name: "Członek" })).toBeNull();
  });

  it("lista planów bierze WYŁĄCZNIE plany aktywne, w kolejności katalogowej", async () => {
    render();

    await waitFor(() => expect(h.chain!.chainsFor("access_plans").length).toBeGreaterThan(0));
    const chain = h.chain!.lastChain("access_plans")!;
    expect(chain.argsOf("eq")).toEqual(["active", true]);
    expect(chain.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });
});

describe("AdminPaymentsDiagnosticsPanel - synchronizacja kuponów", () => {
  it("raportuje trzy liczby: utworzone, istniejące, nieudane", async () => {
    render();
    await awaitReport();

    fireEvent.click(screen.getByText("adminBilling.syncCoupons"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.couponsSynced {"created":1,"existing":2,"failed":0}',
      ),
    );
    expect(h.sync).toHaveBeenCalledWith({ data: { environment: "sandbox" } });
  });

  it("synchronizacja dotyczy WYBRANEGO środowiska, nie zawsze domyślnego", async () => {
    render();
    await awaitReport();

    fireEvent.change(envSelect(), { target: { value: "live" } });
    fireEvent.click(screen.getByText("adminBilling.syncCoupons"));

    await waitFor(() => expect(h.sync).toHaveBeenCalledWith({ data: { environment: "live" } }));
  });

  it("awaria synchronizacji pokazuje powód i NIE udaje sukcesu", async () => {
    h.sync.mockRejectedValue(new Error("bramka odmówiła"));
    render();
    await awaitReport();

    fireEvent.click(screen.getByText("adminBilling.syncCoupons"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("bramka odmówiła"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie synchronizacji przycisk jest zablokowany", async () => {
    h.sync.mockImplementation(() => new Promise(() => {}));
    render();
    await awaitReport();

    fireEvent.click(screen.getByText("adminBilling.syncCoupons"));

    await waitFor(() =>
      expect(
        screen.getByText("adminBilling.syncCoupons").closest("button")?.hasAttribute("disabled"),
      ).toBe(true),
    );
    expect(h.sync).toHaveBeenCalledTimes(1);
  });
});

describe("AdminPaymentsDiagnosticsPanel - tabela kuponów wobec rabatów operatora", () => {
  const coupon = (overrides: Record<string, unknown> = {}) => ({
    code: "NES10",
    active: true,
    discountKind: "percent",
    discountPercent: 10,
    discountCents: null,
    currency: null,
    validUntil: "2026-12-31T00:00:00.000Z",
    maxRedemptions: null,
    timesRedeemed: 3,
    grantsTierKey: null,
    grantsDurationDays: null,
    providerDiscountId: null,
    ...overrides,
  });

  it("kupon procentowy pokazuje procent", async () => {
    h.diag.current = diagnostics({ coupons: [coupon()] });
    render();

    await awaitReport();
    expect(screen.getByText("10%")).toBeTruthy();
    expect(screen.getByText("NES10")).toBeTruthy();
  });

  it("kupon kwotowy pokazuje kwotę z walutą", async () => {
    h.diag.current = diagnostics({
      coupons: [
        coupon({ code: "FIX50", discountKind: "fixed", discountCents: 5000, currency: "eur" }),
      ],
    });
    render();

    await awaitReport();
    expect(screen.getByText("50.00 EUR")).toBeTruthy();
  });

  it("BRAK RABATU u operatora jest opisany jako „przy pierwszym użyciu”", async () => {
    h.diag.current = diagnostics({ coupons: [coupon({ providerDiscountId: null, active: true })] });
    render();

    await awaitReport();
    expect(screen.getByText("adminBilling.firstUse")).toBeTruthy();
    expect(screen.queryByText("adminBilling.synced")).toBeNull();
  });

  it("kupon NIEAKTYWNY bez rabatu jest opisany jako nieaktywny", async () => {
    h.diag.current = diagnostics({
      coupons: [coupon({ providerDiscountId: null, active: false })],
    });
    render();

    await awaitReport();
    expect(screen.getByText("adminBilling.inactive")).toBeTruthy();
    expect(screen.queryByText("adminBilling.firstUse")).toBeNull();
  });

  it("kupon z rabatem u operatora jest opisany jako zsynchronizowany", async () => {
    h.diag.current = diagnostics({ coupons: [coupon({ providerDiscountId: "promo_1" })] });
    render();

    await awaitReport();
    expect(screen.getByText("adminBilling.synced")).toBeTruthy();
    expect(screen.queryByText("adminBilling.firstUse")).toBeNull();
  });

  it("limit użyć pokazuje się jako „użyte / limit”", async () => {
    h.diag.current = diagnostics({
      coupons: [coupon({ timesRedeemed: 3, maxRedemptions: 10 })],
    });
    render();

    await awaitReport();
    expect(screen.getByText("3 / 10")).toBeTruthy();
  });

  it("bez limitu pokazuje samą liczbę użyć", async () => {
    h.diag.current = diagnostics({ coupons: [coupon({ timesRedeemed: 7, maxRedemptions: null })] });
    render();

    await awaitReport();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.queryByText("7 / ")).toBeNull();
  });

  it("kupon NADAJĄCY WARSTWĘ pokazuje warstwę i długość nadania", async () => {
    h.diag.current = diagnostics({
      coupons: [coupon({ grantsTierKey: "member", grantsDurationDays: 90 })],
    });
    render();

    await awaitReport();
    expect(screen.getByText(/member/)).toBeTruthy();
    expect(screen.getByText(/90/)).toBeTruthy();
  });

  it("kupon bez nadania warstwy pokazuje kreskę", async () => {
    h.diag.current = diagnostics({ coupons: [coupon()] });
    render();

    await awaitReport();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("brak kuponów nie renderuje tabeli", async () => {
    render();

    await awaitReport();
    expect(screen.queryByText("adminBilling.code")).toBeNull();
  });
});
