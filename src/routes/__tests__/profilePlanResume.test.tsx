// `/profile/plan` - akcja WZNOWIENIA (S2, P12).
//
// Mail o rezygnacji prowadzi na „Mój plan" z obietnicą „wznów przed końcem
// okresu", a strona nie miała przycisku. Teraz:
//   * zaplanowany koniec u operatora (lustro `subscriptions`) -> przycisk,
//     który woła wznowienie operatora (odmowa NIE melduje sukcesu);
//   * bez lustra: lokalne `canceled_at` przy trwającym okresie -> wznowienie
//     lokalnej subskrypcji;
//   * okres już minął albo nic nie jest zaplanowane -> brak przycisku.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  subscription: null as Record<string, unknown> | null,
  provider: null as Record<string, unknown> | null,
  resumeStripe: vi.fn(),
  resumeLocal: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } }, isAdmin: false }),
}));
vi.mock("@/lib/stripe", () => ({ getStripeEnvironmentSafe: () => "live" }));
vi.mock("@/lib/billing/queries", () => ({
  fetchMySubscription: () => Promise.resolve(h.subscription),
  resumeMySubscription: (id: string) => h.resumeLocal(id),
}));
vi.mock("@/lib/billing/subscriptionQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/subscriptionQueries")>()),
  fetchMyStripeSubscription: () => Promise.resolve(h.provider),
}));
vi.mock("@/lib/billing/membership", () => ({ useMyGrants: () => ({ data: [] }) }));
vi.mock("@/lib/billing/tiers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/tiers")>()),
  useCurrentTier: () => ({ data: null }),
}));
vi.mock("@/utils/payments.functions", () => ({
  getStripeRenewalCharge: () => Promise.resolve({ amountCents: null, currency: null }),
  resumeStripeSubscription: (arg: unknown) => h.resumeStripe(arg),
}));
vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));
for (const [path, name] of [
  ["@/components/billing/organisms/SubscriptionStatusCard", "SubscriptionStatusCard"],
  ["@/components/billing/organisms/PaymentHistoryCard", "PaymentHistoryCard"],
  ["@/components/billing/molecules/PlanSwitchBoard", "PlanSwitchBoard"],
  ["@/components/billing/molecules/CustomerPortalButton", "CustomerPortalButton"],
  ["@/components/billing/molecules/SyncBillingButton", "SyncBillingButton"],
  ["@/components/billing/molecules/LifetimeAccessCard", "LifetimeAccessCard"],
] as const) {
  vi.doMock(path, () => ({ [name]: () => <div data-testid={name} /> }));
}

const { renderRoute } = await import("@/test/routeHarness");
const { Route: ProfilePlanRoute } = await import("@/routes/profile.plan");

const NOW = new Date("2026-08-21T10:00:00.000Z");
const FUTURE = "2026-09-21T10:00:00.000Z";
const PAST = "2026-08-01T10:00:00.000Z";

function mount() {
  return renderRoute({
    route: ProfilePlanRoute,
    path: "/profile/plan",
    initialEntry: "/profile/plan",
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  h.subscription = null;
  h.provider = null;
  h.resumeStripe.mockReset().mockResolvedValue({ ok: true, mode: "cancellation_reverted" });
  h.resumeLocal.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("/profile/plan - wznowienie (P12)", () => {
  it("zaplanowany koniec u operatora: przycisk woła wznowienie OPERATORA i potwierdza", async () => {
    h.provider = {
      id: "s1",
      status: "active",
      cancel_at_period_end: true,
      current_period_end: FUTURE,
    };
    await mount();
    const button = await screen.findByText("profile.planPage.resume.cta");
    fireEvent.click(button);
    await waitFor(() =>
      expect(h.resumeStripe).toHaveBeenCalledWith({ data: { environment: "live" } }),
    );
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.resumed"),
    );
    expect(h.resumeLocal).not.toHaveBeenCalled();
  });

  it("odmowa operatora NIE melduje wznowienia", async () => {
    h.provider = {
      id: "s1",
      status: "active",
      cancel_at_period_end: true,
      current_period_end: FUTURE,
    };
    h.resumeStripe.mockResolvedValue({ error: "subscription_update_failed" });
    await mount();
    fireEvent.click(await screen.findByText("profile.planPage.resume.cta"));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("bez lustra: lokalne `canceled_at` w trwającym okresie wznawia lokalną subskrypcję", async () => {
    h.subscription = {
      id: "local-1",
      status: "active",
      canceled_at: PAST,
      current_period_end: FUTURE,
      plan: null,
    };
    await mount();
    fireEvent.click(await screen.findByText("profile.planPage.resume.cta"));
    await waitFor(() => expect(h.resumeLocal).toHaveBeenCalledWith("local-1"));
  });

  it("okres minął albo nic nie jest zaplanowane: brak przycisku", async () => {
    h.subscription = {
      id: "local-1",
      status: "active",
      canceled_at: PAST,
      current_period_end: PAST,
      plan: null,
    };
    await mount();
    await waitFor(() => expect(screen.getByTestId("SubscriptionStatusCard")).toBeTruthy());
    expect(screen.queryByTestId("plan-resume")).toBeNull();

    h.provider = {
      id: "s1",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: FUTURE,
    };
    h.subscription = null;
    await mount();
    await waitFor(() =>
      expect(screen.getAllByTestId("SubscriptionStatusCard").length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("plan-resume")).toBeNull();
  });
});
