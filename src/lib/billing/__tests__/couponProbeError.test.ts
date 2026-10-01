// Odmowa limitu prób kodów (`rate_limited: ...`) czytana jednym słownikiem
// po obu stronach (`isCodeProbeRateLimited`, `codeProbeRpcError` w coupons.ts).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW: odmowa limitu z bazy wraca jako zwykła awaria
// albo - gorzej - jako odmowa KODU, po której kasa zdejmuje kod z pamięci
// i płaci pełną cenę.
import { describe, expect, it } from "vitest";
import {
  codeProbeRpcError,
  isCodeProbeRateLimited,
  parseCouponVerdict,
} from "@/lib/billing/coupons";

const DB_MESSAGE = "rate_limited: too many code attempts, try again later";

describe("isCodeProbeRateLimited", () => {
  it("rozpoznaje błąd PostgREST (obiekt z message), Error i napis", () => {
    expect(isCodeProbeRateLimited({ message: DB_MESSAGE, code: "P0001" })).toBe(true);
    expect(isCodeProbeRateLimited(new Error(DB_MESSAGE))).toBe(true);
    expect(isCodeProbeRateLimited(DB_MESSAGE)).toBe(true);
    expect(isCodeProbeRateLimited("  RATE_LIMITED: x")).toBe(true);
  });

  it("nie myli innych awarii z limitem", () => {
    expect(isCodeProbeRateLimited(new Error("permission denied for function"))).toBe(false);
    expect(isCodeProbeRateLimited({ message: 42 })).toBe(false);
    expect(isCodeProbeRateLimited(null)).toBe(false);
    expect(isCodeProbeRateLimited(undefined)).toBe(false);
    expect(isCodeProbeRateLimited(7)).toBe(false);
  });
});

describe("codeProbeRpcError", () => {
  it("odmowę limitu zamienia na Error ze stałą treścią, bez pól PostgREST", () => {
    const out = codeProbeRpcError({ message: DB_MESSAGE, hint: "wewnętrzny", details: "x" });

    expect(out).toBeInstanceOf(Error);
    expect(out).toMatchObject({ message: DB_MESSAGE });
    expect(out).not.toHaveProperty("hint");
  });

  it("każdy inny błąd wraca BEZ ZMIAN", () => {
    const other = { message: "deadlock detected", code: "40P01" };
    expect(codeProbeRpcError(other)).toBe(other);
  });
});

