// Kody promocyjne w nakładce płatności (`discounts.server.ts`).
//
// PO CO TEN PLIK ISTNIEJE. Ten moduł ROZDAJE PIENIĄDZE: zamienia kod wpisany
// przez klienta na rabat u operatora płatności, którym zostanie obciążona
// faktura. Do 31.08.2026 stał na zerze (0% linii, 0 z 4 funkcji), więc żadna
// z jego bramek nie była dotknięta testem - a bramka jest tu dokładnie jedna:
// RPC `validate_b2b_coupon`. Jeśli jej odpowiedź zostanie źle odczytana, kupon
// wyczerpany, przeterminowany, cudzego najemcy albo w innej walucie zamienia
// się w działający rabat, którego nikt nigdy nie wyłączy (kod jest u operatora
// kluczem naturalnym, więc raz założony żyje dalej).
//
// DRUGA REGUŁA: mapowanie jest LENIWE I SAMONAPRAWIAJĄCE - najpierw szukamy
// rabatu po kodzie, a dopiero gdy go nie ma, zakładamy nowy z definicji z bazy.
// Odwrócenie tej kolejności produkowałoby duplikaty rabatów przy każdym
// wpisaniu kodu.
//
// GRANICE, KTÓRE ATRAPUJEMY: klient Supabase i klient operatora płatności.
// PRAWDZIWE zostaje `getStripeErrorMessage` - test ma dowieść, że awaria
// operatora kończy się `provider_unavailable`, a nie wyciekiem wyjątku.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, supabaseFromStub } from "@/test/supabaseChain";

// --- granica 1: klient Supabase (RPC walidacji + tabela definicji) ----------

interface ValidationRow {
  ok: boolean;
  error?: string | null;
  coupon_id?: string;
  discount_cents?: number | null;
}

const db = vi.hoisted(() => ({
  current: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcResult: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => db.current!.from(table),
    rpc: (fn: string, args: unknown) => {
      db.rpcCalls.push({ fn, args });
      return Promise.resolve(db.rpcResult);
    },
  },
}));

// --- granica 2: operator płatności ------------------------------------------

