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

import {
  fail,
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type TableResponder,
} from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  // `null` = kod bez metadanych (typ operatora: `metadata: Metadata | null`);
  // `{ thrown }` = operator rzuca wartością spoza klasy `Error`.
  codes: {} as Record<string, Record<string, string> | Error | null | { thrown: unknown }>,
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
          if (!(id in h.codes)) throw new Error(`test: nieznany kod ${id}`);
          const metadata = h.codes[id];
          if (metadata instanceof Error) throw metadata;
          if (metadata && "thrown" in metadata) throw metadata.thrown;
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

import {
  isPromotionHoldReason,
  reviewPromotionCodes,
} from "@/lib/billing/promotionCodeScope.server";

const TENANT = "tenant-alfa";
const COUPON = "88888888-aaaa-4aaa-8aaa-888888888888";
const ORDER = { id: "order-1", tenantId: TENANT, planId: "plan_annual", eventId: null };
const EVENT = "event-gala";

/** Wiersz `b2b_coupons` w kształcie odczytu oceny zakresu. */
function couponRow(over: Partial<Record<"active" | "plan_ids" | "event_ids", unknown>> = {}) {
  return { id: COUPON, active: true, plan_ids: [], event_ids: [], ...over };
}

/**
 * Baza, w której kupon żyje w JEDNYM najemcy: wiersz wraca tylko zapytaniu bez
 * filtra najemcy albo z filtrem tego najemcy - jak prawdziwe `.eq("tenant_id")`.
 */
function couponOnlyIn(tenant: string, row: ReturnType<typeof couponRow>): TableResponder {
  return (chain) => {
    const filter = chain.calls.find((c) => c.method === "eq" && c.args[0] === "tenant_id");
    return ok(!filter || filter.args[1] === tenant ? row : null);
  };
}