// Werdykt walidatora kodu czytany z odpowiedzi RPC (`parseCouponVerdict`).
//
// CO PSUJE SIĘ BEZ TYCH TESTÓW: od 20261001100000 walidator oddaje JEDEN obiekt
// jsonb, a przed migracją - zbiór wierszy. Czytnik, który zna tylko jeden
// kształt, w oknie wdrożenia widzi „brak werdyktu" przy każdym ważnym kodzie
// (klient płaci pełną cenę) albo - gorzej - bierze pół-sukces bez `coupon_id`
// za rabat i daje obniżkę, której baza nie przypisała do żadnego kuponu.
describe("parseCouponVerdict", () => {
  const SUCCESS = {
    ok: true,
    error: null,
    coupon_id: "11111111-1111-4111-8111-111111111111",
    discount_cents: 500,
    final_cents: 4500,
    label: "-10%",
    discount_kind: "percent",
    discount_percent: 10,
  };

  const PARSED_SUCCESS = {
    ok: true,
    error: null,
    coupon_id: "11111111-1111-4111-8111-111111111111",
    discount_cents: 500,
    final_cents: 4500,
    label: "-10%",
    discount_kind: "percent",
    discount_percent: 10,
  };

  it("czyta NOWY kształt: jeden obiekt jsonb (wynik skalarny po migracji)", () => {
    expect(parseCouponVerdict(SUCCESS)).toEqual(PARSED_SUCCESS);
  });

  it("czyta DAWNY kształt: zbiór wierszy, bierze pierwszy (okno wdrożenia)", () => {
    expect(parseCouponVerdict([SUCCESS])).toEqual(PARSED_SUCCESS);
  });

  it("brak odpowiedzi albo kształt nie-obiektowy to BRAK werdyktu, nie odmowa", () => {
    // Pusta tablica, null i napis nie mówią nic o kodzie - wołający traktuje
    // je jak `not_found`. Tablica w tablicy to nie wiersz, tylko zepsuty
    // kształt: nie wolno jej „rozpakować" o kolejny poziom.
    expect(parseCouponVerdict([])).toBeNull();
    expect(parseCouponVerdict(null)).toBeNull();
    expect(parseCouponVerdict(undefined)).toBeNull();
    expect(parseCouponVerdict("ok")).toBeNull();
    expect(parseCouponVerdict([[SUCCESS]])).toBeNull();
  });

  it("sukces bez `coupon_id` to BRAK werdyktu, nie rabat", () => {
    const { coupon_id: _omit, ...withoutCouponId } = SUCCESS;

    expect(parseCouponVerdict(withoutCouponId)).toBeNull();
    expect(parseCouponVerdict([withoutCouponId])).toBeNull();
    // `coupon_id` innego typu niż napis też nie wskazuje żadnego kuponu.
    expect(parseCouponVerdict({ ...SUCCESS, coupon_id: 42 })).toBeNull();
  });

  it("sukces bez kwoty końcowej to BRAK werdyktu - nie wiadomo, ile pobrać", () => {
    const { final_cents: _omit, ...withoutFinal } = SUCCESS;

    expect(parseCouponVerdict(withoutFinal)).toBeNull();
    expect(parseCouponVerdict({ ...SUCCESS, final_cents: "4500" })).toBeNull();
    expect(parseCouponVerdict({ ...SUCCESS, final_cents: Number.NaN })).toBeNull();
  });

  it("sukces bez kwoty rabatu to rabat ZERO, a nie `undefined` w sumie", () => {
    const { discount_cents: _omit, ...withoutDiscount } = SUCCESS;

    expect(parseCouponVerdict(withoutDiscount)).toEqual({ ...PARSED_SUCCESS, discount_cents: 0 });
  });

  it("odmowa niesie WYŁĄCZNIE powód i kwotę końcową - reszta pól jest zdejmowana", () => {
    // Odmowa z doklejonym `coupon_id`, etykietą i procentem nie może przenieść
    // ich dalej: ekran pokazałby rabat przy kodzie, którego baza nie przyjęła.
    const out = parseCouponVerdict({
      ok: false,
      error: "expired",
      coupon_id: "11111111-1111-4111-8111-111111111111",
      discount_cents: 500,
      final_cents: 5000,
      label: "-10%",
      discount_kind: "percent",
      discount_percent: 10,
    });

    expect(out).toEqual({
      ok: false,
      error: "expired",
      coupon_id: null,
      discount_cents: 0,
      final_cents: 5000,
      label: null,
      discount_kind: null,
      discount_percent: null,
    });
  });

  it("odmowa bez kwoty końcowej daje zero; powód nie-napisowy daje `null`", () => {
    expect(parseCouponVerdict({ ok: false, error: 7 })).toEqual({
      ok: false,
      error: null,
      coupon_id: null,
      discount_cents: 0,
      final_cents: 0,
      label: null,
      discount_kind: null,
      discount_percent: null,
    });
    expect(
      parseCouponVerdict([{ ok: false, error: { code: "x" }, final_cents: 900 }]),
    ).toMatchObject({
      ok: false,
      error: null,
      final_cents: 900,
    });
  });

  it('`ok` podane jako napis "true" to NIE sukces', () => {
    // Tylko logiczne `true` z bazy otwiera rabat. Napis (np. z ręcznie
    // złożonego jsonb) idzie ścieżką odmowy i nie niesie `coupon_id`.
    const out = parseCouponVerdict({ ...SUCCESS, ok: "true" });

    expect(out).toMatchObject({ ok: false, coupon_id: null, discount_cents: 0, label: null });
    expect(parseCouponVerdict([{ ...SUCCESS, ok: 1 }])).toMatchObject({
      ok: false,
      coupon_id: null,
    });
  });
});
