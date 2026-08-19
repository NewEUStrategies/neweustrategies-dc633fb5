// Cztery mniejsze powierzchnie rozliczeniowe, wszystkie na ZERZE do 18.08.2026:
// `SubscriptionStatusCard` (0/5), `SyncBillingButton` (0/3), `PlanCard` (0/2)
// i `HowPaymentsWorkCard` (0/2). W jednym pliku, bo dzielą atrapy warstwy
// danych - osobne pliki znaczyłyby cztery kopie tego samego montażu.
//
// Nie są to testy „czy się renderuje". Każda z tych powierzchni niesie regułę,
// której złamanie widzi wyłącznie klient:
//
//   * KARTA STATUSU tłumaczy, DLACZEGO dostęp działa albo nie: stan
//     subskrypcji, data odnowienia lub wygaśnięcia i metoda płatności. Reguła
//     stanu (`deriveSubscriptionStatus`) ma własny test - tu sprawdzamy jej
//     użycie oraz brak metody płatności, który nie jest błędem (dostęp
//     z nadania).
//   * SYNCHRONIZACJA to jedyny samoobsługowy ratunek na spóźniony webhook.
//     Musi unieważnić WSZYSTKIE widoki rozliczeniowe - odświeżenie samej
//     subskrypcji zostawiłoby klienta z paywallem po opłaconym zakupie.
//   * KARTA PLANU nigdy nie świeci pustą listą benefitów (plan podpięty pod
//     warstwę bierze je z warstwy) i nie proponuje kupna planu, który klient
//     już ma.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  accessPlan,
  isoFuture,
  isoPast,
  membershipGrant,
  moneyPattern,
  providerSubscription,
  userSubscription,
} from "@/test/billing/fixtures";
import type { MembershipGrantRow } from "@/lib/billing/membership";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";
import type { UserSubscriptionRow } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  providerSub: { current: null as StripeSubscriptionRow | null },
  grants: { current: [] as MembershipGrantRow[] },
  tier: { current: null as { key: string; name_pl: string; name_en: string } | null },
  method: {
    current: null as Record<string, unknown> | null,
    pending: false,
    error: false,
  },
  paymentsConfigured: { current: true },
  sync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/lib/stripe", () => ({
  getStripeEnvironmentSafe: () => "sandbox",
  isPaymentsConfigured: () => h.paymentsConfigured.current,
}));

vi.mock("@/lib/billing/subscriptionQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/subscriptionQueries")>()),
  fetchMyStripeSubscription: () => Promise.resolve(h.providerSub.current),
}));

// Reguła „które nadanie daje dostęp" (`activeGrants`/`primaryGrant`) NIE jest
// atrapą - jest przedmiotem użycia. Atrapą jest tylko odczyt z bazy.
vi.mock("@/lib/billing/membership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/membership")>()),
  useMyGrants: () => ({ data: h.grants.current }),
}));

vi.mock("@/lib/billing/tiers", () => ({
  useCurrentTier: () => ({ data: h.tier.current }),
  tierName: (tier: { name_pl: string; name_en: string }, lang: string) =>
    lang === "en" ? tier.name_en : tier.name_pl,
}));

