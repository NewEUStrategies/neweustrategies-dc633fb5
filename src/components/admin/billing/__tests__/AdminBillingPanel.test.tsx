// Panel rozliczeń jako ORGANIZM spinający pozostałe panele adminowe -
// 0 z 24 funkcji pokrytych do 18.08.2026, przy 434 liniach. Razem z nim
// `ResendPortalLinkButton` (0 z 5).
//
// Panele potomne (dziennik zdarzeń, diagnostyka, zamówienia płatnicze
// i biletowe) mają własne pliki testowe i są tu ATRAPAMI. Ten plik pilnuje
// tego, czego żaden z nich nie widzi:
//
//   1. TRZY LICZNIKI NA GÓRZE. „Aktywne", „nieudane płatności" i „zaplanowane
//      anulowania" to pierwsze, na co patrzy operator - i jedyne miejsce, gdzie
//      widać skalę problemu. Liczone z CAŁEJ listy, po jawnych regułach
//      (`active`/`trialing` to aktywne; licznik nieudanych płatności > 0 to
//      windykacja; `cancel_at_period_end` to odejście w kolejce).
//   2. STAN AUTOMATU I KATALOGU CEN. Wyłączony scheduler oznacza, że
//      przypomnienia o odnowieniu NIE WYCHODZĄ - panel musi to powiedzieć wprost
//      i wskazać, gdzie to włączyć. Rozjazd odcisku integracji oznacza restart
//      po stronie operatora (nowe konto, rotacja klucza).
//   3. LINK DO PORTALU IDZIE DO WŁAŚCICIELA SUBSKRYPCJI, nigdy do administratora.
//      Administrator nie widzi samego linku - jest jednorazowy i wrażliwy.
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { ok, supabaseFromStub } from "@/test/billing/fixtures";
import { uiLocale } from "@/lib/i18n/format";
import { formatMoney } from "@/lib/billing/types";

interface AdminSubscriptionRow {
  id: string;
  user_id: string;
  provider_subscription_id: string;
  price_id: string;
  status: string;
  quantity: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  payment_failure_count: number;
  last_payment_failed_at: string | null;
  environment: string;
  created_at: string;
}

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  subs: { current: [] as AdminSubscriptionRow[] },
  subsError: { current: false },
  runner: { current: null as { enabled: boolean; base_url: string | null } | null },
  catalogState: { current: null as Record<string, unknown> | null },
  /** Odmowa bramki operatora platformy przy odczycie stanu katalogu. */
  catalogStateDenied: { current: false },
  /** Dowolny inny błąd odczytu stanu katalogu (step-up MFA, awaria bazy). */
  catalogStateError: { current: null as Error | null },
  reminders: vi.fn(),
  syncCatalog: vi.fn(),
  resend: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  resendProps: [] as Array<{ userId: string; environment: string }>,
  chain: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
  /** Odczyty huba (S2): most MRR i windykacja - ta sama RPC co hub. */
  bridge: { current: null as unknown },
  dunning: { current: null as unknown },
  bridgeCalls: [] as unknown[],
  provenance: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/lib/i18n-admin-billing", () => ({}));
vi.mock("@/lib/i18n-admin-revenue-finance", () => ({ ensureI18n: () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ tenantId: "tenant-1", roles: ["admin"] }) }));
vi.mock("@/components/admin/revenue/atoms/ProvenanceNote", () => ({
  ProvenanceNote: (props: Record<string, unknown>) => {
    h.provenance.push(props);
    return <span data-testid="provenance" />;
  },
}));
// KPI panelu = odczyty huba (S2, P10): server fns finansów jako atrapy, a
// `queryOptions` z `finance/queries.ts` PRAWDZIWE - ten sam klucz co hub.
vi.mock("@/lib/revenue/finance/finance.functions", () => {
  const unavailable = () => Promise.resolve({ state: "unavailable" });
  return {
    getRevenueMrrBridge: (arg: unknown) => {
      h.bridgeCalls.push(arg);
      return Promise.resolve(h.bridge.current);
    },
    getRevenueDunning: () => Promise.resolve(h.dunning.current),
    getRevenueMrrSeries: unavailable,
    getRevenueChurn: unavailable,
    getRevenueCohorts: unavailable,
    getRevenueRealized: unavailable,
    getRevenueRetentionOffers: unavailable,
    getRevenueOfferMatrix: unavailable,
    getRevenueInputs: unavailable,
    getRevenueEconomics: unavailable,
    saveRevenueInput: unavailable,
  };
});

