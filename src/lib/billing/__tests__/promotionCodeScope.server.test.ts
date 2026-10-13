// OCENA KODÓW PROMOCYJNYCH OPERATORA (`promotionCodeScope.server`, S8).
//
// Reguły pinowane tutaj (realizacja zamówienia ma własne testy skutków):
//   * pusta lista nie dotyka ani operatora, ani bazy (nasz kupon jedzie bez kodu);
//   * kod obcego najemcy wygrywa z kodem spoza zakresu - to cięższy przypadek;
//   * kod operatora bez najemcy przechodzi, ale zostaje policzony;
//   * kupon z bazy czytamy WYŁĄCZNIE w najemcy zamówienia, a identyfikator
//     o złym kształcie nie trafia do zapytania (22P02 wywracałby webhook
//     w nieskończonej pętli ponowień);
//   * każdy błąd odczytu RZUCA (zdarzenie wróci).
//
// Atrapy na granicach: klient operatora i klient roli serwisowej.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  codes: {} as Record<string, Record<string, string> | Error>,
  retrieved: [] as string[],
  envs: [] as string[],
  db: null as SupabaseFromStub | null,
}));

vi.mock("@/lib/stripe.server", () => ({
  getStripeClient: async (env: string) => {
    h.envs.push(env);
    return {
      promotionCodes: {
        retrieve: async (id: string) => {
          h.retrieved.push(id);
          const metadata = h.codes[id];
          if (metadata instanceof Error) throw metadata;
          if (!metadata) throw new Error(`test: nieznany kod ${id}`);
          return { id, metadata };
        },
      },
    };
  },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));

import { reviewPromotionCodes } from "@/lib/billing/promotionCodeScope.server";

const TENANT = "tenant-alfa";
const COUPON = "88888888-aaaa-4aaa-8aaa-888888888888";
const ORDER = { id: "order-1", tenantId: TENANT, planId: "plan_annual", eventId: null };

beforeEach(() => {
  h.codes = {};
  h.retrieved.length = 0;
  h.envs.length = 0;
  h.db = supabaseFromStub();
  h.db.setResponse("b2b_coupons", ok(null));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reviewPromotionCodes", () => {
  it.each([
    ["null", null],
    ["pusta lista", []],
    ["same białe znaki", ["  "]],
  ])("%s: bez pytania operatora i bazy", async (_label, ids) => {
    expect(await reviewPromotionCodes("live", ids, ORDER)).toEqual({
      hold: null,
      unscopedIds: [],
    });
    expect(h.envs).toHaveLength(0);
    expect(h.db?.chains).toHaveLength(0);
  });

  it("powtórzony identyfikator czytany raz, w środowisku zdarzenia", async () => {
    h.codes["promo_a"] = {};

    await reviewPromotionCodes("sandbox", ["promo_a", " promo_a "], ORDER);

    expect(h.retrieved).toEqual(["promo_a"]);
    expect(h.envs).toEqual(["sandbox"]);
  });

  it("kod obcego najemcy wygrywa z kodem spoza zakresu", async () => {
    h.codes["promo_obcy"] = { tenant_id: "tenant-beta" };
    h.codes["promo_waski"] = { tenant_id: TENANT, coupon_id: COUPON };
    h.db?.setResponse(
      "b2b_coupons",
      ok({ id: COUPON, active: true, plan_ids: ["plan_monthly"], event_ids: [] }),
    );

    const review = await reviewPromotionCodes("live", ["promo_waski", "promo_obcy"], ORDER);

    expect(review.hold).toEqual({
      reason: "foreign_promotion_code",
      promotionCodeIds: ["promo_obcy"],
    });
  });

  it("zamówienie bez najemcy nie przyjmie kodu żadnego najemcy", async () => {
    h.codes["promo_a"] = { tenant_id: TENANT };

    const review = await reviewPromotionCodes("live", ["promo_a"], { ...ORDER, tenantId: null });

    expect(review.hold?.reason).toBe("foreign_promotion_code");
  });

  it("kod najemcy bez kuponu z bazy przechodzi bez zapytania; kod operatora jest liczony", async () => {
    h.codes["promo_najemcy"] = { tenant_id: TENANT };
    h.codes["promo_operatora"] = {};

    const review = await reviewPromotionCodes("live", ["promo_najemcy", "promo_operatora"], ORDER);

    expect(review).toEqual({ hold: null, unscopedIds: ["promo_operatora"] });
    expect(h.db?.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("identyfikator kuponu o złym kształcie: poza zakresem, bez zapytania do bazy", async () => {
    h.codes["promo_a"] = { tenant_id: TENANT, coupon_id: "nie-uuid" };

    const review = await reviewPromotionCodes("live", ["promo_a"], ORDER);

    expect(review.hold?.reason).toBe("promotion_code_out_of_scope");
    expect(h.db?.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("kupon czytany w najemcy zamówienia; plan na liście = w zakresie", async () => {
    h.codes["promo_a"] = { tenant_id: TENANT, coupon_id: COUPON };
    h.db?.setResponse(
      "b2b_coupons",
      ok({ id: COUPON, active: true, plan_ids: ["plan_annual"], event_ids: [] }),
    );

    expect((await reviewPromotionCodes("live", ["promo_a"], ORDER)).hold).toBeNull();
    const lookup = h.db?.lastChain("b2b_coupons");
    expect(lookup?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", COUPON],
      ["tenant_id", TENANT],
    ]);
  });

  it("awaria operatora i awaria bazy RZUCAJĄ", async () => {
    h.codes["promo_x"] = new Error("timeout");
    await expect(reviewPromotionCodes("live", ["promo_x"], ORDER)).rejects.toThrow(
      "promotion code scope: lookup failed (promo_x): timeout",
    );

    h.codes["promo_y"] = { tenant_id: TENANT, coupon_id: COUPON };
    h.db?.setResponse("b2b_coupons", fail("permission denied"));
    await expect(reviewPromotionCodes("live", ["promo_y"], ORDER)).rejects.toThrow(
      `promotion code scope: coupon lookup failed (${COUPON}): permission denied`,
    );
  });
});