vi.mock("@/utils/payments.functions", () => ({
  getMyPaymentMethod: () =>
    h.method.error
      ? Promise.resolve({ error: "no_customer" })
      : Promise.resolve({ method: h.method.current }),
  syncMyBillingFromProvider: (arg: unknown) => h.sync(arg),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { HowPaymentsWorkCard } from "@/components/billing/molecules/HowPaymentsWorkCard";
import { PlanCard } from "@/components/billing/molecules/PlanCard";
import { SubscriptionStatusCard } from "@/components/billing/organisms/SubscriptionStatusCard";
import { SyncBillingButton } from "@/components/billing/molecules/SyncBillingButton";

const renderStatus = (subscription: UserSubscriptionRow | null) =>
  renderWithQueryClient(<SubscriptionStatusCard subscription={subscription} />);

beforeEach(() => {
  h.lang.current = "pl";
  h.providerSub.current = null;
  h.grants.current = [];
  h.tier.current = null;
  h.method.current = null;
  h.method.error = false;
  h.paymentsConfigured.current = true;
  h.sync.mockReset().mockResolvedValue({ ok: true });
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("SubscriptionStatusCard - stan dostępu", () => {
  it("aktywna subskrypcja u operatora: stan aktywny i data ODNOWIENIA", async () => {
    h.providerSub.current = providerSubscription({ current_period_end: isoFuture(20) });
    renderStatus(null);

    await waitFor(() => expect(screen.getByText("profile.planPage.subStatus.active")).toBeTruthy());
    expect(screen.getByText("profile.planPage.statusCard.renewsAt")).toBeTruthy();
  });

  it("zaplanowane anulowanie: stan „zmiana zaplanowana” i data WYGAŚNIĘCIA", async () => {
    h.providerSub.current = providerSubscription({
      cancel_at_period_end: true,
      current_period_end: isoFuture(5),
    });
    renderStatus(null);

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.subStatus.cancelScheduled")).toBeTruthy(),
    );
    expect(screen.getByText("profile.planPage.statusCard.endsAt")).toBeTruthy();
  });

  it("zaległość po nieudanej płatności ma własny stan", async () => {
    h.providerSub.current = providerSubscription({ status: "past_due" });
    renderStatus(null);

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.subStatus.pastDue")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.planPage.subStatus.active")).toBeNull();
  });

  it("okres próbny jest odróżniony od zwykłej aktywności", async () => {
    h.providerSub.current = providerSubscription({ status: "trialing" });
    renderStatus(null);

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.subStatus.trialing")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.planPage.subStatus.active")).toBeNull();
  });

  it("BRAK SUBSKRYPCJI I NADAŃ to stan „none”, nie pusta karta", async () => {
    renderStatus(null);

    await waitFor(() => expect(screen.getByText("profile.planPage.subStatus.none")).toBeTruthy());
    expect(screen.getByText("profile.planPage.statusCard.title")).toBeTruthy();
  });

  it("DOSTĘP Z NADANIA DOŻYWOTNIEGO wypiera „brak subskrypcji”", async () => {
    h.grants.current = [membershipGrant({ expires_at: null, tier_key: "member" })];
    renderStatus(null);

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.subStatus.grantLifetime")).toBeTruthy(),
    );
    expect(screen.getByText("profile.planPage.grantLifetime")).toBeTruthy();
  });

  it("nadanie WYGASŁE nie udaje dostępu", async () => {
    h.grants.current = [membershipGrant({ expires_at: isoPast(1) })];
    renderStatus(null);

    await waitFor(() => expect(screen.getByText("profile.planPage.subStatus.none")).toBeTruthy());
    expect(screen.queryByText("profile.planPage.subStatus.grantLifetime")).toBeNull();
  });

  it("nazwa warstwy z RPC wypiera techniczny klucz nadania", async () => {
    h.grants.current = [membershipGrant({ tier_key: "member" })];
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    renderStatus(null);

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByText("MEMBER")).toBeNull();
  });

  it("bez dopasowania warstwy pokazuje klucz nadania wielkimi literami", async () => {
    h.grants.current = [membershipGrant({ tier_key: "vip" })];
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    renderStatus(null);

    await waitFor(() => expect(screen.getByText("VIP")).toBeTruthy());
    expect(screen.queryByText("Członek")).toBeNull();
  });
});