beforeEach(() => {
  h.codes = {};
  h.retrieved.length = 0;
  h.envs.length = 0;
  h.db = supabaseFromStub();
  h.db.setResponse("b2b_coupons", ok(null));
  vi.spyOn(console, "error")
    .mockImplementation(() => {})
    .mockClear();
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

  // Kształt sprawdzany na CAŁYM identyfikatorze: UUID z doklejonym znakiem
  // to dla Postgresa nadal 22P02, więc nie może dojść do zapytania.
  it.each([["nie-uuid"], [`${COUPON}x`], [`x${COUPON}`]])(
    "identyfikator kuponu o złym kształcie (%s): poza zakresem, bez zapytania do bazy",
    async (couponId) => {
      h.codes["promo_a"] = { tenant_id: TENANT, coupon_id: couponId };

      const review = await reviewPromotionCodes("live", ["promo_a"], ORDER);

      expect(review.hold?.reason).toBe("promotion_code_out_of_scope");
      expect(h.db?.chainsFor("b2b_coupons")).toHaveLength(0);
    },
  );

  it("kupon czytany w najemcy zamówienia; plan na liście = w zakresie", async () => {
    h.codes["promo_a"] = { tenant_id: TENANT, coupon_id: COUPON };
    h.db?.setResponse(
      "b2b_coupons",
      ok({ id: COUPON, active: true, plan_ids: ["plan_annual"], event_ids: [] }),
    );

    expect((await reviewPromotionCodes("live", ["promo_a"], ORDER)).hold).toBeNull();
    const lookup = h.db?.lastChain("b2b_coupons");
    // Bez `active` w odczycie każdy kod najemcy byłby wstrzymany jako
    // „kupon wyłączony", bez `event_ids` - kod wydarzenia przechodziłby na planie.
    expect(lookup?.argsOf("select")).toEqual(["id, active, plan_ids, event_ids"]);
    expect(lookup?.has("maybeSingle")).toBe(true);
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

  it("kod bez metadanych (`metadata: null` u operatora) to kod operatora: przechodzi, jest liczony", async () => {
    h.codes["promo_bez_metadanych"] = null;

    expect(await reviewPromotionCodes("live", ["promo_bez_metadanych"], ORDER)).toEqual({
      hold: null,
      unscopedIds: ["promo_bez_metadanych"],
    });
    expect(h.db?.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("operator rzuca wartością spoza klasy `Error`: wyjątek niesie jej treść", async () => {
    h.codes["promo_x"] = { thrown: "socket hang up" };

    await expect(reviewPromotionCodes("live", ["promo_x"], ORDER)).rejects.toThrow(
      "promotion code scope: lookup failed (promo_x): socket hang up",
    );
  });

  it.each([
    ["plan zamówienia spoza listy planów kuponu", couponRow({ plan_ids: ["plan_monthly"] }), ORDER],
    [
      "kupon planowy na zamówieniu bez planu",
      couponRow({ plan_ids: ["plan_annual"] }),
      { ...ORDER, planId: null },
    ],
    ["kupon wyłączony po synchronizacji", couponRow({ active: false }), ORDER],
    [
      "kupon tylko w innym najemcy (metadane kodu wskazują najemcę zamówienia)",
      couponOnlyIn("tenant-beta", couponRow()),
      ORDER,
    ],
    ["kupon wydarzenia na zamówieniu planu", couponRow({ event_ids: [EVENT] }), ORDER],
    [
      "kupon wydarzenia na bilet innego wydarzenia",
      couponRow({ event_ids: [EVENT] }),
      { ...ORDER, planId: null, eventId: "event-inne" },
    ],
  ])("%s: wstrzymanie `promotion_code_out_of_scope`", async (_label, row, order) => {
    h.codes["promo_a"] = { tenant_id: TENANT, coupon_id: COUPON };
    h.codes["promo_operatora"] = {};
    h.db?.setResponse("b2b_coupons", typeof row === "function" ? row : ok(row));

    const review = await reviewPromotionCodes("live", ["promo_a", "promo_operatora"], order);

    expect(review).toEqual({
      hold: { reason: "promotion_code_out_of_scope", promotionCodeIds: ["promo_a"] },
      unscopedIds: ["promo_operatora"],
    });
    // Ślad dla operatora z identyfikatorem zamówienia - bez niego wstrzymanie
    // nie ma czego szukać w logach.
    expect(console.error).toHaveBeenCalledWith(
      "[payments] promotion code outside order scope",
      "order-1",
      review.hold,
    );
  });

  it.each([
    ["kupon ogólny (bez zawężeń)", couponRow(), ORDER],
    [
      "kupon wydarzenia na bilet tego wydarzenia",
      couponRow({ event_ids: [EVENT] }),
      { ...ORDER, planId: null, eventId: EVENT },
    ],
    [
      "kupon planu i wydarzenia na bilet z planem z listy",
      couponRow({ plan_ids: ["plan_annual"], event_ids: [EVENT] }),
      { ...ORDER, eventId: EVENT },
    ],
  ])("%s: w zakresie, bez wstrzymania i bez śladu w logu", async (_label, row, order) => {
    h.codes["promo_a"] = { tenant_id: TENANT, coupon_id: COUPON };
    h.db?.setResponse("b2b_coupons", ok(row));

    expect(await reviewPromotionCodes("live", ["promo_a"], order)).toEqual({
      hold: null,
      unscopedIds: [],
    });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("isPromotionHoldReason (powtórka realizacji czyta zapisaną decyzję)", () => {
  it("wstrzymują wyłącznie dwa powody kodu promocyjnego", () => {
    expect(isPromotionHoldReason("foreign_promotion_code")).toBe(true);
    expect(isPromotionHoldReason("promotion_code_out_of_scope")).toBe(true);
  });

  it.each([["amount_mismatch"], ["promotion_code_unscoped"], [""], [null], [undefined], [42]])(
    "%s nie jest powodem wstrzymania z kodu",
    (value) => {
      expect(isPromotionHoldReason(value)).toBe(false);
    },
  );
});