vi.mock("@/components/ui/tabs", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixTabsStub(react);
});

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: <T,>(fn: T) => fn }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.chain!.from(table) },
}));

vi.mock("@/lib/billing/reminders.functions", () => ({
  runBillingRemindersNow: (arg: unknown) => h.reminders(arg),
}));

vi.mock("@/lib/billing/catalogSync.functions", () => ({
  getCatalogSyncState: () =>
    h.catalogStateError.current
      ? Promise.reject(h.catalogStateError.current)
      : h.catalogStateDenied.current
        ? Promise.reject(new Error("Forbidden: platform admin role (super_admin) required"))
        : Promise.resolve(h.catalogState.current),
  syncPaymentCatalogNow: (arg: unknown) => h.syncCatalog(arg),
}));

vi.mock("@/lib/newsletter-admin.functions", () => ({
  getJobRunnerSettings: () => Promise.resolve(h.runner.current),
}));

vi.mock("@/lib/billing/portalLink.functions", () => ({
  resendPortalLinkForUser: (arg: unknown) => h.resend(arg),
}));

// Panele potomne: atrapy wystawiające sam fakt osadzenia. Ich zachowanie ma
// własne pliki testowe - organizm odpowiada tylko za to, KTÓRY z nich pokazuje.
vi.mock("@/components/admin/billing/AdminWebhookLogPanel", () => ({
  AdminWebhookLogPanel: () => <div data-testid="panel-dziennik" />,
}));
vi.mock("@/components/admin/billing/AdminPaymentsDiagnosticsPanel", () => ({
  AdminPaymentsDiagnosticsPanel: () => <div data-testid="panel-diagnostyka" />,
}));
vi.mock("@/components/admin/billing/AdminPaymentOrdersPanel", () => ({
  AdminPaymentOrdersPanel: () => <div data-testid="panel-zamowienia" />,
}));
vi.mock("@/components/admin/billing/AdminTicketOrdersPanel", () => ({
  AdminTicketOrdersPanel: () => <div data-testid="panel-bilety" />,
}));
vi.mock("@/components/admin/billing/LegacyNonPaymentReconcileCard", () => ({
  LegacyNonPaymentReconcileCard: () => <div data-testid="karta-dawne-anulowania" />,
}));
// Karta przeniesienia na cennik v6.2 ma własny test (SubscriptionRepricingCard.test.tsx).
vi.mock("@/components/admin/billing/SubscriptionRepricingCard", () => ({
  SubscriptionRepricingCard: () => <div data-testid="karta-cennik-v62" />,
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { AdminBillingPanel } from "@/components/admin/billing/AdminBillingPanel";
import { ResendPortalLinkButton } from "@/components/admin/billing/ResendPortalLinkButton";

function subscription(overrides: Partial<AdminSubscriptionRow> = {}): AdminSubscriptionRow {
  return {
    id: "sub-row-1",
    user_id: "user-me",
    provider_subscription_id: "sub_stripe_1",
    price_id: "plus_monthly",
    status: "active",
    quantity: 1,
    current_period_end: "2026-09-18T10:00:00.000Z",
    cancel_at_period_end: false,
    payment_failure_count: 0,
    last_payment_failed_at: null,
    environment: "sandbox",
    created_at: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

/** Wiersz waluty mostu MRR (DTO po parserze). */
function money(currency: string, endMinor: number) {
  return {
    currency,
    startMinor: endMinor,
    openingMinor: 0,
    newMinor: 0,
    expansionMinor: 0,
    reactivationMinor: 0,
    contractionMinor: 0,
    churnMinor: 0,
    endMinor,
    netNewMinor: 0,
    activeSubscriptions: 1,
    activeCustomers: 1,
    residualMinor: 0,
    reconciled: true,
  };
}

function bridgeRead(over: { activeSubscriptions?: number; currencies?: unknown[] | null } = {}) {
  return {
    state: "ready",
    data: {
      since: "2026-08-01T00:00:00+00:00",
      until: "2026-08-18T10:00:00+00:00",
      segment: "all",
      dataSince: "2026-07-01T10:00:00+00:00",
      basisMix: { provider: 0.75, catalog: 0.25 },
      currencies: over.currencies === undefined ? [] : over.currencies,
      activeSubscriptions: over.activeSubscriptions ?? 0,
      activeCustomers: over.activeSubscriptions ?? 0,
    },
  };
}

function dunningRead(open: number) {
  return {
    state: "ready",
    data: {
      since: "2026-08-01T00:00:00+00:00",
      until: "2026-08-18T10:00:00+00:00",
      started: 0,
      recovered: 0,
      lost: 0,
      open,
      recoveryRate: null,
      medianDaysToRecover: null,
      atRisk: [],
      recoveredMrr: [],
      lostMrr: [],
    },
  };
}

const render = () => renderWithQueryClient(<AdminBillingPanel />);
const awaitRows = () =>
  waitFor(() => expect(document.querySelectorAll("tbody tr").length).toBeGreaterThan(0));

/** Liczniki na górze - w kolejności: aktywne, MRR, windykacja, anulowania. */
const counters = (): string[] =>
  Array.from(document.querySelectorAll(".text-2xl")).map((node) => node.textContent ?? "");

beforeEach(() => {
  h.lang.current = "pl";
  h.subs.current = [subscription()];
  h.subsError.current = false;
  h.runner.current = { enabled: true, base_url: "https://runner.example.test" };
  h.catalogState.current = {
    fingerprintCurrent: true,
    catalogCurrent: true,
    lastSyncedAt: "2026-08-18T09:00:00.000Z",
    lastStatus: "ok",
    lastError: null,
  };
  h.catalogStateDenied.current = false;
  h.catalogStateError.current = null;
  h.reminders.mockReset().mockResolvedValue({ renewal: 3, expiring: 1 });
  h.syncCatalog.mockReset().mockResolvedValue({ created: 2, updated: 1, archived: [], failed: 0 });
  h.resend.mockReset().mockResolvedValue({ ok: true, email: "syntetyczny@example.test" });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.resendProps.length = 0;
  h.bridgeCalls.length = 0;
  h.provenance.length = 0;
  h.bridge.current = bridgeRead({ activeSubscriptions: 1, currencies: [money("PLN", 3900)] });
  h.dunning.current = dunningRead(0);
  h.chain = supabaseFromStub();
  h.chain.setResponse("subscriptions", () =>
    h.subsError.current
      ? {
          data: null,
          error: Object.assign(new Error("permission denied"), { name: "PostgrestError" }),
        }
      : ok(h.subs.current),
  );
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("AdminBillingPanel - liczniki z RPC huba (P10, br.04 D8)", () => {
  // Liczniki „aktywne" i „MRR" to most MRR huba, „nieudane płatności" -
  // otwarte cykle windykacji huba: ta sama RPC i ten sam klucz cache, więc
  // /admin/billing i /admin/revenue pokazują te same liczby. Dawniej liczone
  // z próbki 500 wierszy listy, z kluczem bez najemcy.
  it("AKTYWNE = `activeSubscriptions` mostu MRR, nie próbka listy", async () => {
    h.subs.current = [subscription({ id: "a" }), subscription({ id: "b", status: "canceled" })];
    h.bridge.current = bridgeRead({ activeSubscriptions: 7, currencies: [money("PLN", 3900)] });
    render();

    await waitFor(() => expect(counters()[0]).toBe("7"));
    expect(counters()).toHaveLength(4);
  });

  it("most czytany oknem BIEŻĄCEGO MIESIĄCA hubu, bez segmentu i bez najemcy w parametrach", async () => {
    render();
    await waitFor(() => expect(h.bridgeCalls).toHaveLength(1));
    const call = h.bridgeCalls[0] as { data: Record<string, unknown> };
    expect(Object.keys(call.data).sort()).toEqual(["segment", "sinceIso", "untilIso"]);
    expect(call.data.segment).toBeNull();
    expect(new Date(call.data.sinceIso as string).getDate()).toBe(1);
  });

  it("MRR pokazuje koniec mostu PER WALUTA, nigdy sumy walut", async () => {
    h.bridge.current = bridgeRead({
      activeSubscriptions: 3,
      currencies: [money("PLN", 12_345), money("EUR", 500)],
    });
    render();

    await waitFor(() => expect(counters()[1]).toContain(formatMoney(12_345, "PLN", "pl")));
    expect(counters()[1]).toContain(formatMoney(500, "EUR", "pl"));
  });

  it("księga nie zna okna (`currencies: null`): kreska, nie zero", async () => {
    h.bridge.current = bridgeRead({ activeSubscriptions: 2, currencies: null });
    render();
    await waitFor(() => expect(counters()[0]).toBe("2"));
    expect(counters()[1]).toBe("-");
  });

  it("NIEUDANE PŁATNOŚCI = otwarte cykle windykacji z RPC", async () => {
    h.dunning.current = dunningRead(2);
    render();
    await waitFor(() => expect(counters()[2]).toBe("2"));
  });

  it("ODEJŚCIA W KOLEJCE liczą zaplanowane anulowania z listy", async () => {
    h.subs.current = [
      subscription({ id: "a", cancel_at_period_end: true }),
      subscription({ id: "b", cancel_at_period_end: false }),
    ];
    render();

    await waitFor(() => expect(counters()[3]).toBe("1"));
  });

  it("lista ucięta limitem: odejścia jako „co najmniej”, nie pełna liczba", async () => {
    h.subs.current = Array.from({ length: 500 }, (_, i) =>
      subscription({ id: `s${i}`, cancel_at_period_end: i < 3 }),
    );
    render();
    await waitFor(() => expect(counters()[3]).toBe("≥ 3"));
  });

  it("brak subskrypcji daje zera i komunikat, nie pustą tabelę", async () => {
    h.subs.current = [];
    h.bridge.current = bridgeRead({ activeSubscriptions: 0, currencies: [] });
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.subscriptionsYet")).toBeTruthy());
    await waitFor(() => expect(counters()).toEqual(["0", "0", "0", "0"]));
  });

  it("rola bez kwot (42501 z RPC): kreski i komunikat roli zamiast zer", async () => {
    h.bridge.current = { state: "forbidden" };
    h.dunning.current = { state: "forbidden" };
    render();
    await waitFor(() =>
      expect(screen.getByText("adminRevenue.finance.state.forbidden")).toBeTruthy(),
    );
    expect(counters()[0]).toBe("-");
    expect(counters()[1]).toBe("-");
  });

  it("podstawa kwot (D-05) i początek księgi idą do ProvenanceNote", async () => {
    render();
    await waitFor(() =>
      expect(h.provenance.at(-1)).toMatchObject({
        basisMix: { provider: 0.75, catalog: 0.25 },
        dataSince: "2026-07-01",
        environment: "live",
      }),
    );
  });

  // DEFEKT (2026-10-18): błąd odczytu subskrypcji kończył się komunikatem
  // „brak subskrypcji" i zerami. Liczniki z RPC zostają prawdziwe, licznik
  // z listy - kreska.
  it("BŁĄD ODCZYTU listy nie udaje zerowych odejść ani pustej listy", async () => {
    h.subsError.current = true;
    render();

    expect((await screen.findByRole("alert")).textContent).toBe("permission denied");
    expect(screen.queryByText("adminBilling.subscriptionsYet")).toBeNull();
    await waitFor(() => expect(counters()[0]).toBe("1"));
    expect(counters()[3]).toBe("-");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("odczyt wstrzymany BEZ SIECI: szkielet i kreski, a nie „brak subskrypcji” i zera", async () => {
    onlineManager.setOnline(false);
    render();

    await waitFor(() => expect(document.querySelector(".animate-pulse")).toBeTruthy());
    expect(screen.queryByText("adminBilling.subscriptionsYet")).toBeNull();
    expect(counters()).toEqual(["-", "-", "-", "-"]);
    expect(h.chain!.chainsFor("subscriptions")).toHaveLength(0);

    onlineManager.setOnline(true);
    await waitFor(() =>
      expect(counters()).toEqual(["1", formatMoney(3900, "PLN", "pl"), "0", "0"]),
    );
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("AdminBillingPanel - wiersz subskrypcji", () => {
  it("plan jest opisany warstwą i cyklem z katalogu, nie surowym identyfikatorem ceny", async () => {
    render();

    await awaitRows();
    expect(screen.getByText(/member · adminBilling\.monthly/)).toBeTruthy();
  });

  it("cykl roczny ma własną etykietę", async () => {
    h.subs.current = [subscription({ price_id: "pro_annual" })];
    render();

    await awaitRows();
    expect(screen.getByText(/pro · adminBilling\.yearly/)).toBeTruthy();
  });

  it("cykl kwartalny i dwutygodniowy też mają własne etykiety", async () => {
    h.subs.current = [
      subscription({ id: "a", price_id: "business_quarterly" }),
      subscription({ id: "b", price_id: "business_2w" }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText(/business · adminBilling\.quarterly/)).toBeTruthy();
    expect(screen.getByText(/business · adminBilling\.every2Weeks/)).toBeTruthy();
  });

  it("cena SPOZA katalogu pokazuje surowy identyfikator, zamiast zniknąć", async () => {
    h.subs.current = [subscription({ price_id: "cena_nieznana" })];
    render();

    await awaitRows();
    expect(screen.getByText("cena_nieznana")).toBeTruthy();
  });

  it("liczba miejsc pokazuje się tylko przy planie wielostanowiskowym", async () => {
    h.subs.current = [
      subscription({ id: "a", price_id: "team_monthly_seat", quantity: 5 }),
      subscription({ id: "b", quantity: 1 }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText(/× 5/)).toBeTruthy();
    expect(screen.queryByText(/× 1/)).toBeNull();
  });

  it("zaplanowane anulowanie jest oznaczone przy statusie", async () => {
    h.subs.current = [subscription({ cancel_at_period_end: true })];
    render();

    await awaitRows();
    expect(screen.getByText("adminBilling.canceling")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("NIEUDANE PŁATNOŚCI pokazują licznik i datę ostatniej próby", async () => {
    h.subs.current = [
      subscription({
        payment_failure_count: 2,
        last_payment_failed_at: "2026-08-17T10:00:00.000Z",
      }),
    ];
    render();

    await awaitRows();
    expect(screen.getByText(/^2 ·/)).toBeTruthy();
  });

  it("brak nieudanych płatności to kreska, nie zero", async () => {
    render();

    await awaitRows();
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText(/^0 ·/)).toBeNull();
  });

  it("status spoza słownika tonów jest pokazany neutralnie, a nie bez stylu", async () => {
    h.subs.current = [subscription({ status: "incomplete_expired" })];
    render();

    const badge = await screen.findByText("incomplete_expired");
    expect(badge.className).toContain("bg-muted");
    expect(badge.className).toContain("text-muted-foreground");
  });

  it("interfejs ANGIELSKI pokazuje koniec okresu w zapisie angielskim", async () => {
    h.lang.current = "en";
    render();
    await awaitRows();

    const expected = new Date("2026-09-18T10:00:00.000Z").toLocaleString(uiLocale("en"));
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("link do portalu dla subskrypcji PRODUKCYJNEJ idzie w środowisku `live`", async () => {
    h.subs.current = [subscription({ environment: "live", user_id: "user-produkcja" })];
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.sendLink"));

    await waitFor(() =>
      expect(h.resend).toHaveBeenCalledWith({
        data: { userId: "user-produkcja", environment: "live" },
      }),
    );
  });

  it("identyfikator subskrypcji u operatora jest widoczny (do zgłoszeń)", async () => {
    render();

    await awaitRows();
    expect(screen.getByText("sub_stripe_1")).toBeTruthy();
    expect(screen.getByText("sandbox")).toBeTruthy();
  });
});

describe("AdminBillingPanel - stan automatu przypomnień", () => {
  it("AKTYWNY scheduler pokazuje adres, pod którym działa", async () => {
    render();

    await waitFor(() => expect(screen.getByText(/adminBilling\.schedulerActive/)).toBeTruthy());
    expect(screen.getByText(/runner\.example\.test/)).toBeTruthy();
  });

  it("WYŁĄCZONY scheduler mówi wprost i linkuje, gdzie go włączyć", async () => {
    h.runner.current = { enabled: false, base_url: null };
    render();

    await waitFor(() =>
      expect(screen.getByText(/adminBilling\.schedulerInactiveEnableJobRunner/)).toBeTruthy(),
    );
    expect(screen.getByText("/admin/newsletter/campaigns").getAttribute("href")).toBe(
      "/admin/newsletter/campaigns",
    );
  });

  it("scheduler włączony BEZ adresu jest traktowany jak nieaktywny", async () => {
    h.runner.current = { enabled: true, base_url: null };
    render();

    await waitFor(() =>
      expect(screen.getByText(/adminBilling\.schedulerInactiveEnableJobRunner/)).toBeTruthy(),
    );
    expect(screen.queryByText(/adminBilling\.schedulerActive/)).toBeNull();
  });

  it("ręczne uruchomienie przypomnień raportuje liczby z serwera", async () => {
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.remindersQueued {"renewal":3,"expiring":1}',
      ),
    );
    expect(h.reminders).toHaveBeenCalledWith({ data: {} });
  });

  it("awaria przypomnień pokazuje powód, nie ogólny błąd", async () => {
    h.reminders.mockRejectedValue(new Error("scheduler nie odpowiada"));
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("scheduler nie odpowiada"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("admin NAJEMCY dostaje zrozumiałą odmowę bramki platformy, nie surowy komunikat", async () => {
    // SUB-08: przebieg obejmuje wszystkich najemców, więc stoi za
    // `requirePlatformAdmin`. Odmowa middleware to techniczny napis
    // „Forbidden: ..." - panel tłumaczy go na zdanie dla człowieka.
    h.reminders.mockRejectedValue(
      new Error("Forbidden: platform admin role (super_admin) required"),
    );
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminBilling.remindersPlatformOnly"),
    );
  });

  // Audyt #31: bramka buduje KAŻDĄ odmowę z etykiety „platform admin role
  // (super_admin)". Dawne `includes("platform admin role")` mówiło operatorowi
  // platformy z sesją `aal1`, że „tylko operator platformy" może to zrobić,
  // i chowało jedyny działający krok - potwierdzenie drugiego składnika.
  it("operator platformy z sesją bez MFA dostaje wskazówkę step-upu, nie „tylko operator platformy”", async () => {
    h.reminders.mockRejectedValue(
      new Error(
        "Forbidden: mfa_required - verify your second factor (aal2) to perform platform admin role (super_admin) actions",
      ),
    );
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminBilling.mfaStepUpRequired"),
    );
    expect(h.toastError).not.toHaveBeenCalledWith("adminBilling.remindersPlatformOnly");
  });

  it("nieudana weryfikacja roli (awaria bazy) pokazuje prawdziwy powód", async () => {
    const message =
      "Forbidden: could not verify platform admin role (super_admin) (permission denied for table tenants)";
    h.reminders.mockRejectedValue(new Error(message));
    render();

    fireEvent.click(screen.getByText("adminBilling.sendReminders"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(message));
  });
});

describe("AdminBillingPanel - stan katalogu cen", () => {
  it("zgodny odcisk i aktualny katalog dają dwie odznaki „w porządku”", async () => {
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.integrationSync")).toBeTruthy());
    expect(screen.getByText("adminBilling.pricingUpDate")).toBeTruthy();
  });

  it("ROZJAZD ODCISKU (restart integracji u operatora) jest wołany po imieniu", async () => {
    h.catalogState.current = {
      fingerprintCurrent: false,
      catalogCurrent: true,
      lastSyncedAt: null,
      lastStatus: null,
      lastError: null,
    };
    render();

    await waitFor(() =>
      expect(screen.getByText("adminBilling.integrationRestartDetected")).toBeTruthy(),
    );
    expect(screen.getByText("adminBilling.syncedYet")).toBeTruthy();
  });

  it("zmieniony cennik pokazuje, że synchronizacja jest w kolejce", async () => {
    h.catalogState.current = {
      fingerprintCurrent: true,
      catalogCurrent: false,
      lastSyncedAt: "2026-08-18T09:00:00.000Z",
      lastStatus: "queued",
      lastError: null,
    };
    render();

    await waitFor(() =>
      expect(screen.getByText("adminBilling.pricingChangedSyncQueued")).toBeTruthy(),
    );
    // Nagłówek kolumny tabeli też jest `adminBilling.status`, więc szukamy
    // wpisu ze stanem ostatniej synchronizacji, nie samego klucza.
    expect(screen.getByText(/adminBilling\.status: queued/)).toBeTruthy();
  });

  it("BŁĄD ostatniej synchronizacji jest pokazany, nie ukryty", async () => {
    h.catalogState.current = {
      fingerprintCurrent: true,
      catalogCurrent: false,
      lastSyncedAt: "2026-08-18T09:00:00.000Z",
      lastStatus: "failed",
      lastError: "brak uprawnień do cennika",
    };
    render();

    await waitFor(() => expect(screen.getByText("brak uprawnień do cennika")).toBeTruthy());
  });

  it("ręczna synchronizacja raportuje cztery liczby", async () => {
    h.syncCatalog.mockResolvedValue({ created: 2, updated: 1, archived: ["x"], failed: 0 });
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.catalogSynced {"created":2,"updated":1,"archived":1,"failed":0}',
      ),
    );
  });

  it("brak listy zarchiwizowanych liczy się jako zero, nie wywala komunikatu", async () => {
    h.syncCatalog.mockResolvedValue({ created: 0, updated: 0, failed: 1 });
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        'adminBilling.catalogSynced {"created":0,"updated":0,"archived":0,"failed":1}',
      ),
    );
  });

  it("admin NAJEMCY (nie operator platformy) dostaje wyjaśnienie zamiast działającego przycisku", async () => {
    // Audyt SUB-05: katalog operatora jest wspólny dla instalacji, więc obie
    // funkcje stoją za `requirePlatformAdmin`. Odmowa bramki chowa stan
    // i blokuje przycisk, zamiast kończyć kliknięcie błędem.
    h.catalogStateDenied.current = true;
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.catalogPlatformOnly")).toBeTruthy());
    const button = screen.getByText("adminBilling.syncCatalog").closest("button");
    expect(button?.disabled).toBe(true);
    expect(screen.queryByText("adminBilling.integrationSync")).toBeNull();
  });

  // Audyt #22: dawniej `catalogPlatformOnly = isError` - KAŻDY błąd odczytu
  // stanu mówił „tylko operator platformy" i wyłączał przycisk do przeładowania.
  it("wymóg drugiego składnika: wskazówka step-upu i AKTYWNY przycisk, bez „tylko operator platformy”", async () => {
    h.catalogStateError.current = new Error(
      "Forbidden: mfa_required - verify your second factor (aal2) to perform platform admin role (super_admin) actions",
    );
    render();

    await waitFor(() => expect(screen.getByText("adminBilling.mfaStepUpRequired")).toBeTruthy());
    expect(screen.queryByText("adminBilling.catalogPlatformOnly")).toBeNull();
    const button = screen.getByText("adminBilling.syncCatalog").closest("button");
    expect(button?.disabled).toBe(false);
  });

  it("chwilowa awaria odczytu stanu: prawdziwy powód i AKTYWNY przycisk", async () => {
    h.catalogStateError.current = new Error("fetch failed");
    render();

    await waitFor(() =>
      expect(
        screen.getByText('adminBilling.catalogStateFailed {"message":"fetch failed"}'),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("adminBilling.catalogPlatformOnly")).toBeNull();
    const button = screen.getByText("adminBilling.syncCatalog").closest("button");
    expect(button?.disabled).toBe(false);
  });

  it("odmowa roli przy RĘCZNEJ synchronizacji tłumaczy się zdaniem, nie surowym napisem bramki", async () => {
    h.syncCatalog.mockRejectedValueOnce(
      new Error("Forbidden: platform admin role (super_admin) required"),
    );
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminBilling.catalogPlatformOnly"),
    );
  });

  it("wymóg drugiego składnika przy RĘCZNEJ synchronizacji to wskazówka step-upu", async () => {
    h.syncCatalog.mockRejectedValueOnce(
      new Error(
        "Forbidden: mfa_required - verify your second factor (aal2) to perform platform admin role (super_admin) actions",
      ),
    );
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("adminBilling.mfaStepUpRequired"),
    );
    expect(h.toastError).not.toHaveBeenCalledWith("adminBilling.catalogPlatformOnly");
  });

  it("odrzucenie stanu katalogu INNĄ wartością niż błąd nie jest odmową roli - przycisk zostaje", async () => {
    // Bramka odmawia wyjątkiem z komunikatem; wartość bez komunikatu (np. napis
    // z warstwy transportu) nie może zostać odczytana jako „tylko operator".
    h.catalogStateError.current = "zerwane połączenie" as unknown as Error;
    render();
    await awaitRows();

    await waitFor(() =>
      expect(screen.getByText("adminBilling.syncCatalog").closest("button")?.disabled).toBe(false),
    );
    expect(screen.queryByText("adminBilling.catalogPlatformOnly")).toBeNull();
    expect(screen.queryByText("adminBilling.mfaStepUpRequired")).toBeNull();
  });

  it("awaria synchronizacji katalogu pokazuje powód", async () => {
    h.syncCatalog.mockRejectedValue(new Error("bramka odmówiła"));
    render();

    fireEvent.click(screen.getByText("adminBilling.syncCatalog"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("bramka odmówiła"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("AdminBillingPanel - kompozycja paneli potomnych", () => {
  it("domyślnie pokazuje subskrypcje, a nie panele potomne", async () => {
    render();

    await awaitRows();
    expect(screen.queryByTestId("panel-dziennik")).toBeNull();
    expect(screen.queryByTestId("panel-diagnostyka")).toBeNull();
  });

  it("zakładka dziennika osadza panel zdarzeń", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.eventLog"));

    await waitFor(() => expect(screen.getByTestId("panel-dziennik")).toBeTruthy());
  });

  it("zakładka diagnostyki osadza panel diagnostyczny", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.diagnostics"));

    await waitFor(() => expect(screen.getByTestId("panel-diagnostyka")).toBeTruthy());
  });

  it("zakładki zamówień osadzają panele płatności i biletów", async () => {
    render();
    await awaitRows();

    fireEvent.click(screen.getByText("adminBilling.payments"));
    await waitFor(() => expect(screen.getByTestId("panel-zamowienia")).toBeTruthy());

    fireEvent.click(screen.getByText("adminBilling.tickets"));
    await waitFor(() => expect(screen.getByTestId("panel-bilety")).toBeTruthy());
  });

  it("karta uzgodnienia dawnych anulowań stoi nad zakładkami, niezależnie od zakładki", async () => {
    render();
    await awaitRows();

    expect(screen.getByTestId("karta-dawne-anulowania")).toBeTruthy();
    fireEvent.click(screen.getByText("adminBilling.eventLog"));
    await waitFor(() => expect(screen.getByTestId("panel-dziennik")).toBeTruthy());
    expect(screen.getByTestId("karta-dawne-anulowania")).toBeTruthy();
  });

  it("odświeżenie pyta bazę PONOWNIE o subskrypcje", async () => {
    render();
    await awaitRows();
    const before = h.chain!.chainsFor("subscriptions").length;

    fireEvent.click(screen.getByText("adminBilling.refresh"));

    await waitFor(() => expect(h.chain!.chainsFor("subscriptions").length).toBeGreaterThan(before));
    // Dziennik zdarzeń czyta wyłącznie jego własny panel (tu atrapa) - panel
    // rozliczeń nie trzyma pod kluczem dziennika okrojonej kopii wierszy
    // (`AdminBillingPanelWebhookLogCache.test.tsx`).
    expect(h.chain!.chainsFor("payment_webhook_events")).toHaveLength(0);
  });
});

describe("ResendPortalLinkButton - link idzie do WŁAŚCICIELA subskrypcji", () => {
  const renderButton = (environment: "sandbox" | "live" = "sandbox") =>
    renderWithQueryClient(
      <ResendPortalLinkButton userId="user-obcy" environment={environment} label="Wyślij link" />,
    );

  it("wysyła żądanie z identyfikatorem WŁAŚCICIELA i środowiskiem", async () => {
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(h.resend).toHaveBeenCalledWith({
        data: { userId: "user-obcy", environment: "sandbox" },
      }),
    );
  });

  it("środowisko produkcyjne jedzie jako `live`, nie domyślne", async () => {
    renderButton("live");

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(h.resend).toHaveBeenCalledWith({ data: { userId: "user-obcy", environment: "live" } }),
    );
  });

  it("potwierdzenie podaje ADRES, na który poszedł mail (nie sam link)", async () => {
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining("syntetyczny@example.test"),
      ),
    );
    // Administrator NIE widzi samego linku - jest jednorazowy i wrażliwy.
    expect(h.toastSuccess.mock.calls[0]?.[0]).not.toContain("http");
  });

  it("BRAK KONTA PŁATNIKA ma własny komunikat", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "no_customer" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    // Komunikaty przeniesione do słownika (`adminBilling.resendPortal`) -
    // asercja idzie po KLUCZU, więc zmiana copy jej nie psuje, a rozjazd
    // klucza owszem.
    expect(h.toastError.mock.calls[0]?.[0]).toContain("resendPortal.noCustomer");
  });

  it("brak adresu e-mail użytkownika ma osobny komunikat", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "no_recipient" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0]?.[0]).toContain("resendPortal.noRecipient");
  });

  it("NIEZNANY powód odmowy schodzi na komunikat wysyłki, nie na pustkę", async () => {
    h.resend.mockResolvedValue({ ok: false, error: "powod_z_przyszlosci" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0]?.[0]).toContain("resendPortal.sendFailed");
  });

  it("komunikaty idą przez SŁOWNIK, nie przez parę napisów w kodzie", async () => {
    // Do 19.08.2026 przycisk trzymał pięć par `pl ? "..." : "..."` wprost
    // w kodzie - poza bramką parytetu PL/EN i poza zasięgiem tłumacza. Teraz
    // wołany jest klucz, a wybór języka należy do i18next.
    h.lang.current = "en";
    h.resend.mockResolvedValue({ ok: false, error: "no_customer" });
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastError.mock.calls[0]?.[0]).toBe("adminBilling.resendPortal.noCustomer");
  });

  it("awaria transportu też kończy się komunikatem", async () => {
    h.resend.mockRejectedValue(new Error("sieć padła"));
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("w trakcie wysyłki przycisk jest zablokowany (bez dubla maila)", async () => {
    h.resend.mockImplementation(() => new Promise(() => {}));
    renderButton();

    fireEvent.click(screen.getByText("Wyślij link"));

    await waitFor(() =>
      expect(screen.getByText("Wyślij link").closest("button")?.hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(h.resend).toHaveBeenCalledTimes(1);
  });
});
