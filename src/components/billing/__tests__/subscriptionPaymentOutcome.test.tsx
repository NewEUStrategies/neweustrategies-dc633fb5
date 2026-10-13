// Odrzucona dopłata w UI (SUB-04) i wspólna lista celów (SUB-14).
//
// Serwer zwraca odmowę dopłaty jako WYNIK (`{ error: "payment_failed",
// hostedInvoiceUrl }`), bo zmiana nie weszła, a klient ma konkretny krok -
// opłacić fakturę. Ten plik pilnuje, że karta:
//   - NIE ogłasza sukcesu („plan zmieniony" / „miejsca zaktualizowane"),
//   - pokazuje komunikat „zmiana nie weszła" zamiast ogólnej awarii,
//   - daje przycisk do faktury operatora (nowa karta przeglądarki),
//   - zmniejszenie miejsc ogłasza jako ZAPLANOWANE od nowego okresu,
//   - nie proponuje celu, którego serwer nie przyjmie (Zespół <-> indywidualny).
//
// Atrapa `sonner` zapisuje OBA argumenty toastu - w nich siedzi akcja z fakturą.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import {
  accessPlan,
  planLadder,
  providerSubscription,
  userSubscription,
} from "@/test/billing/fixtures";
import { ProviderCallError } from "@/lib/billing/providerResult";
import type { StripeSubscriptionRow } from "@/lib/billing/subscriptionQueries";

const HOSTED = "https://invoice.stripe.test/i/acct_1/inv_proration";

interface ToastAction {
  action?: { label: string; onClick: () => void };
}

const h = vi.hoisted(() => ({
  plans: { current: [] as unknown[] },
  changePlan: vi.fn(),
  changeMyPlan: vi.fn(),
  seats: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  opened: [] as string[],
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => "pl");
});

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSelectStub(react);
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-me" } } }),
}));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => "sandbox" }));

vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans.current),
  changeMySubscriptionPlan: (subscriptionId: string, planId: string) =>
    h.changeMyPlan(subscriptionId, planId),
}));

vi.mock("@/utils/payments.functions", () => ({
  changeStripePlan: (arg: unknown) => h.changePlan(arg),
  cancelStripeSubscription: () => Promise.resolve({ ok: true }),
  resumeStripeSubscription: () => Promise.resolve({ ok: true, mode: "cancellation_reverted" }),
  updateStripeSubscriptionSeats: (arg: unknown) => h.seats(arg),
  createStripePortalSession: () => Promise.resolve({ error: "no_customer" }),
  previewStripePlanChange: () => Promise.resolve(null),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string, options?: ToastAction) => h.toastError(m, options),
  },
}));

import { SubscriptionCard } from "@/components/billing/organisms/SubscriptionCard";
import { ChangePlanCard } from "@/components/billing/molecules/ChangePlanCard";

function renderProviderCard(overrides: Partial<StripeSubscriptionRow> = {}) {
  return renderWithQueryClient(<SubscriptionCard subscription={providerSubscription(overrides)} />);
}

async function awaitOptions(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
  return screen.getByRole("combobox");
}

/** Ostatni toast błędu: [komunikat, opcje]. */
function lastErrorToast(): [string, ToastAction | undefined] {
  return h.toastError.mock.calls.at(-1) as [string, ToastAction | undefined];
}

beforeEach(() => {
  h.plans.current = planLadder();
  h.changePlan.mockReset();
  h.changeMyPlan.mockReset();
  h.seats.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.opened.length = 0;
  vi.stubGlobal("open", (url: string) => {
    h.opened.push(url);
    return null;
  });
});

