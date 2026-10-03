// Samoobsługowa zmiana planu (subskrypcja lokalna) - ŻĄDANIE W LOCIE i okres
// kwartalny.
//
// Ryzyko pieniężne: zmiana planu rozlicza się u operatora od razu (upgrade
// z proracją). Drugi klik w trakcie pierwszego żądania to DRUGA zmiana planu
// i druga faktura proporcjonalna - przycisk musi być zablokowany do odpowiedzi
// serwera, a po sukcesie wybór ma się wyczyścić, żeby kolejny klik nie powtórzył
// zmiany „z rozpędu".
//
// Drugie ryzyko: etykieta okresu rozliczeniowego. Plan kwartalny opisany jako
// „/mies." oznaczałby trzykrotnie zaniżoną cenę na ekranie wyboru.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { accessPlan, moneyPattern, planLadder, userSubscription } from "@/test/billing/fixtures";

const h = vi.hoisted(() => ({
  plans: { current: [] as unknown[] },
  changePlan: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => (await import("@/test/reactStubs")).reactI18nextStub());

vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);

vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans.current),
  changeMySubscriptionPlan: (subscriptionId: string, planId: string) =>
    h.changePlan(subscriptionId, planId),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { ChangePlanCard } from "@/components/billing/molecules/ChangePlanCard";

/** Obietnica sterowana z testu - żądanie „wisi", dopóki test go nie rozwiąże. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function awaitTargets(): Promise<HTMLSelectElement> {
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
  return screen.getByRole("combobox") as HTMLSelectElement;
}

const cta = () => screen.getByText("profile.subscription.changePlan.cta").closest("button")!;

beforeEach(() => {
  h.plans.current = planLadder();
  h.changePlan.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("ChangePlanCard - okres kwartalny", () => {
  it("plan kwartalny ma etykietę „za kwartał”, nie miesięczną", async () => {
    h.plans.current = [
      accessPlan(),
      accessPlan({
        id: "plan-business-quarterly",
        tier_key: "business",
        interval: "quarter",
        name_pl: "Partner kwartalnie",
        price_cents: 299900,
      }),
    ];
    renderWithQueryClient(<ChangePlanCard subscription={userSubscription()} />);
    await awaitTargets();

    const option = screen.getByRole("option", { name: /Partner kwartalnie/ });
    expect(option.textContent).toContain("pricing.perQuarter");
    expect(option.textContent).not.toContain("pricing.perMonth");
    expect(option.textContent).toMatch(moneyPattern(299900));
  });
});

describe("ChangePlanCard - żądanie w locie", () => {
  it("w trakcie zmiany przycisk jest zablokowany i pokazuje postęp - drugi klik nic nie wysyła", async () => {
    const pending = deferred();
    h.changePlan.mockReturnValue(pending.promise);
    renderWithQueryClient(<ChangePlanCard subscription={userSubscription()} />);
    const select = await awaitTargets();

    fireEvent.change(select, { target: { value: "plan-pro-monthly" } });
    fireEvent.click(cta());

    await waitFor(() => expect(cta()).toBeDisabled());
    expect(cta().querySelector("svg.animate-spin")).not.toBeNull();
    fireEvent.click(cta());
    expect(h.changePlan).toHaveBeenCalledTimes(1);

    pending.resolve();
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.changePlan.success"),
    );
  });

  it("po udanej zmianie wybór się czyści - kolejny klik nie powtórzy zmiany", async () => {
    renderWithQueryClient(<ChangePlanCard subscription={userSubscription()} />);
    const select = await awaitTargets();

    fireEvent.change(select, { target: { value: "plan-pro-annual" } });
    fireEvent.click(cta());

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledTimes(1));
    // Najpierw czekamy, aż żądanie się ZAKOŃCZY (spinner znika). Dopiero wtedy
    // zablokowany przycisk dowodzi wyczyszczonego wyboru, a nie trwającego żądania.
    await waitFor(() => expect(cta().querySelector("svg.animate-spin")).toBeNull());
    expect(cta()).toBeDisabled();
    // Ponowny klik „z rozpędu" po sukcesie nie wysyła drugiej zmiany planu.
    fireEvent.click(cta());
    expect(h.changePlan).toHaveBeenCalledWith("sub-1", "plan-pro-annual");
    expect(h.changePlan).toHaveBeenCalledTimes(1);
  });
});
