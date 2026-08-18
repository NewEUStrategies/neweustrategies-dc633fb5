// Sekcja zarządzania subskrypcją - ORGANIZM spinający całą obsługę
// posprzedażową (/profile/subscription i /profile/membership). 0 z 7 funkcji
// pokrytych do 18.08.2026.
//
// Karty potomne są tu ATRAPAMI i to jest celowe: organizm nie ma własnej
// prezentacji do sprawdzania, ma DECYDOWAĆ, co się pokazuje i PRZEKAZYWAĆ
// intencje. Testy potomków stoją w ich własnych plikach.
//
// Cztery decyzje, które ten plik pilnuje:
//
//   1. SUBSKRYPCJA U OPERATORA WYPIERA WŁASNĄ KARTĘ. Dwie karty naraz
//      pokazywałyby sprzeczne akcje (nasze anulowanie obok portalowego).
//   2. NADANIE ZASTĘPUJE „BRAK SUBSKRYPCJI". Klient z dożywotnim VIP-em ma
//      widzieć swój realny poziom dostępu, nie pustkę - ale nadanie WYGASŁE
//      już nie, bo wtedy pustka jest prawdą.
//   3. WZNOWIENIE MA SENS TYLKO W OPŁACONYM OKRESIE. Po jego końcu potrzebny
//      jest nowy checkout, więc przycisk musi zniknąć.
//   4. REZYGNACJA IDZIE PRZEZ PRZEPŁYW RETENCYJNY, nie prosto z przycisku.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  isoFuture,
  isoPast,
  membershipGrant,
  moneyPattern,
  paymentOrder,
  providerSubscription,
  userSubscription,
} from "@/test/billing/fixtures";
import type { MembershipGrantRow } from "@/lib/billing/membership";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";
import type { PaymentOrder, UserSubscriptionRow } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  subscription: { current: null as UserSubscriptionRow | null },
  orders: { current: [] as PaymentOrder[] },
  grants: { current: [] as MembershipGrantRow[] },
  providerSub: { current: null as StripeSubscriptionRow | null },
  tier: { current: null as { key: string; name_pl: string; name_en: string } | null },
  cancel: vi.fn(),
  resume: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  retentionProps: [] as Array<{ open: boolean; subscriptionId: string }>,
  confirmCancel: { current: null as null | (() => Promise<void> | void) },
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

vi.mock("@/lib/billing/queries", () => ({
  fetchMySubscription: () => Promise.resolve(h.subscription.current),
  fetchMyOrders: () => Promise.resolve(h.orders.current),
  cancelMySubscription: (id: string) => h.cancel(id),
  resumeMySubscription: (id: string) => h.resume(id),
}));

vi.mock("@/lib/billing/membership", () => ({
  useMyGrants: () => ({ data: h.grants.current }),
}));