const stripe = vi.hoisted(() => ({
  envs: [] as unknown[],
  /** Kody, dla których operator ZNA już rabat (ścieżka „znaleziono"). */
  existing: new Map<string, string>(),
  listArgs: [] as unknown[],
  couponArgs: [] as Record<string, unknown>[],
  promoArgs: [] as Record<string, unknown>[],
  failOn: null as null | "list" | "coupon" | "promo",
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  const providerError = (message: string) =>
    Object.assign(new Error(message), { type: "api_error", code: "provider_down" });
  return {
    ...actual,
    // BEZ RZUTOWANIA na `Stripe` - patrz komentarz w
    // `accountClosure.server.test.ts`: atrapa niesie tylko realnie używane
    // metody, a `as unknown as` jest w repo pod ratchetem.
    createStripeClient: (env: string) => {
      stripe.envs.push(env);
      return {
        promotionCodes: {
          list: (args: { code?: string }) => {
            stripe.listArgs.push(args);
            if (stripe.failOn === "list") return Promise.reject(providerError("list unavailable"));
            const found = args.code ? stripe.existing.get(args.code) : undefined;
            return Promise.resolve({ data: found ? [{ id: found }] : [] });
          },
          create: (args: Record<string, unknown>) => {
            stripe.promoArgs.push(args);
            if (stripe.failOn === "promo") {
              return Promise.reject(providerError("promo create refused"));
            }
            return Promise.resolve({ id: `promo_${String(args.code)}` });
          },
        },
        coupons: {
          create: (args: Record<string, unknown>) => {
            stripe.couponArgs.push(args);
            if (stripe.failOn === "coupon") {
              return Promise.reject(providerError("coupon create refused"));
            }
            return Promise.resolve({ id: "coupon_1" });
          },
        },
      };
    },
  };
});

import {
  createDiscount,
  findDiscountByCode,
  resolveDiscountForCoupon,
  type CouponDefinition,
} from "@/lib/billing/discounts.server";

const TENANT_COUPON_ID = "33333333-3333-4333-8333-333333333333";

function couponDefinition(overrides: Partial<CouponDefinition> = {}): CouponDefinition {
  return {
    discount_kind: "percent",
    discount_percent: 20,
    discount_cents: null,
    currency: "PLN",
    valid_until: null,
    max_redemptions: null,
    ...overrides,
  };
}

/** Ustawia odpowiedź RPC walidacji oraz wiersz definicji kuponu. */
function seed(
  options: {
    validation?: ValidationRow[] | null;
    validationError?: string;
    definition?: CouponDefinition | null;
  } = {},
): void {
  const stub = supabaseFromStub();
  const definition = options.definition === undefined ? couponDefinition() : options.definition;
  stub.setResponse("b2b_coupons", ok(definition));
  db.current = stub;
  db.rpcCalls.length = 0;
  db.rpcResult = options.validationError
    ? { data: null, error: { message: options.validationError } }
    : {
        data:
          options.validation === undefined
            ? [{ ok: true, coupon_id: TENANT_COUPON_ID, discount_cents: 980 }]
            : options.validation,
        error: null,
      };
}

/** Domyślne wejście: kupon 20% na plan miesięczny za 49,00 PLN. */
const INPUT = {
  environment: "sandbox" as const,
  code: "NES20",
  planId: "plan-member-monthly",
  amountCents: 4900,
  currency: "PLN",
};

beforeEach(() => {
  stripe.envs.length = 0;
  stripe.existing.clear();
  stripe.listArgs.length = 0;
  stripe.couponArgs.length = 0;
  stripe.promoArgs.length = 0;
  stripe.failOn = null;
  seed();
});

// ===========================================================================
describe("rabat WAŻNY", () => {
  it("istniejący rabat u operatora jest UŻYWANY PONOWNIE, nie zakładany drugi raz", async () => {
    // Kod jest u operatora kluczem naturalnym. Zakładanie nowego rabatu przy
    // każdym wpisaniu kodu rozmnożyłoby je bez końca i rozjechało raporty.
    stripe.existing.set("NES20", "promo_istniejacy");

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toEqual({
      ok: true,
      discountId: "promo_istniejacy",
      error: null,
      discountCents: 980,
    });
    expect(stripe.couponArgs).toEqual([]);
    expect(stripe.promoArgs).toEqual([]);
  });

  it("brak rabatu u operatora - zakładamy go z definicji z BAZY, nie z danych klienta", async () => {
    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: true, discountId: "promo_NES20", discountCents: 980 });
    expect(stripe.couponArgs).toEqual([
      {
        duration: "once",
        percent_off: 20,
        metadata: { source: "nes_b2b_coupons", code: "NES20" },
      },
    ]);
    expect(stripe.promoArgs).toEqual([{ coupon: "coupon_1", code: "NES20" }]);
  });

  it("kwota rabatu pochodzi z RPC (źródło prawdy), nie z definicji ani od klienta", async () => {
    seed({ validation: [{ ok: true, coupon_id: TENANT_COUPON_ID, discount_cents: 1234 }] });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result.discountCents).toBe(1234);
  });

  it("brak kwoty w odpowiedzi RPC daje zero, a nie `undefined` w podsumowaniu", async () => {
    seed({ validation: [{ ok: true, coupon_id: TENANT_COUPON_ID, discount_cents: null }] });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: true, discountCents: 0 });
  });

  it("kod jest normalizowany (obcięty i WERSALIKAMI) przed walidacją i przed operatorem", async () => {
    // Bez normalizacji `nes20` i `NES20 ` byłyby u operatora DWOMA rabatami,
    // a w bazie jednym kuponem - i limit wykorzystań przestałby cokolwiek znaczyć.
    await resolveDiscountForCoupon({ ...INPUT, code: "  nes20  " });

    expect(db.rpcCalls).toEqual([
      {
        fn: "validate_b2b_coupon",
        args: {
          _code: "NES20",
          _plan_id: "plan-member-monthly",
          _amount_cents: 4900,
          _currency: "PLN",
        },
      },
    ]);
    expect(stripe.listArgs).toEqual([{ code: "NES20", active: true, limit: 1 }]);
    expect(stripe.promoArgs[0]).toMatchObject({ code: "NES20" });
  });

  it("definicja kuponu jest czytana po identyfikatorze zwróconym przez RPC", async () => {
    await resolveDiscountForCoupon(INPUT);

    const chain = db.current!.lastChain("b2b_coupons")!;
    expect(chain.argsOf("eq")).toEqual(["id", TENANT_COUPON_ID]);
  });

  it("pracujemy na środowisku bramki podanym w wejściu, nie na domyślnym", async () => {
    await resolveDiscountForCoupon({ ...INPUT, environment: "live" });

    expect(stripe.envs).toEqual(["live", "live"]);
  });
});

