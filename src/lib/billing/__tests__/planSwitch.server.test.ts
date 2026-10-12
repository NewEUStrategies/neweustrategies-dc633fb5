// Serwerowa bramka celu zmiany planu (SUB-14) - jedna dla karty operatora
// (lookup_key) i karty lokalnej (id planu).
//
// KRYTERIUM: odmowa planu spoza oferty. Zanim bramka powstała, `changeStripePlan`
// przyjmował każdy lookup_key z katalogu - plan wyłączony w najemcy, plan
// innego najemcy, `decision_lab_seat`, przejście z Zespołu na plan
// indywidualny. Testy pilnują, że:
//   - najemca pochodzi z PROFILU wołającego (sesja), nie z ładunku ani hosta,
//   - plan musi być aktywny W TYM najemcy, cykliczny i mieć ŚCISŁY
//     odpowiednik (tier, interwał) w katalogu,
//   - reguła jest tą samą funkcją, którą UI filtruje listę celów.
//
// GRANICA ATRAPOWANA: rola serwisowa Supabase. Reguła planu (`planSwitch.ts`)
// i katalog jadą PRAWDZIWE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessPlan, planLadder } from "@/test/billing/fixtures";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

let admin: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => admin.from(table) },
}));

import { resolveOfferedSwitchTarget } from "@/lib/billing/planSwitch.server";

const USER = "user-z-sesji";
const TENANT = "tenant-wolajacego";

/** Plany oferty najemcy w kształcie wiersza `access_plans`. */
const offer = () => planLadder().map((plan) => ({ ...plan, tenant_id: TENANT }));

beforeEach(() => {
  admin = supabaseFromStub();
  admin.setResponse("profiles", ok({ tenant_id: TENANT }));
  admin.setResponse("access_plans", (query) =>
    query.has("maybeSingle")
      ? ok(offer().find((p) => p.id === query.argsOf("eq")?.[1]) ?? null)
      : ok(offer()),
  );
});

const byLookup = (lookupKey: string, currentLookupKey: string | null = "plus_monthly") =>
  resolveOfferedSwitchTarget({
    userId: USER,
    subscriptionTenantId: TENANT,
    currentLookupKey,
    target: { lookupKey },
  });

describe("resolveOfferedSwitchTarget - najemca z sesji", () => {
  it("czyta najemcę z profilu WOŁAJĄCEGO i zawęża ofertę do niego", async () => {
    const result = await byLookup("pro_monthly");

    expect(result).toEqual({
      ok: true,
      target: {
        planId: "plan-pro-monthly",
        tenantId: TENANT,
        interval: "month",
        lookupKey: "pro_monthly",
      },
    });
    expect(admin.chainsFor("profiles").at(0)?.argsOf("eq")).toEqual(["id", USER]);
    const plans = admin.chainsFor("access_plans").at(0);
    expect(plans?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["active", true],
    ]);
    // Ta sama kolejność co lista w UI - pierwszy z duplikatów wygrywa po obu stronach.
    expect(plans?.argsOf("order")).toEqual(["sort_order", { ascending: true }]);
  });

  it("wołający bez najemcy w profilu jest odmową fail-closed", async () => {
    admin.setResponse("profiles", ok(null));

    await expect(byLookup("pro_monthly")).rejects.toThrow("No tenant for current user");
    expect(admin.chainsFor("access_plans")).toHaveLength(0);
  });

  it("subskrypcja z innego najemcy niż sesja nie przełącza się w ogóle", async () => {
    const result = await resolveOfferedSwitchTarget({
      userId: USER,
      subscriptionTenantId: "tenant-obcy",
      currentLookupKey: "plus_monthly",
      target: { lookupKey: "pro_monthly" },
    });

    expect(result).toEqual({ ok: false, error: "plan_not_found" });
    expect(admin.chainsFor("access_plans")).toHaveLength(0);
  });

  it("plan INNEGO najemcy (zwrócony mimo filtra) nie przechodzi - zamek jest też w kodzie", async () => {
    admin.setResponse("access_plans", ok(offer().map((p) => ({ ...p, tenant_id: "tenant-obcy" }))));

    expect(await byLookup("pro_monthly")).toEqual({ ok: false, error: "plan_not_found" });
  });

  it("BŁĄD odczytu oferty jest zgłaszany, nie zamieniany na pustą ofertę", async () => {
    admin.setResponse("access_plans", fail("permission denied"));

    await expect(byLookup("pro_monthly")).rejects.toThrow("permission denied");
  });
});