vi.mock("@/lib/billing/tiers", () => ({
  useCurrentTier: () => ({ data: h.tier.current }),
  tierName: (tier: { name_pl: string; name_en: string }, lang: string) =>
    lang === "en" ? tier.name_en : tier.name_pl,
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

// --- atrapy kart potomnych ---------------------------------------------------

vi.mock("@/components/billing/SubscriptionCard", () => ({
  useMySubscriptionProvider: () => ({ data: h.providerSub.current }),
  SubscriptionCard: () => <div data-testid="karta-operatora" />,
}));

vi.mock("@/components/billing/ChangePlanCard", () => ({
  ChangePlanCard: () => <div data-testid="karta-zmiany-planu" />,
}));

vi.mock("@/components/billing/CustomerPortalButton", () => ({
  CustomerPortalButton: () => <button type="button">portal</button>,
}));

vi.mock("@/components/billing/SyncBillingButton", () => ({
  SyncBillingButton: () => <button type="button">synchronizacja</button>,
}));

vi.mock("@/components/billing/LifetimeAccessCard", () => ({
  LifetimeAccessCard: () => <div data-testid="karta-dozywotnia" />,
}));

// Atrapa dialogu retencyjnego wystawia dwa fakty: CZY jest otwarty i z jakim
// identyfikatorem, oraz przycisk odpalający `onConfirmCancel` - dzięki temu
// test dochodzi do skutku rezygnacji bez przechodzenia przez trzy kroki UI
// (te ma własny plik testowy).
vi.mock("@/components/billing/RetentionDialog", () => ({
  RetentionDialog: (props: {
    open: boolean;
    subscriptionId: string;
    onConfirmCancel: () => Promise<void> | void;
  }) => {
    h.retentionProps.push({ open: props.open, subscriptionId: props.subscriptionId });
    h.confirmCancel.current = props.onConfirmCancel;
    return props.open ? (
      <button type="button" onClick={() => void props.onConfirmCancel()}>
        potwierdz-rezygnacje
      </button>
    ) : null;
  },
}));

import { SubscriptionManagerSection } from "@/components/billing/SubscriptionManagerSection";

const render = () => renderWithQueryClient(<SubscriptionManagerSection />);
const lastRetention = () => h.retentionProps.at(-1);

beforeEach(() => {
  h.lang.current = "pl";
  h.subscription.current = null;
  h.orders.current = [];
  h.grants.current = [];
  h.providerSub.current = null;
  h.tier.current = null;
  h.cancel.mockReset().mockResolvedValue(undefined);
  h.resume.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.retentionProps.length = 0;
  h.confirmCancel.current = null;
});

describe("SubscriptionManagerSection - który ekran", () => {
  it("subskrypcja u operatora wypiera własną kartę", async () => {
    h.providerSub.current = providerSubscription();
    render();

    await waitFor(() => expect(screen.getByTestId("karta-operatora")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.title")).toBeNull();
  });

  it("bez subskrypcji i bez nadania mówi wprost, że planu nie ma", async () => {
    render();

    await waitFor(() => expect(screen.getByText("profile.subscription.none")).toBeTruthy());
    expect(screen.getByText("profile.overview.seePlans")).toBeTruthy();
  });

  it("brak planu daje ratunek na spóźniony webhook (synchronizacja)", async () => {
    render();

    await waitFor(() => expect(screen.getByText("synchronizacja")).toBeTruthy());
    expect(screen.getByText("profile.subscription.none")).toBeTruthy();
  });

  it("AKTYWNE NADANIE zastępuje komunikat o braku subskrypcji", async () => {
    h.grants.current = [membershipGrant({ tier_key: "member" })];
    render();

    await waitFor(() => expect(screen.getByText("MEMBER")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.none")).toBeNull();
  });

  it("nadanie bezterminowe pokazuje się jako dożywotnie", async () => {
    h.grants.current = [membershipGrant({ expires_at: null })];
    render();

    await waitFor(() => expect(screen.getByText("profile.planPage.grantLifetime")).toBeTruthy());
    expect(screen.getByText("MEMBER")).toBeTruthy();
  });

  it("NADANIE WYGASŁE nie udaje dostępu - wraca komunikat o braku planu", async () => {
    h.grants.current = [membershipGrant({ expires_at: isoPast(1) })];
    render();

    await waitFor(() => expect(screen.getByText("profile.subscription.none")).toBeTruthy());
    expect(screen.queryByText("MEMBER")).toBeNull();
  });

  it("nadanie odwołane też nie daje dostępu", async () => {
    h.grants.current = [membershipGrant({ revoked_at: isoPast(1) })];
    render();

    await waitFor(() => expect(screen.getByText("profile.subscription.none")).toBeTruthy());
    expect(screen.queryByText("MEMBER")).toBeNull();
  });

  it("warstwa członkostwa pokazuje się jako odznaka, gdy RPC ją zna", async () => {
    h.tier.current = { key: "member", name_pl: "Członek", name_en: "Member" };
    h.subscription.current = userSubscription();
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.getByText("profile.subscription.title")).toBeTruthy();
  });
});

describe("SubscriptionManagerSection - dane aktywnej subskrypcji", () => {
  beforeEach(() => {
    h.subscription.current = userSubscription();
  });

  it("pokazuje nazwę planu, kwotę i status", async () => {
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.getByText(moneyPattern(4900))).toBeTruthy();
    expect(screen.getByText("profile.status.active")).toBeTruthy();
  });

  it("aktywna subskrypcja ma etykietę odnowienia, nie wygaśnięcia", async () => {
    render();

    await waitFor(() => expect(screen.getByText("profile.subscription.renewsAt")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.cancelsAt")).toBeNull();
  });

  it("zaplanowane anulowanie zmienia etykietę daty na wygaśnięcie", async () => {
    h.subscription.current = userSubscription({ canceled_at: isoPast(1) });
    render();

    await waitFor(() => expect(screen.getByText("profile.subscription.cancelsAt")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.renewsAt")).toBeNull();
  });

  it("linkuje do szczegółów planu", async () => {
    render();

    await waitFor(() => expect(screen.getByText("pricing.planDetails.cta")).toBeTruthy());
    expect(screen.getByText("pricing.planDetails.cta").closest("a")?.getAttribute("href")).toBe(
      "/plans/plan-member-monthly",
    );
  });

  it("STATUS OSTATNIEJ PŁATNOŚCI wyjaśnia, dlaczego dostęp może nie działać", async () => {
    h.orders.current = [paymentOrder({ status: "failed", amount_cents: 4900 })];
    render();

    await waitFor(() => expect(screen.getByText("profile.status.failed")).toBeTruthy());
    expect(screen.getByText("profile.subscription.paymentStatus")).toBeTruthy();
  });

  it("bez zamówień paska płatności nie ma", async () => {
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.paymentStatus")).toBeNull();
  });

  it("kwota ostatniej płatności idzie z zamówienia, nie z ceny planu", async () => {
    h.orders.current = [paymentOrder({ amount_cents: 12300, currency: "PLN" })];
    render();

    await waitFor(() => expect(screen.getByText(moneyPattern(12300))).toBeTruthy());
    expect(screen.getByText("profile.status.paid")).toBeTruthy();
  });
});

describe("SubscriptionManagerSection - wznowienie", () => {
  it("wznowienie jest możliwe, dopóki opłacony okres trwa", async () => {
    h.subscription.current = userSubscription({
      canceled_at: isoPast(1),
      current_period_end: isoFuture(10),
    });
    render();

    await waitFor(() => expect(screen.getByText("profile.subscription.resume")).toBeTruthy());
    expect(screen.getByText(/profile\.subscription\.accessUntil/)).toBeTruthy();
  });

  it("PO WYGAŚNIĘCIU OKRESU nie ma czego wznawiać - potrzebny nowy checkout", async () => {
    h.subscription.current = userSubscription({
      canceled_at: isoPast(40),
      current_period_end: isoPast(10),
    });
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.resume")).toBeNull();
  });

  it("wznowienie wysyła identyfikator subskrypcji i potwierdza", async () => {
    h.subscription.current = userSubscription({
      canceled_at: isoPast(1),
      current_period_end: isoFuture(10),
    });
    render();
    await waitFor(() => expect(screen.getByText("profile.subscription.resume")).toBeTruthy());

    fireEvent.click(screen.getByText("profile.subscription.resume"));

    await waitFor(() => expect(h.resume).toHaveBeenCalledWith("sub-1"));
    expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.resumed");
  });

  it("nieudane wznowienie daje błąd i NIE ogłasza sukcesu", async () => {
    h.resume.mockRejectedValue(new Error("odmowa"));
    h.subscription.current = userSubscription({
      canceled_at: isoPast(1),
      current_period_end: isoFuture(10),
    });
    render();
    await waitFor(() => expect(screen.getByText("profile.subscription.resume")).toBeTruthy());

    fireEvent.click(screen.getByText("profile.subscription.resume"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.resumeError"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("SubscriptionManagerSection - rezygnacja przez przepływ retencyjny", () => {
  beforeEach(() => {
    h.subscription.current = userSubscription();
  });

  it("przycisk rezygnacji OTWIERA dialog retencyjny, a nie anuluje od razu", async () => {
    render();
    await waitFor(() => expect(screen.getByText("profile.subscription.cancel")).toBeTruthy());

    fireEvent.click(screen.getByText("profile.subscription.cancel"));

    await waitFor(() => expect(lastRetention()?.open).toBe(true));
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("dialog dostaje identyfikator TEJ subskrypcji", async () => {
    render();
    await waitFor(() => expect(screen.getByText("profile.subscription.cancel")).toBeTruthy());

    fireEvent.click(screen.getByText("profile.subscription.cancel"));

    await waitFor(() => expect(lastRetention()?.subscriptionId).toBe("sub-1"));
    expect(lastRetention()?.open).toBe(true);
  });

  it("potwierdzona rezygnacja wysyła żądanie i odświeża subskrypcję", async () => {
    const { queryClient } = render();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(screen.getByText("profile.subscription.cancel")).toBeTruthy());
    fireEvent.click(screen.getByText("profile.subscription.cancel"));
    await waitFor(() => expect(screen.getByText("potwierdz-rezygnacje")).toBeTruthy());

    fireEvent.click(screen.getByText("potwierdz-rezygnacje"));

    await waitFor(() => expect(h.cancel).toHaveBeenCalledWith("sub-1"));
    expect(invalidate).toHaveBeenCalled();
  });

  it("subskrypcja już anulowana nie proponuje rezygnacji ponownie", async () => {
    h.subscription.current = userSubscription({ canceled_at: isoPast(1) });
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByText("profile.subscription.cancel")).toBeNull();
    expect(h.retentionProps).toHaveLength(0);
  });
});

describe("SubscriptionManagerSection - karty dodatkowe", () => {
  it("karta dostępu dożywotniego jest zawsze w składzie (sama decyduje, czy się pokaże)", async () => {
    render();

    await waitFor(() => expect(screen.getByTestId("karta-dozywotnia")).toBeTruthy());
  });

  it("zmiana planu pojawia się tylko przy aktywnej subskrypcji w opłaconym okresie", async () => {
    h.subscription.current = userSubscription();
    render();

    await waitFor(() => expect(screen.getByTestId("karta-zmiany-planu")).toBeTruthy());
  });

  it("po wygaśnięciu okresu karty zmiany planu nie ma", async () => {
    h.subscription.current = userSubscription({ current_period_end: isoPast(1) });
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByTestId("karta-zmiany-planu")).toBeNull();
  });

  it("subskrypcja wygasła (status) też nie dopuszcza zmiany planu", async () => {
    h.subscription.current = userSubscription({ status: "expired" });
    render();

    await waitFor(() => expect(screen.getByText("Członek")).toBeTruthy());
    expect(screen.queryByTestId("karta-zmiany-planu")).toBeNull();
  });
});