// ===========================================================================
describe("ODMOWY z walidacji kuponu - każdy powód osobno", () => {
  it.each([
    ["wyczerpany limit wykorzystań", "exhausted"],
    ["po terminie ważności", "expired"],
    ["nieaktywny", "inactive"],
    ["nie obejmuje planu", "plan_not_covered"],
    ["kupon CUDZEGO najemcy", "wrong_tenant"],
    ["kupon w INNEJ walucie", "currency_mismatch"],
    ["kwota poniżej progu kuponu", "amount_too_low"],
  ])("kupon %s - `ok:false` z tym samym kodem błędu i BEZ rabatu u operatora", async (_l, code) => {
    seed({ validation: [{ ok: false, error: code }] });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toEqual({ ok: false, discountId: null, error: code, discountCents: 0 });
    // Skutek ważniejszy niż kod błędu: NIC nie powstało u operatora.
    expect(stripe.listArgs).toEqual([]);
    expect(stripe.couponArgs).toEqual([]);
    expect(stripe.promoArgs).toEqual([]);
  });

  it("odmowa BEZ podanego powodu spada do `not_found`, a nie do pustego napisu", async () => {
    seed({ validation: [{ ok: false }] });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: false, error: "not_found" });
  });

  it("PUSTA odpowiedź walidacji to `not_found`", async () => {
    seed({ validation: [] });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(db.current!.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("`null` zamiast tablicy też jest odmową, nie wyjątkiem", async () => {
    seed({ validation: null });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: false, error: "not_found" });
  });

  it("AWARIA RPC walidacji odmawia (fail-closed) - rabat nie jest przyznawany „na wszelki wypadek”", async () => {
    seed({ validationError: "validate_b2b_coupon: permission denied" });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toEqual({
      ok: false,
      discountId: null,
      error: "not_found",
      discountCents: 0,
    });
    expect(stripe.listArgs).toEqual([]);
  });

  it("walidacja przeszła, ale DEFINICJI kuponu nie ma w bazie - odmowa", async () => {
    // Stan niespójny (RPC zna kupon, tabela nie). Bez tej gałęzi tworzylibyśmy
    // u operatora rabat z pustej definicji, czyli faktycznie 0%.
    seed({ definition: null });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(stripe.couponArgs).toEqual([]);
  });

  it.each([
    ["pusty", ""],
    ["same spacje", "   "],
  ])("kod %s odpada NATYCHMIAST - baza nie jest w ogóle pytana", async (_label, code) => {
    await expect(resolveDiscountForCoupon({ ...INPUT, code })).resolves.toEqual({
      ok: false,
      discountId: null,
      error: "empty_code",
      discountCents: 0,
    });

    expect(db.rpcCalls).toEqual([]);
    expect(stripe.envs).toEqual([]);
  });
});

