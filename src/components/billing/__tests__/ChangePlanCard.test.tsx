// Samoobsługowa zmiana planu na subskrypcji LOKALNEJ (`user_subscriptions`) -
// 0 z 9 funkcji pokrytych do 18.08.2026.
//
// Karta jest cicha, gdy nie ma czego zmieniać (`return null`), i to jest
// zachowanie warte testu: pusta karta „zmień plan" bez ani jednego celu
// wygląda jak awaria, a nie jak brak opcji.
//
// Dwie rzeczy, które ten plik pilnuje szczególnie:
//
//   1. CELE TO WYŁĄCZNIE PLANY CYKLICZNE. Plan jednorazowy (`one_time`) nie
//      jest ścieżką zmiany subskrypcji - wybranie go skończyłoby się błędem
//      serwera, więc nie ma prawa pojawić się na liście.
//   2. UNIEWAŻNIENIA CACHE'U SĄ CZĘŚCIĄ SKUTKU. Po zmianie planu odświeżyć się
//      musi nie tylko subskrypcja, ale też warstwa dostępu, zamówienia,
//      dokumenty i treść odblokowana - inaczej klient płaci za wyższy plan
//      i dalej widzi paywall.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { accessPlan, moneyPattern, planLadder, userSubscription } from "@/test/billing/fixtures";
import type { UserSubscriptionRow } from "@/lib/billing/types";

const h = vi.hoisted(() => ({
  lang: { current: "pl" },
  plans: { current: [] as unknown[] },
  changePlan: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const stubs = await import("@/test/reactStubs");
  return stubs.reactI18nextStub(() => h.lang.current);
});

vi.mock("@/components/ui/select", async () => {
  const react = await import("react");
  const stubs = await import("@/test/reactStubs");
  return stubs.radixSelectStub(react);
});

vi.mock("@/lib/billing/queries", () => ({
  fetchActivePlans: () => Promise.resolve(h.plans.current),
  changeMySubscriptionPlan: (subscriptionId: string, planId: string) =>
    h.changePlan(subscriptionId, planId),
}));

vi.mock("sonner", () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import { ChangePlanCard } from "@/components/billing/ChangePlanCard";

function renderCard(overrides: Partial<UserSubscriptionRow> = {}) {
  return renderWithQueryClient(<ChangePlanCard subscription={userSubscription(overrides)} />);
}

/** Czeka na WCZYTANE cele - `<select>` istnieje dopiero z niepustą listą. */
async function awaitTargets(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));
  return screen.getByRole("combobox");
}

beforeEach(() => {
  h.lang.current = "pl";
  h.plans.current = planLadder();
  h.changePlan.mockReset().mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("ChangePlanCard - kiedy karta w ogóle istnieje", () => {
  it("bez planów do wyboru karta się nie renderuje", async () => {
    h.plans.current = [];
    const { container } = renderCard();

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByText("profile.subscription.changePlan.title")).toBeNull();
  });

  it("gdy jedyny aktywny plan to plan bieżący, karta też milczy", async () => {
    h.plans.current = [accessPlan()];
    const { container } = renderCard();

    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("z celami pokazuje nagłówek i podpowiedź", async () => {
    renderCard();

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.changePlan.title")).toBeTruthy(),
    );
    expect(screen.getByText("profile.subscription.changePlan.hint")).toBeTruthy();
  });
});

describe("ChangePlanCard - lista celów", () => {
  it("pomija plan bieżący", async () => {
    const select = await (renderCard(), awaitTargets());

    const values = Array.from(select.querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(values).not.toContain("plan-member-monthly");
    expect(values).toContain("plan-pro-monthly");
  });

  it("POMIJA PLAN JEDNORAZOWY - to nie jest ścieżka zmiany subskrypcji", async () => {
    h.plans.current = [
      ...planLadder(),
      accessPlan({ id: "plan-once", interval: "one_time", name_pl: "Jednorazowy" }),
    ];
    renderCard();
    const select = await awaitTargets();

    const values = Array.from(select.querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(values).not.toContain("plan-once");
    expect(screen.queryByText(/Jednorazowy/)).toBeNull();
  });

  it("etykieta celu zawiera nazwę, kwotę i okres rozliczeniowy", async () => {
    renderCard();
    await awaitTargets();

    const annual = screen.getByRole("option", { name: /Pro rocznie/ });
    expect(annual.textContent).toMatch(moneyPattern(99900));
    expect(annual.textContent).toContain("pricing.perYear");
  });

  it("okres dwutygodniowy ma własny klucz, nie miesięczny", async () => {
    h.plans.current = [
      accessPlan(),
      accessPlan({ id: "plan-biz-2w", tier_key: "business", interval: "two_weeks" }),
    ];
    renderCard();
    await awaitTargets();

    expect(screen.getByRole("option", { name: /pricing\.perTwoWeeks/ })).toBeTruthy();
  });

  it("nazwy celów idą za językiem interfejsu", async () => {
    h.lang.current = "en";
    renderCard();
    await awaitTargets();

    expect(screen.getByRole("option", { name: /Pro yearly/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Pro rocznie/ })).toBeNull();
  });
});

describe("ChangePlanCard - wykonanie zmiany", () => {
  it("bez wyboru przycisk jest wyłączony i nic nie wysyła", async () => {
    renderCard();
    await awaitTargets();

    const cta = screen.getByText("profile.subscription.changePlan.cta").closest("button");
    expect(cta?.hasAttribute("disabled")).toBe(true);
    expect(h.changePlan).not.toHaveBeenCalled();
  });

  it("wysyła identyfikator subskrypcji i wybranego planu", async () => {
    renderCard();
    const select = await awaitTargets();

    fireEvent.change(select, { target: { value: "plan-pro-monthly" } });
    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() => expect(h.changePlan).toHaveBeenCalledTimes(1));
    expect(h.changePlan).toHaveBeenCalledWith("sub-1", "plan-pro-monthly");
  });

  it("po sukcesie ODŚWIEŻA także warstwę dostępu i treść odblokowaną", async () => {
    const { queryClient } = renderCard();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const select = await awaitTargets();

    fireEvent.change(select, { target: { value: "plan-pro-monthly" } });
    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("profile.subscription.changePlan.success"),
    );
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(keys.some((key) => key.includes("unlocked-body"))).toBe(true);
    expect(keys.some((key) => key.includes("public"))).toBe(true);
  });

  it("nieudana zmiana daje komunikat błędu i NIE ogłasza sukcesu", async () => {
    h.changePlan.mockRejectedValue(new Error("provider odmówił"));
    renderCard();
    const select = await awaitTargets();

    fireEvent.change(select, { target: { value: "plan-pro-monthly" } });
    fireEvent.click(screen.getByText("profile.subscription.changePlan.cta"));

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("profile.subscription.changePlan.error"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("subskrypcja z zaplanowanym anulowaniem dostaje notę o skutku zmiany", async () => {
    renderCard({ canceled_at: "2026-08-01T00:00:00.000Z" });

    await waitFor(() =>
      expect(screen.getByText("profile.subscription.changePlan.cancelNote")).toBeTruthy(),
    );
    expect(screen.getByText("profile.subscription.changePlan.title")).toBeTruthy();
  });

  it("bez zaplanowanego anulowania noty nie ma", async () => {
    renderCard();

    await awaitTargets();
    expect(screen.queryByText("profile.subscription.changePlan.cancelNote")).toBeNull();
  });
});
