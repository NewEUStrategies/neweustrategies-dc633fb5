// Strażnik drugiej subskrypcji planu i jednorazowego triala (audyt SUB-13).
// Czysta reguła - ta sama w obu silnikach kasy, w sesji u operatora
// i w nakładce `/checkout/$planId`.
import { describe, expect, it } from "vitest";

import { catalogEntryByPriceId } from "@/lib/billing/catalog";
import {
  isLivePlanSubscriptionStatus,
  loadLocalPlanSubscriptionHistory,
  planPurchaseConflict,
  planSubscriptionHistory,
  visiblePlanPurchaseConflict,
} from "@/lib/billing/planSubscriptionGuard";
import { catalogSwitchRefusal } from "@/lib/billing/planSwitch";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";

const entry = (priceId: string) => {
  const found = catalogEntryByPriceId(priceId);
  if (!found) throw new Error(`test: brak pozycji katalogu ${priceId}`);
  return found;
};

const PRO = entry("pro_monthly");
const TEAM = entry("team_monthly_seat");

describe("planSubscriptionHistory", () => {
  it("statusy, w których subskrypcja nadal obciąża, blokują drugi zakup", () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) {
      expect(planSubscriptionHistory([{ status }]), status).toEqual({
        hasLive: true,
        hadAny: true,
        // Bez celu i bez ceny nie wiemy, co to za subskrypcja - fail-closed.
        conflict: "unmanaged",
      });
    }
  });

  // Ten przypadek siedział dawniej w pętli wyżej (`incomplete` = żywa) i
  // przybijał defekt #39: porzucone 3DS zamykało kasę na ~23 h z fałszywym
  // „Zmień plan" (zmiana planu odmawia subskrypcji `incomplete`).
  it("`incomplete` (porzucone 3DS) nie blokuje i nie zużywa triala - fakturę unieważnia kasa u operatora", () => {
    expect(
      planSubscriptionHistory([{ status: "incomplete", lookupKey: "pro_monthly" }], PRO),
    ).toEqual({ hasLive: false, hadAny: false, conflict: null });
    expect(isLivePlanSubscriptionStatus("incomplete")).toBe(false);
  });

  it("subskrypcja zakończona nie blokuje zakupu, ale zużyła trial", () => {
    expect(planSubscriptionHistory([{ status: "canceled" }])).toEqual({
      hasLive: false,
      hadAny: true,
      conflict: null,
    });
  });

  it("`incomplete_expired` (pierwsza płatność nigdy nie przeszła) nie zużywa triala", () => {
    expect(planSubscriptionHistory([{ status: "incomplete_expired" }])).toEqual({
      hasLive: false,
      hadAny: false,
      conflict: null,
    });
  });

  it("subskrypcje DAROWIZN są pomijane w całości", () => {
    expect(
      planSubscriptionHistory([
        { status: "active", purpose: "donation" },
        { status: "canceled", purpose: "donation" },
      ]),
    ).toEqual({ hasLive: false, hadAny: false, conflict: null });
  });

  it("brak historii = pierwszy zakup z trialem", () => {
    expect(planSubscriptionHistory([])).toEqual({ hasLive: false, hadAny: false, conflict: null });
    expect(isLivePlanSubscriptionStatus(null)).toBe(false);
    expect(isLivePlanSubscriptionStatus("canceled")).toBe(false);
  });
});

