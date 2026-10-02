// Tablica zmiany planu - ŻĄDANIE W LOCIE i cykle Partnera Biznesowego.
//
// Ryzyko pieniężne: tablica ma po przycisku na KAŻDY plan docelowy. Gdy jedna
// zmiana leci do operatora, klik w inny wiersz wysłałby DRUGĄ, równoległą
// zmianę - dwie proracje i niedeterministyczny plan końcowy. Dlatego w trakcie
// żądania zablokowane są wszystkie przyciski zmiany, nie tylko kliknięty.
//
// Drugie ryzyko: etykieta okresu. Partner Biznesowy ma cykl dwutygodniowy
// i kwartalny; podpisane jako „/mies." zaniżałyby albo zawyżały cenę.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { accessPlan, planLadder, userSubscription } from "@/test/billing/fixtures";
import { billingKeys } from "@/lib/billing/keys";

const h = vi.hoisted(() => ({
  plans: { current: [] as unknown[] },
  changePlan: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));

vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans.current),
  changeMySubscriptionPlan: (subscriptionId: string, planId: string) =>
    h.changePlan(subscriptionId, planId),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { PlanSwitchBoard } from "@/components/billing/molecules/PlanSwitchBoard";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const awaitBoard = () =>
  waitFor(() => expect(screen.getByText("profile.planPage.switchTitle")).toBeTruthy());

/** Przyciski ZMIANY planu (bez linków do szczegółów). */
const changeButtons = () =>
  [
    ...screen.queryAllByText("profile.planPage.upgradeCta"),
    ...screen.queryAllByText("profile.planPage.downgradeCta"),
  ].map((label) => label.closest("button")!);

const rowOf = (planName: string) => screen.getByText(planName).closest("li")!;

beforeEach(() => {
  h.plans.current = planLadder();
  h.changePlan.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("PlanSwitchBoard - cykle Partnera Biznesowego", () => {
  it("cykl dwutygodniowy i kwartalny mają własne etykiety okresu", async () => {
    h.plans.current = [
      accessPlan(),
      accessPlan({
        id: "plan-business-2w",
        tier_key: "business",
        interval: "two_weeks",
        name_pl: "Partner 2 tyg.",
      }),
      accessPlan({
        id: "plan-business-q",
        tier_key: "business",
        interval: "quarter",
        name_pl: "Partner kwartał",
      }),
    ];
    renderWithQueryClient(<PlanSwitchBoard subscription={userSubscription()} />);
    await awaitBoard();

    expect(rowOf("Partner 2 tyg.").textContent).toContain("pricing.perTwoWeeks");
    expect(rowOf("Partner 2 tyg.").textContent).not.toContain("pricing.perMonth");
    expect(rowOf("Partner kwartał").textContent).toContain("pricing.perQuarter");
    expect(rowOf("Partner kwartał").textContent).not.toContain("pricing.perMonth");
  });
});

describe("PlanSwitchBoard - żądanie w locie", () => {
  it("w trakcie jednej zmiany WSZYSTKIE przyciski zmiany są zablokowane", async () => {
    const pending = deferred();
    h.changePlan.mockReturnValue(pending.promise);
    renderWithQueryClient(<PlanSwitchBoard subscription={userSubscription()} />);
    await awaitBoard();
    expect(changeButtons()).toHaveLength(3);

    fireEvent.click(rowOf("Pro").querySelector("button")!);

    await waitFor(() => expect(changeButtons().every((b) => b.disabled)).toBe(true));
    // Postęp widać przy każdym przycisku zmiany - klient wie, że coś trwa.
    expect(changeButtons().every((b) => b.querySelector("svg.animate-spin"))).toBe(true);
    fireEvent.click(rowOf("Student").querySelector("button")!);
    expect(h.changePlan).toHaveBeenCalledTimes(1);
    expect(h.changePlan).toHaveBeenCalledWith("sub-1", "plan-pro-monthly");

    pending.resolve();
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.changePlan.success"),
    );
    await waitFor(() => expect(changeButtons().every((b) => !b.disabled)).toBe(true));
  });

  it("udana zmiana odświeża subskrypcję, warstwę dostępu i treść odblokowaną", async () => {
    const { queryClient } = renderWithQueryClient(
      <PlanSwitchBoard subscription={userSubscription()} />,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await awaitBoard();

    fireEvent.click(rowOf("Student").querySelector("button")!);

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    // Subskrypcja i warstwa dostępu - bez nich karta pokazuje stary plan.
    expect(keys).toContain(JSON.stringify(billingKeys.mySubscriptionAll()));
    expect(keys).toContain(JSON.stringify(billingKeys.currentTierAll()));
    // Zamówienia i dokumenty - prorata wystawia nową fakturę.
    expect(keys).toContain(JSON.stringify(billingKeys.myOrdersAll()));
    expect(keys).toContain(JSON.stringify(billingKeys.myBillingDocumentsAll()));
    // Treść odblokowana zależy od nowej warstwy.
    expect(keys).toContain(JSON.stringify(["public", "resolved"]));
    expect(keys).toContain(JSON.stringify(["unlocked-body"]));
    expect(h.changePlan).toHaveBeenCalledWith("sub-1", "plan-student-monthly");
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