describe("karta operatora - odrzucona dopłata za wyższy plan", () => {
  it("NIE ogłasza zmiany planu, mówi „zmiana nie weszła” i daje link do faktury", async () => {
    h.changePlan.mockResolvedValue({ error: "payment_failed", hostedInvoiceUrl: HOSTED });
    renderProviderCard();
    fireEvent.change(await awaitOptions(), { target: { value: "pro_monthly" } });

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const [message, options] = lastErrorToast();
    expect(message).toBe("profile.subscription.payment.failed");
    expect(h.toastSuccess).not.toHaveBeenCalled();

    expect(options?.action?.label).toBe("profile.subscription.payment.payInvoice");
    options?.action?.onClick();
    expect(h.opened).toEqual([HOSTED]);
  });

  it("3DS ma własny komunikat - zmiana czeka na potwierdzenie", async () => {
    h.changePlan.mockResolvedValue({ error: "payment_requires_action", hostedInvoiceUrl: HOSTED });
    renderProviderCard();
    fireEvent.change(await awaitOptions(), { target: { value: "pro_monthly" } });

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() =>
      expect(lastErrorToast()[0]).toBe("profile.subscription.payment.requiresAction"),
    );
  });

  it("adres spoza https nie trafia do przycisku - odmowa bez akcji", async () => {
    h.changePlan.mockResolvedValue({
      error: "payment_failed",
      hostedInvoiceUrl: "javascript:alert(1)",
    });
    renderProviderCard();
    fireEvent.change(await awaitOptions(), { target: { value: "pro_monthly" } });

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(lastErrorToast()).toEqual(["profile.subscription.payment.failed", undefined]);
  });
});

describe("karta operatora - miejsca", () => {
  const teamSub = { price_id: "team_monthly_seat", quantity: 3 } as const;

  it("zmniejszenie miejsc ogłasza się jako ZAPLANOWANE od nowego okresu", async () => {
    h.seats.mockResolvedValue({ ok: true, quantity: 2, immediate: false, effect: "scheduled" });
    renderProviderCard(teamSub);

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label -1"));
    fireEvent.click(screen.getByText("profile.subscription.portal.seats.cta"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.seats.scheduled"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalledWith("profile.subscription.portal.seats.success");
  });

  it("odrzucona dopłata za dodatkowe miejsca nie melduje sukcesu", async () => {
    h.seats.mockResolvedValue({ error: "payment_failed", hostedInvoiceUrl: HOSTED });
    renderProviderCard(teamSub);

    fireEvent.click(screen.getByLabelText("profile.subscription.portal.seats.label +1"));
    fireEvent.click(screen.getByText("profile.subscription.portal.seats.cta"));

    await waitFor(() => expect(lastErrorToast()[0]).toBe("profile.subscription.payment.failed"));
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("lista celów planu Zespół nie proponuje planów indywidualnych (serwer by odmówił)", async () => {
    h.plans.current = [
      ...planLadder(),
      accessPlan({ id: "plan-team", tier_key: "team", name_pl: "Zespół", price_cents: 3900 }),
    ];
    renderProviderCard(teamSub);

    await waitFor(() => expect(screen.getByText("Zespół")).toBeTruthy());
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

describe("karta lokalna - odrzucona dopłata i downgrade od nowego okresu", () => {
  const renderLocal = () =>
    renderWithQueryClient(<ChangePlanCard subscription={userSubscription()} />);

  it("odmowa dopłaty z serwera (`ProviderCallError`) daje komunikat z fakturą, nie „plan zmieniony”", async () => {
    h.changeMyPlan.mockRejectedValue(new ProviderCallError("payment_failed", HOSTED));
    renderLocal();
    fireEvent.change(await awaitOptions(), { target: { value: "plan-pro-monthly" } });

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    const [message, options] = lastErrorToast();
    expect(message).toBe("profile.subscription.payment.failed");
    expect(options?.action?.label).toBe("profile.subscription.payment.payInvoice");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("downgrade zaplanowany od nowego okresu nie udaje natychmiastowej zmiany", async () => {
    h.changeMyPlan.mockResolvedValue({ effect: "scheduled" });
    renderLocal();
    fireEvent.change(await awaitOptions(), { target: { value: "plan-student-monthly" } });

    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.portal.downgradeScheduled"),
    );
  });

  it("lista celów karty lokalnej pomija plan Zespół dla subskrypcji indywidualnej", async () => {
    h.plans.current = [...planLadder(), accessPlan({ id: "plan-team", tier_key: "team" })];
    renderLocal();

    const select = await awaitOptions();
    const values = Array.from(select.querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(values).toContain("plan-pro-monthly");
    expect(values).not.toContain("plan-team");
  });
});