// ===========================================================================
describe("AWARIA operatora płatności", () => {
  it("padnięcie WYSZUKIWANIA rabatu prowadzi do próby założenia, a nie do wyjątku", async () => {
    stripe.failOn = "list";

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: true, discountId: "promo_NES20" });
  });

  it("padnięcie ZAKŁADANIA kuponu kończy się `provider_unavailable`", async () => {
    stripe.failOn = "coupon";

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toEqual({
      ok: false,
      discountId: null,
      error: "provider_unavailable",
      discountCents: 0,
    });
  });

  it("padnięcie ZAKŁADANIA kodu promocyjnego też kończy się `provider_unavailable`", async () => {
    stripe.failOn = "promo";

    const result = await resolveDiscountForCoupon(INPUT);

    expect(result).toMatchObject({ ok: false, error: "provider_unavailable" });
  });

  it("odmowa operatora NIE wypuszcza wyjątku do wołającego - nakładka ma się otworzyć bez rabatu", async () => {
    stripe.failOn = "coupon";

    await expect(resolveDiscountForCoupon(INPUT)).resolves.toMatchObject({ ok: false });
  });
});

// ===========================================================================
describe("findDiscountByCode - wyszukiwanie rabatu po kodzie", () => {
  it("zwraca identyfikator znalezionego rabatu", async () => {
    stripe.existing.set("NES20", "promo_x");

    await expect(findDiscountByCode("sandbox", "NES20")).resolves.toBe("promo_x");
  });

  it("pyta WYŁĄCZNIE o AKTYWNE kody i tylko o jeden wynik", async () => {
    await findDiscountByCode("sandbox", "NES20");

    expect(stripe.listArgs).toEqual([{ code: "NES20", active: true, limit: 1 }]);
  });

  it("brak wyniku to `null`, nie wyjątek", async () => {
    await expect(findDiscountByCode("sandbox", "NIE_MA")).resolves.toBeNull();
  });

  it("awaria operatora to `null` - decyzję o odmowie podejmuje wołający", async () => {
    stripe.failOn = "list";

    await expect(findDiscountByCode("sandbox", "NES20")).resolves.toBeNull();
  });
});

