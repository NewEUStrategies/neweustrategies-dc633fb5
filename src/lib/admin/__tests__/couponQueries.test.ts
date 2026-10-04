// `invalidateCouponQueries` - co mutacja kuponu unieważnia, a czego NIE.
//
// Prawdziwy `QueryClient` z wpisami posianymi pod kluczami fabryk: asercja
// czyta `isInvalidated` każdego wpisu, czyli dokładnie to, co zdecyduje
// o odświeżeniu ekranu. Atrapa `invalidateQueries` sprawdzałaby tylko, z jakim
// argumentem ją zawołano - a nie, w które klucze ten argument faktycznie trafia.
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { ADMIN_COUPONS_KEY, invalidateCouponQueries } from "../couponQueries";
import {
  analyticsBiStripKey,
  analyticsCouponsKey,
  analyticsStatusKey,
} from "@/lib/analytics/queryKeys";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const OD = "2026-07-01T00:00:00.000Z";
const DO = "2026-10-01T00:00:00.000Z";

/** Klient z wpisami pod każdym kluczem, którego dotyczy (albo nie) mutacja kuponu. */
function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of [
    ADMIN_COUPONS_KEY,
    [...ADMIN_COUPONS_KEY, "plans"],
    [...ADMIN_COUPONS_KEY, "tiers"],
    analyticsCouponsKey(TENANT_A, OD, DO),
    analyticsCouponsKey(TENANT_A, null, null),
    analyticsCouponsKey(TENANT_B, OD, DO),
    analyticsStatusKey(TENANT_A),
    analyticsBiStripKey(TENANT_A, "vitals", 14),
    ["admin", "b2b-coupon-campaigns"],
  ]) {
    qc.setQueryData(key, { posiane: true });
  }
  return qc;
}

function invalidated(qc: QueryClient, key: readonly unknown[]): boolean | undefined {
  return qc.getQueryState(key)?.isInvalidated;
}

describe("invalidateCouponQueries - najemca ustalony", () => {
  it("unieważnia listę kuponów razem z katalogami planów i poziomów", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, ADMIN_COUPONS_KEY)).toBe(true);
    expect(invalidated(qc, [...ADMIN_COUPONS_KEY, "plans"])).toBe(true);
    expect(invalidated(qc, [...ADMIN_COUPONS_KEY, "tiers"])).toBe(true);
  });

  it("unieważnia analitykę kuponów SWOJEGO najemcy w KAŻDYM zapamiętanym zakresie dat", async () => {
    // Sedno poprawki: do 2026-10 ten wpis zostawał świeży po każdej mutacji.
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, analyticsCouponsKey(TENANT_A, OD, DO))).toBe(true);
    expect(invalidated(qc, analyticsCouponsKey(TENANT_A, null, null))).toBe(true);
  });

  it("NIE rusza analityki kuponów innego najemcy ani innych dziedzin analityki", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, TENANT_A);

    expect(invalidated(qc, analyticsCouponsKey(TENANT_B, OD, DO))).toBe(false);
    expect(invalidated(qc, analyticsStatusKey(TENANT_A))).toBe(false);
    expect(invalidated(qc, analyticsBiStripKey(TENANT_A, "vitals", 14))).toBe(false);
    // Kampanie mają własny cykl unieważniania - mutacja kuponu go nie dubluje.
    expect(invalidated(qc, ["admin", "b2b-coupon-campaigns"])).toBe(false);
  });
});

describe("invalidateCouponQueries - najemca nieustalony", () => {
  it("zapis się odbył, więc analityka i tak traci świeżość - po korzeniu, dla każdego najemcy", async () => {
    const qc = seeded();
    await invalidateCouponQueries(qc, null);

    expect(invalidated(qc, ADMIN_COUPONS_KEY)).toBe(true);
    expect(invalidated(qc, analyticsCouponsKey(TENANT_A, OD, DO))).toBe(true);
    expect(invalidated(qc, analyticsCouponsKey(TENANT_B, OD, DO))).toBe(true);
    // Korzeń jest nadmiarowy świadomie (patrz komentarz funkcji) - ale nie
    // sięga poza analitykę.
    expect(invalidated(qc, ["admin", "b2b-coupon-campaigns"])).toBe(false);
  });
});