describe("SubscriptionStatusCard - metoda płatności", () => {
  it("karta pokazuje markę i cztery ostatnie cyfry", async () => {
    h.method.current = { brand: "visa", type: "card", last4: "4242" };
    renderStatus(userSubscription());

    await waitFor(() => expect(screen.getByText("visa")).toBeTruthy());
    expect(screen.getByText(/4242/)).toBeTruthy();
  });

  it("data ważności karty idzie przez klucz i18n, nie przez sklejony napis", async () => {
    h.method.current = { brand: "visa", type: "card", last4: "4242", expMonth: 3, expYear: 2030 };
    renderStatus(userSubscription());

    await waitFor(() =>
      expect(screen.getByText('profile.planPage.statusCard.expires {"date":"03/30"}')).toBeTruthy(),
    );
    expect(screen.getByText("visa")).toBeTruthy();
  });

  it("BRAK METODY PŁATNOŚCI nie jest błędem (dostęp z nadania)", async () => {
    h.method.current = null;
    renderStatus(null);

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.statusCard.noMethod")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.planPage.statusCard.methodError")).toBeNull();
  });

  it("awaria odczytu metody ma inny komunikat niż jej brak", async () => {
    h.method.error = true;
    renderStatus(userSubscription());

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.statusCard.methodError")).toBeTruthy(),
    );
    expect(screen.queryByText("profile.planPage.statusCard.noMethod")).toBeNull();
  });

  it("przy nieskonfigurowanych płatnościach karta NIE pyta operatora o metodę", async () => {
    h.paymentsConfigured.current = false;
    renderStatus(null);

    await waitFor(() =>
      expect(screen.getByText("profile.planPage.statusCard.noMethod")).toBeTruthy(),
    );
    // Brak szkieletu wczytywania - zapytanie nie zostało nawet włączone.
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("SyncBillingButton - ratunek na spóźniony webhook", () => {
  it("wysyła żądanie ze środowiskiem operatora", async () => {
    renderWithQueryClient(<SyncBillingButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.sync).toHaveBeenCalledTimes(1));
    expect(h.sync).toHaveBeenCalledWith({ data: { environment: "sandbox" } });
  });

  it("UNIEWAŻNIA WSZYSTKIE widoki rozliczeniowe, nie tylko subskrypcję", async () => {
    const { queryClient } = renderWithQueryClient(<SyncBillingButton />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    // Sześć powierzchni: subskrypcja lokalna, operatorska, warstwa, zamówienia,
    // dokumenty i nadania. Odświeżenie samej subskrypcji zostawiłoby paywall.
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(h.toastSuccess).toHaveBeenCalledWith("profile.planPage.syncOk");
  });

  it("ODMOWA W ŁADUNKU jest traktowana jako błąd, nie sukces", async () => {
    h.sync.mockResolvedValue({ error: "no_customer" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithQueryClient(<SyncBillingButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.planPage.syncError"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("awaria transportu też kończy się komunikatem", async () => {
    h.sync.mockRejectedValue(new Error("sieć padła"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithQueryClient(<SyncBillingButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.planPage.syncError"));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("po zakończeniu przycisk wraca do stanu gotowego", async () => {
    renderWithQueryClient(<SyncBillingButton />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });
});

describe("PlanCard", () => {
  it("pokazuje nazwę, kwotę i okres rozliczeniowy", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan()} />);

    expect(screen.getByText("Członek")).toBeTruthy();
    expect(screen.getByText(moneyPattern(4900))).toBeTruthy();
    expect(screen.getByText("pricing.perMonth")).toBeTruthy();
  });

  it("okres roczny ma własny klucz, nie miesięczny", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan({ interval: "year" })} />);

    expect(screen.getByText("pricing.perYear")).toBeTruthy();
    expect(screen.queryByText("pricing.perMonth")).toBeNull();
  });

  it("plan wyróżniony dostaje odznakę popularności, gdy nie ma własnej", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan({ highlighted: true })} />);

    expect(screen.getByText("pricing.popular")).toBeTruthy();
    expect(screen.getByText("Członek")).toBeTruthy();
  });

  it("własna odznaka planu wypiera „popularny”", () => {
    renderWithQueryClient(
      <PlanCard plan={accessPlan({ highlighted: true, badge_pl: "Najczęściej wybierany" })} />,
    );

    expect(screen.getByText("Najczęściej wybierany")).toBeTruthy();
    expect(screen.queryByText("pricing.popular")).toBeNull();
  });

  it("PLAN BEZ WŁASNYCH BENEFITÓW bierze je z warstwy - nigdy pusta lista", () => {
    renderWithQueryClient(
      <PlanCard
        plan={accessPlan({ features_pl: [], features_en: [] })}
        fallbackBenefits={["Dostęp do Decision Labs"]}
      />,
    );

    expect(screen.getByText("Dostęp do Decision Labs")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("własne benefity planu mają pierwszeństwo nad warstwowymi", () => {
    renderWithQueryClient(
      <PlanCard plan={accessPlan({ features_pl: ["Analizy"] })} fallbackBenefits={["Z warstwy"]} />,
    );

    expect(screen.getByText("Analizy")).toBeTruthy();
    expect(screen.queryByText("Z warstwy")).toBeNull();
  });

  it("okres próbny jest komunikowany liczbą dni z planu", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan({ trial_days: 14 })} />);

    expect(screen.getByText('pricing.trial {"count":14}')).toBeTruthy();
    expect(screen.queryByText('pricing.trial {"count":0}')).toBeNull();
  });

  it("PLAN JUŻ POSIADANY nie proponuje kupna - przycisk jest wyłączony", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan()} isCurrent />);

    const current = screen.getByText("pricing.current").closest("button");
    expect(current?.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("pricing.choose")).toBeNull();
  });

  it("plan do kupienia linkuje do kasy tego planu", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan()} />);

    expect(screen.getByText("pricing.choose").closest("a")?.getAttribute("href")).toBe(
      "/checkout/plan-member-monthly",
    );
  });

  it("karta zawsze linkuje do pełnego zakresu planu", () => {
    renderWithQueryClient(<PlanCard plan={accessPlan()} isCurrent />);

    expect(screen.getByText("pricing.planDetails.cta").closest("a")?.getAttribute("href")).toBe(
      "/plans/plan-member-monthly",
    );
  });
});

describe("HowPaymentsWorkCard", () => {
  it("wyjaśnia zasady płatności listą punktów, nie jednym blokiem tekstu", () => {
    renderWithQueryClient(<HowPaymentsWorkCard />);

    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(1);
    expect(screen.getByText("profile.planPage.howPayments.footnote")).toBeTruthy();
  });

  it("każdy punkt ma tytuł i treść (klucze i18n, nie tekst na sztywno)", () => {
    renderWithQueryClient(<HowPaymentsWorkCard />);

    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("profile.planPage.howPayments.points.");
    expect(items[0].textContent).toContain(".title");
  });
});
