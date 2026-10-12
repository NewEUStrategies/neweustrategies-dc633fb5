// Strażnik drugiej subskrypcji planu i jednorazowego triala (audyt SUB-13).
// Czysta reguła - ta sama w obu silnikach kasy, w sesji u operatora
// i w nakładce `/checkout/$planId`.
import { describe, expect, it } from "vitest";

import {
  isLivePlanSubscriptionStatus,
  loadLocalPlanSubscriptionHistory,
  mergePlanSubscriptionHistory,
  planSubscriptionHistory,
} from "@/lib/billing/planSubscriptionGuard";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

describe("planSubscriptionHistory", () => {
  it("statusy, w których subskrypcja nadal obciąża, blokują drugi zakup", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
      expect(planSubscriptionHistory([{ status }]), status).toEqual({
        hasLive: true,
        hadAny: true,
      });
    }
  });

  it("subskrypcja zakończona nie blokuje zakupu, ale zużyła trial", () => {
    expect(planSubscriptionHistory([{ status: "canceled" }])).toEqual({
      hasLive: false,
      hadAny: true,
    });
  });

  it("`incomplete_expired` (pierwsza płatność nigdy nie przeszła) nie zużywa triala", () => {
    expect(planSubscriptionHistory([{ status: "incomplete_expired" }])).toEqual({
      hasLive: false,
      hadAny: false,
    });
  });

  it("subskrypcje DAROWIZN są pomijane w całości", () => {
    expect(
      planSubscriptionHistory([
        { status: "active", purpose: "donation" },
        { status: "canceled", purpose: "donation" },
      ]),
    ).toEqual({ hasLive: false, hadAny: false });
  });

  it("brak historii = pierwszy zakup z trialem", () => {
    expect(planSubscriptionHistory([])).toEqual({ hasLive: false, hadAny: false });
    expect(isLivePlanSubscriptionStatus(null)).toBe(false);
    expect(isLivePlanSubscriptionStatus("canceled")).toBe(false);
  });

  it("ślad w którymkolwiek źródle (lustro albo operator) wystarcza", () => {
    expect(
      mergePlanSubscriptionHistory(
        { hasLive: false, hadAny: true },
        { hasLive: false, hadAny: false },
      ),
    ).toEqual({ hasLive: false, hadAny: true });
  });
});

describe("loadLocalPlanSubscriptionHistory", () => {
  it("czyta lustro dla konta z sesji i środowiska zamówienia", async () => {
    const chain = supabaseFromStub();
    chain.setResponse("subscriptions", ok([{ status: "canceled" }]));
    const client = { from: (table: string) => chain.from(table) };

    const history = await loadLocalPlanSubscriptionHistory(client as never, {
      userId: "user-1",
      environment: "live",
    });

    expect(history).toEqual({ hasLive: false, hadAny: true });
    expect(
      chain
        .lastChain("subscriptions")
        ?.calls.filter((c) => c.method === "eq")
        .map((c) => c.args),
    ).toEqual([
      ["user_id", "user-1"],
      ["environment", "live"],
    ]);
  });

  it("błąd odczytu RZUCA - „nie wiem” nie może znaczyć „brak subskrypcji”", async () => {
    const chain = supabaseFromStub();
    chain.setResponse("subscriptions", fail("connection reset"));
    const client = { from: (table: string) => chain.from(table) };

    await expect(
      loadLocalPlanSubscriptionHistory(client as never, { userId: "u", environment: "sandbox" }),
    ).rejects.toThrow("subscription history lookup failed: connection reset");
  });
});