describe("konflikt zakupu z żywą subskrypcją = reguła zmiany planu (audyt #19)", () => {
  // DEFEKT: każda żywa subskrypcja odsyłała do „Zmień plan", także przy
  // zakupie, który zmiana planu odrzuca (`plan_kind_mismatch` = „wymaga
  // nowego zakupu") - Pro -> Zespół było ślepym zaułkiem aż do końca okresu.
  it("Pro -> Zespół (za miejsce): OSOBNY zakup, bez blokady - ale bez triala", () => {
    expect(catalogSwitchRefusal(PRO, TEAM)).toBe("plan_kind_mismatch");
    expect(planPurchaseConflict("pro_monthly", TEAM)).toBeNull();
    expect(planSubscriptionHistory([{ status: "active", lookupKey: "pro_monthly" }], TEAM)).toEqual(
      { hasLive: false, hadAny: true, conflict: null },
    );
  });

  it("Zespół -> plan indywidualny: tak samo osobny zakup", () => {
    expect(planPurchaseConflict("team_monthly_seat", entry("plus_monthly"))).toBeNull();
  });

  it("Pro -> Partner Biznesowy (ten sam model): blokada i ścieżka zmiany planu", () => {
    const business = entry("business_monthly");
    expect(catalogSwitchRefusal(PRO, business)).toBeNull();
    expect(
      planSubscriptionHistory([{ status: "active", lookupKey: "pro_monthly" }], business),
    ).toEqual({ hasLive: true, hadAny: true, conflict: "change_plan" });
  });

  it("ten sam plan: blokada i zarządzanie subskrypcją (miejsca, rezygnacja)", () => {
    expect(planPurchaseConflict("pro_monthly", PRO)).toBe("same_plan");
    expect(planPurchaseConflict("team_monthly_seat", TEAM)).toBe("same_plan");
  });

  it("cena spoza katalogu, pozycja jednorazowa albo brak celu: blokada fail-closed (portal)", () => {
    expect(planPurchaseConflict("legacy_price_xyz", PRO)).toBe("unmanaged");
    expect(planPurchaseConflict(null, PRO)).toBe("unmanaged");
    expect(planPurchaseConflict("decision_lab_seat", PRO)).toBe("unmanaged");
    expect(planPurchaseConflict("pro_monthly", null)).toBe("unmanaged");
  });

  it("cel niecykliczny (cena nowej subskrypcji w alarmie duplikatu) - blokada fail-closed", () => {
    // Kasa nie podaje tu pozycji jednorazowej, ale alarm duplikatu podaje cenę
    // NOWEJ subskrypcji - a miejsce Decision Labu bywało ceną cykliczną. Zmiana
    // planu na taki cel nie istnieje, więc to nie jest „osobny zakup” (null).
    const decisionLab = entry("decision_lab_seat");
    expect(catalogSwitchRefusal(PRO, decisionLab)).toBe("plan_not_switchable");
    expect(planPurchaseConflict("pro_monthly", decisionLab)).toBe("unmanaged");
    expect(planPurchaseConflict("team_monthly_seat", decisionLab)).toBe("unmanaged");
  });

  it("kolejność subskrypcji nie zmienia komunikatu: wygrywa najtwardsza blokada", () => {
    // pro_annual -> pro_monthly to zmiana planu, pro_monthly -> pro_monthly to ten
    // sam plan, a cena spoza katalogu to portal operatora (najtwardsze).
    const changePlan = { status: "active", lookupKey: "pro_annual" };
    const samePlan = { status: "past_due", lookupKey: "pro_monthly" };
    const unmanaged = { status: "paused", lookupKey: "legacy_price_xyz" };

    for (const records of [
      [changePlan, samePlan],
      [samePlan, changePlan],
    ]) {
      expect(planSubscriptionHistory(records, PRO)).toEqual({
        hasLive: true,
        hadAny: true,
        conflict: "same_plan",
      });
    }
    for (const records of [
      [unmanaged, samePlan, changePlan],
      [changePlan, unmanaged, samePlan],
      [samePlan, changePlan, unmanaged],
    ]) {
      expect(planSubscriptionHistory(records, PRO).conflict).toBe("unmanaged");
    }
  });

  it("dwie subskrypcje: komunikat mówi o najtwardszej blokadzie", () => {
    expect(
      planSubscriptionHistory(
        [
          { status: "active", lookupKey: "team_monthly_seat" },
          { status: "active", lookupKey: "pro_monthly" },
        ],
        PRO,
      ),
    ).toEqual({ hasLive: true, hadAny: true, conflict: "same_plan" });
  });

  it("nakładka liczy tę samą relację z najnowszego wiersza lustra", () => {
    expect(visiblePlanPurchaseConflict({ status: "active", price_id: "pro_monthly" }, TEAM)).toBe(
      null,
    );
    expect(
      visiblePlanPurchaseConflict(
        { status: "trialing", price_id: "pro_monthly" },
        entry("pro_annual"),
      ),
    ).toBe("change_plan");
    expect(
      visiblePlanPurchaseConflict({ status: "incomplete", price_id: "pro_monthly" }, PRO),
    ).toBe(null);
    expect(visiblePlanPurchaseConflict(null, PRO)).toBeNull();
  });
});

describe("loadLocalPlanSubscriptionHistory", () => {
  it("czyta lustro dla konta z sesji i środowiska zamówienia", async () => {
    const chain = supabaseFromStub();
    chain.setResponse("subscriptions", ok([{ status: "canceled", price_id: "pro_monthly" }]));
    const client = { from: (table: string) => chain.from(table) };

    const history = await loadLocalPlanSubscriptionHistory(client as never, {
      userId: "user-1",
      environment: "live",
      target: PRO,
    });

    expect(history).toEqual({ hasLive: false, hadAny: true, conflict: null });
    const subscriptions = chain.lastChain("subscriptions");
    expect(subscriptions?.calls.find((c) => c.method === "select")?.args[0]).toBe(
      "status, price_id",
    );
    expect(subscriptions?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["user_id", "user-1"],
      ["environment", "live"],
    ]);
  });

  it("relację liczy po `price_id` lustra (lookup_key) względem kupowanej pozycji", async () => {
    const chain = supabaseFromStub();
    chain.setResponse("subscriptions", ok([{ status: "active", price_id: "pro_monthly" }]));
    const client = { from: (table: string) => chain.from(table) };

    const forTeam = await loadLocalPlanSubscriptionHistory(client as never, {
      userId: "u",
      environment: "live",
      target: TEAM,
    });
    const forPro = await loadLocalPlanSubscriptionHistory(client as never, {
      userId: "u",
      environment: "live",
      target: PRO,
    });

    expect(forTeam).toEqual({ hasLive: false, hadAny: true, conflict: null });
    expect(forPro).toEqual({ hasLive: true, hadAny: true, conflict: "same_plan" });
  });

  it("błąd odczytu RZUCA - „nie wiem” nie może znaczyć „brak subskrypcji”", async () => {
    const chain = supabaseFromStub();
    chain.setResponse("subscriptions", fail("connection reset"));
    const client = { from: (table: string) => chain.from(table) };

    await expect(
      loadLocalPlanSubscriptionHistory(client as never, {
        userId: "u",
        environment: "sandbox",
        target: PRO,
      }),
    ).rejects.toThrow("subscription history lookup failed: connection reset");
  });
});