describe("resolveOfferedSwitchTarget - cele spoza oferty (KRYTERIUM SUB-14)", () => {
  it("plan wyłączony w najemcy: brak w ofercie", async () => {
    admin.setResponse("access_plans", ok(offer().filter((p) => p.tier_key !== "pro")));

    expect(await byLookup("pro_monthly")).toEqual({ ok: false, error: "plan_not_found" });
  });

  it("plan zwrócony jako nieaktywny też nie przechodzi (reguła planu, nie tylko filtr)", async () => {
    admin.setResponse(
      "access_plans",
      ok(offer().map((p) => (p.tier_key === "pro" ? { ...p, active: false } : p))),
    );

    expect(await byLookup("pro_monthly")).toEqual({ ok: false, error: "plan_not_found" });
  });

  it("`decision_lab_seat` (pozycja jednorazowa) nie jest celem zmiany subskrypcji", async () => {
    expect(await byLookup("decision_lab_seat")).toEqual({
      ok: false,
      error: "plan_not_switchable",
    });
    expect(admin.chainsFor("access_plans")).toHaveLength(0);
  });

  it("lookup_key spoza katalogu jest odmową bez czytania oferty", async () => {
    expect(await byLookup("ghost_plan")).toEqual({ ok: false, error: "plan_not_switchable" });
  });

  it("Zespół (za miejsce) z planu indywidualnego to inny model rozliczenia - odmowa", async () => {
    admin.setResponse(
      "access_plans",
      ok([...offer(), { ...accessPlan({ id: "plan-team", tier_key: "team" }), tenant_id: TENANT }]),
    );

    expect(await byLookup("team_monthly_seat")).toEqual({
      ok: false,
      error: "plan_kind_mismatch",
    });
  });

  it("ten sam plan co bieżący jest odmową `same_plan`", async () => {
    expect(await byLookup("plus_monthly")).toEqual({ ok: false, error: "same_plan" });
  });

  it("plan o interwale bez ŚCISŁEGO odpowiednika nie dostaje ceny z innego cyklu", async () => {
    // `catalogPriceForPlan` dałby tu `business_2w` (fallback na pierwszą cenę
    // tieru) - klient wybrałby plan roczny, a operator obciążałby co dwa tygodnie.
    admin.setResponse(
      "access_plans",
      ok({
        ...accessPlan({ id: "plan-biz-year", tier_key: "business", interval: "year" }),
        tenant_id: TENANT,
      }),
    );

    const result = await resolveOfferedSwitchTarget({
      userId: USER,
      subscriptionTenantId: TENANT,
      currentLookupKey: "plus_monthly",
      target: { planId: "plan-biz-year" },
    });

    expect(result).toEqual({ ok: false, error: "plan_not_switchable" });
  });

  it("student: kasa nie weryfikuje dziś uprawnienia do stawki, więc zmiana też nie - bramki są RÓWNE", async () => {
    // Świadomie utrwalone: zmiana planu nie może być ani furtką obok kasy, ani
    // ostrzejsza od niej. Gdy weryfikacja powstanie, wejdzie do `planSwitchRefusal`.
    expect(await byLookup("student_monthly")).toMatchObject({
      ok: true,
      target: { lookupKey: "student_monthly" },
    });
  });
});

describe("resolveOfferedSwitchTarget - cel wskazany id planu (karta lokalna)", () => {
  const byPlan = (planId: string) =>
    resolveOfferedSwitchTarget({
      userId: USER,
      subscriptionTenantId: TENANT,
      currentLookupKey: "plus_monthly",
      target: { planId },
    });

  it("plan z oferty najemcy sesji przechodzi z lookup_key ŚCISŁEGO odpowiednika", async () => {
    expect(await byPlan("plan-pro-annual")).toEqual({
      ok: true,
      target: {
        planId: "plan-pro-annual",
        tenantId: TENANT,
        interval: "year",
        lookupKey: "pro_annual",
      },
    });
    const query = admin.chainsFor("access_plans").at(0);
    expect(query?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", "plan-pro-annual"],
      ["tenant_id", TENANT],
    ]);
  });

  it("nieistniejący (albo cudzy - filtr najemcy) plan to `plan_not_found`", async () => {
    expect(await byPlan("plan-widmo")).toEqual({ ok: false, error: "plan_not_found" });
  });
});