// ===========================================================================
describe("createDiscount - przełożenie definicji z bazy na rabat u operatora", () => {
  it("kupon PROCENTOWY przekazuje `percent_off`, bez kwoty i waluty", async () => {
    await createDiscount("sandbox", "NES20", couponDefinition({ discount_percent: 15 }));

    expect(stripe.couponArgs[0]).toEqual({
      duration: "once",
      percent_off: 15,
      metadata: { source: "nes_b2b_coupons", code: "NES20" },
    });
  });

  it("brak procentu w definicji daje `0`, a nie `undefined` u operatora", async () => {
    await createDiscount("sandbox", "NES0", couponDefinition({ discount_percent: null }));

    expect(stripe.couponArgs[0]).toMatchObject({ percent_off: 0 });
  });

  it("kupon KWOTOWY przekazuje `amount_off` i walutę MAŁYMI literami", async () => {
    // Operator przyjmuje kod waluty wyłącznie małymi literami - „PLN" byłoby
    // odrzucone, a rabat kwotowy nigdy by nie powstał.
    await createDiscount(
      "sandbox",
      "STALE50",
      couponDefinition({
        discount_kind: "fixed",
        discount_percent: null,
        discount_cents: 5000,
        currency: "EUR",
      }),
    );

    expect(stripe.couponArgs[0]).toMatchObject({ amount_off: 5000, currency: "eur" });
    expect(stripe.couponArgs[0]).not.toHaveProperty("percent_off");
  });

  it("kupon kwotowy BEZ waluty spada do PLN", async () => {
    await createDiscount(
      "sandbox",
      "STALE10",
      couponDefinition({ discount_kind: "fixed", discount_cents: 1000, currency: null }),
    );

    expect(stripe.couponArgs[0]).toMatchObject({ currency: "pln" });
  });

  it("UJEMNA kwota rabatu jest przycinana do zera - rabat nie może DOŁOŻYĆ do rachunku", async () => {
    await createDiscount(
      "sandbox",
      "BLAD",
      couponDefinition({ discount_kind: "fixed", discount_cents: -9900 }),
    );

    expect(stripe.couponArgs[0]).toMatchObject({ amount_off: 0 });
  });

  it("brak kwoty w definicji kwotowej daje zero", async () => {
    await createDiscount(
      "sandbox",
      "PUSTY",
      couponDefinition({ discount_kind: "fixed", discount_cents: null }),
    );

    expect(stripe.couponArgs[0]).toMatchObject({ amount_off: 0 });
  });

  it("limit wykorzystań jest przenoszony do operatora - inaczej kupon byłby nielimitowany", async () => {
    await createDiscount("sandbox", "LIMIT", couponDefinition({ max_redemptions: 25 }));

    expect(stripe.couponArgs[0]).toMatchObject({ max_redemptions: 25 });
  });

  it.each([
    ["brak limitu", null],
    ["limit zero", 0],
  ])("%s NIE ustawia `max_redemptions` u operatora", async (_label, limit) => {
    await createDiscount("sandbox", "BEZLIMITU", couponDefinition({ max_redemptions: limit }));

    expect(stripe.couponArgs[0]).not.toHaveProperty("max_redemptions");
  });

  it("termin ważności jest przenoszony jako `redeem_by` w SEKUNDACH uniksowych", async () => {
    // Milisekundy zamiast sekund przesunęłyby termin o tysiąckrotność - czyli
    // kupon „ważny do jutra" żyłby jeszcze w roku 57 000.
    await createDiscount(
      "sandbox",
      "DOJUTRA",
      couponDefinition({ valid_until: "2026-09-30T23:59:59.000Z" }),
    );

    expect(stripe.couponArgs[0]).toMatchObject({
      redeem_by: Math.floor(Date.parse("2026-09-30T23:59:59.000Z") / 1000),
    });
  });

  it("brak terminu NIE ustawia `redeem_by`", async () => {
    await createDiscount("sandbox", "BEZTERMINU", couponDefinition({ valid_until: null }));

    expect(stripe.couponArgs[0]).not.toHaveProperty("redeem_by");
  });

  it("kod promocyjny jest osadzany na ŚWIEŻO utworzonym kuponie", async () => {
    const id = await createDiscount("sandbox", "NES20", couponDefinition());

    expect(stripe.promoArgs).toEqual([{ coupon: "coupon_1", code: "NES20" }]);
    expect(id).toBe("promo_NES20");
  });

  it("awaria operatora to `null`, nie wyjątek", async () => {
    stripe.failOn = "coupon";

    await expect(createDiscount("sandbox", "NES20", couponDefinition())).resolves.toBeNull();
  });

  it("metadane wiążą rabat z NASZYM rejestrem kuponów - inaczej nie da się go potem odnaleźć", async () => {
    await createDiscount("sandbox", "NES20", couponDefinition());

    expect(stripe.couponArgs[0]).toMatchObject({
      metadata: { source: "nes_b2b_coupons", code: "NES20" },
    });
  });
});

// ===========================================================================
describe("kontrakt wyniku", () => {
  it("odmowa ZAWSZE ma ten sam kształt - brak rabatu i zerowa kwota", async () => {
    seed({ validation: [{ ok: false, error: "exhausted" }] });

    const result = await resolveDiscountForCoupon(INPUT);

    expect(Object.keys(result).sort()).toEqual(["discountCents", "discountId", "error", "ok"]);
    expect(result.discountId).toBeNull();
    expect(result.discountCents).toBe(0);
  });

  it("wynik nie niesie definicji kuponu ani danych najemcy", async () => {
    stripe.existing.set("NES20", "promo_x");

    const result = await resolveDiscountForCoupon(INPUT);

    expect(JSON.stringify(result)).not.toContain(TENANT_COUPON_ID);
    expect(JSON.stringify(result)).not.toContain("discount_percent");
  });

  it("definicja z bazy jest przekazywana do operatora BEZ zmian po drodze", async () => {
    // Dowód na to, że pomiędzy `b2b_coupons` a operatorem nie ma cichego
    // przeliczenia: procent z bazy ma trafić do rabatu 1:1.
    seed({ definition: couponDefinition({ discount_percent: 42 }) });

    await resolveDiscountForCoupon(INPUT);

    expect(stripe.couponArgs[0]).toMatchObject({ percent_off: 42 });
  });
});
