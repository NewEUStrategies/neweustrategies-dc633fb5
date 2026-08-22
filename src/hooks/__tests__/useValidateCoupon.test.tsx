// Live-walidacja kuponu B2B na checkoucie - warstwa, która decyduje, JAKĄ KWOTĘ
// zobaczy klient przed kliknięciem „zapłać".
//
// Ten hook stał na 0% linii i 0/3 funkcji, mimo że jest w produkcji wołany
// (przez `CouponInput`) i w testach obecny - bo jedyny test, który go dotyka
// (`routes/__tests__/checkoutPlanRoute.test.tsx`), MOCKUJE go w całości. To jest
// wzorcowy przypadek przyczyny, dla której cały moduł stoi na 27%: warstwa
// pieniędzy jest zastąpiona atrapą dokładnie tam, gdzie miałaby być dowodzona.
//
// CO TEN PLIK DOWODZI.
//   1. AWARIA ODCZYTU NIE OBNIŻA KWOTY DO ZAPŁATY. Gałąź `catch` buduje wynik
//      `not_found` z `final_cents === amountCents` (useValidateCoupon.ts:66).
//      To jest najważniejsza asercja tego pliku: gdyby `final_cents` wyszło 0
//      albo `undefined`, awaria sieci dawałaby darmowy plan. Test sprawdza to
//      dla trzech różnych kwot, żeby nie przeszło przypadkowe zero.
//   2. PUSTY KOD NIE DOTYKA BAZY. `normalizeCouponCode("   ")` daje pusty
//      string, a wtedy wynik `empty_code` powstaje LOKALNIE - zero wywołań RPC.
//      Dowodzone przez licznik wywołań atrapy, nie przez kształt wyniku.
//   3. BRAK PLANU JEDZIE JAKO SENTINEL UUID, nie jako `null`. Typy Supabase
//      widzą `_plan_id` jako non-nullable, więc kod podstawia
//      `00000000-0000-0000-0000-000000000000`. Zamiana tego na `null` albo na
//      pusty string zmieniłaby zachowanie RPC (dopasowanie planu) bez żadnego
//      błędu typów.
//   4. `loading` WRACA DO `false` TAKŻE PO BŁĘDZIE - jest w `finally`.
//      Bez tego przycisk „zastosuj" zostaje wyłączony na zawsze po jednej
//      nieudanej próbie i klient nie ma jak ponowić.
//   5. TOŻSAMOŚĆ `validate` JEST STABILNA względem renderów, a ZMIENIA SIĘ przy
//      zmianie `planId`, `amountCents` i `currency`. `CouponInput` wpina ją
//      w handler klawisza Enter; niestabilna referencja to nie tylko rerender,
//      ale ryzyko walidacji przeciwko NIEAKTUALNEJ kwocie.
//   6. DEFEKT: PUSTY ZBIÓR WIERSZY Z RPC DAJE `null`, CZYLI CISZĘ (`it.fails`).
//      `validate_b2b_coupon` to `RETURNS TABLE`, więc odpowiedź bez wiersza to
//      `data: []`. Kod robi `((data ?? []) as ...)[0] ?? null` i `setResult(null)`.
//      Wynik `null` jest NIEODRÓŻNIALNY od stanu „jeszcze nie walidowano", więc
//      klient, który wpisał kod, nie dostaje ani rabatu, ani komunikatu o
//      błędzie. Widoczny skutek jest udowodniony w teście `CouponInput` obok.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `normalizeCouponCode`, `formatDiscountLabel`
// i arytmetyki rabatu (`lib/billing/__tests__/couponMoney.test.ts`,
// `couponAuditCurrency.test.ts`) ani walidacji serwerowej w checkoucie.
// Atrapa dotyczy WYŁĄCZNIE klienta Supabase - sam hook biegnie prawdziwy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import type { ValidateCouponResult } from "@/lib/billing/coupons";

const stubs: { rpc: SupabaseRpcStub } = { rpc: supabaseRpcStub() };

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseRpcStub: make } = await import("@/test/supabase");
  const rpc = make();
  stubs.rpc = rpc;
  return { supabase: { rpc: rpc.rpc } };
});

const { useValidateCoupon } = await import("@/hooks/useValidateCoupon");

const RPC = "validate_b2b_coupon";
const NO_PLAN_SENTINEL = "00000000-0000-0000-0000-000000000000";
const PLAN = "22222222-2222-4222-8222-222222222222";

/** Udana odpowiedź RPC dla rabatu procentowego. */
function okRow(over: Partial<ValidateCouponResult> = {}): ValidateCouponResult {
  return {
    ok: true,
    error: null,
    coupon_id: "33333333-3333-4333-8333-333333333333",
    discount_cents: 2000,
    final_cents: 8000,
    label: "-20%",
    discount_kind: "percent",
    discount_percent: 20,
    ...over,
  };
}

function render(args: { planId?: string | null; amountCents?: number; currency?: string } = {}) {
  // `??` na `planId` byłoby błędem TEGO pliku: test „brak planu" podaje jawne
  // `null`, a `null ?? PLAN` przywróciłoby plan i test dowodziłby czegoś innego.
  return renderHookWithQueryClient(() =>
    useValidateCoupon({
      planId: "planId" in args ? (args.planId ?? null) : PLAN,
      amountCents: args.amountCents ?? 10000,
      currency: args.currency ?? "PLN",
    }),
  );
}

beforeEach(() => {
  stubs.rpc.reset();
});

describe("useValidateCoupon: pusty kod nie dotyka bazy", () => {
  it.each([
    ["pusty string", ""],
    ["same spacje", "   "],
    ["tabulator i nowa linia", "\t\n "],
  ])("kod %s daje `empty_code` bez ANI JEDNEGO wywołania RPC", async (_label, input) => {
    const { result } = render();
    let outcome: ValidateCouponResult | null = null;
    await act(async () => {
      outcome = await result.current.validate(input);
    });

    expect(outcome).toMatchObject({ ok: false, error: "empty_code", coupon_id: null });
    // To jest właściwa asercja: brak zapytania, nie tylko właściwy kształt.
    expect(stubs.rpc.calls).toHaveLength(0);
  });

  it("`empty_code` NIE obniża kwoty do zapłaty", async () => {
    const { result } = render({ amountCents: 4900 });
    let outcome: ValidateCouponResult | null = null;
    await act(async () => {
      outcome = await result.current.validate("");
    });
    expect(outcome).toMatchObject({ discount_cents: 0, final_cents: 4900 });
  });

  it("`empty_code` ląduje też w stanie `result`, nie tylko w zwrotce", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.validate("");
    });
    expect(result.current.result?.error).toBe("empty_code");
  });

  it("pusty kod nie ustawia `loading` (nie ma czego czekać)", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.validate("");
    });
    expect(result.current.loading).toBe(false);
  });
});

describe("useValidateCoupon: kontrakt argumentów RPC", () => {
  it("kod jedzie ZNORMALIZOWANY (trim + upper)", async () => {
    stubs.rpc.setData(RPC, [okRow()]);
    const { result } = render();
    await act(async () => {
      await result.current.validate("  wiosna24  ");
    });
    expect(stubs.rpc.lastCall(RPC)?.arg("_code")).toBe("WIOSNA24");
  });

  it("brak planu jedzie jako SENTINEL UUID, nie jako null ani pusty string", async () => {
    stubs.rpc.setData(RPC, [okRow()]);
    const { result } = render({ planId: null });
    await act(async () => {
      await result.current.validate("KOD");
    });
    const call = stubs.rpc.lastCall(RPC);
    expect(call?.arg("_plan_id")).toBe(NO_PLAN_SENTINEL);
    expect(call?.arg("_plan_id")).not.toBeNull();
  });

  it("podany plan jedzie bez zmiany", async () => {
    stubs.rpc.setData(RPC, [okRow()]);
    const { result } = render({ planId: PLAN });
    await act(async () => {
      await result.current.validate("KOD");
    });
    expect(stubs.rpc.lastCall(RPC)?.arg("_plan_id")).toBe(PLAN);
  });

  it("komplet nazw argumentów jest dokładnie taki, jak w podpisie RPC", async () => {
    // Zgubiony albo przemianowany argument znaczy „baza użyje DEFAULT" -
    // czyli walidację przeciwko innej kwocie lub innej walucie. `tsc` tego
    // nie widzi, bo obiekt argumentów jest luźny.
    stubs.rpc.setData(RPC, [okRow()]);
    const { result } = render({ amountCents: 12345, currency: "eur" });
    await act(async () => {
      await result.current.validate("KOD");
    });
    const call = stubs.rpc.lastCall(RPC);
    expect(call?.keys().sort()).toEqual(["_amount_cents", "_code", "_currency", "_plan_id"]);
    expect(call?.arg("_amount_cents")).toBe(12345);
    // Waluta jedzie DOKŁADNIE tak, jak ją podał rodzic - hook jej nie zmienia.
    expect(call?.arg("_currency")).toBe("eur");
  });
});

describe("useValidateCoupon: awaria odczytu NIE obniża kwoty", () => {
  it.each([10000, 4900, 1])(
    "błąd RPC przy kwocie %i daje `not_found` z `final_cents` równym tej kwocie",
    async (amount) => {
      stubs.rpc.setError(RPC, "statement timeout", "57014");
      const { result } = render({ amountCents: amount });
      let outcome: ValidateCouponResult | null = null;
      await act(async () => {
        outcome = await result.current.validate("WIOSNA24");
      });

      expect(outcome).toMatchObject({
        ok: false,
        error: "not_found",
        coupon_id: null,
        discount_cents: 0,
        final_cents: amount,
      });
    },
  );

  it("wyjątek w kliencie (nie błąd PostgREST) idzie tą samą ścieżką", async () => {
    stubs.rpc.setResponse(RPC, () => {
      throw new Error("network down");
    });
    const { result } = render({ amountCents: 7700 });
    let outcome: ValidateCouponResult | null = null;
    await act(async () => {
      outcome = await result.current.validate("KOD");
    });
    expect(outcome).toMatchObject({ error: "not_found", final_cents: 7700 });
  });

  it("`loading` wraca do `false` PO BŁĘDZIE - blok `finally`", async () => {
    // Bez `finally` przycisk „zastosuj" zostaje `disabled` na zawsze po
    // jednej nieudanej próbie.
    stubs.rpc.setError(RPC, "boom");
    const { result } = render();
    await act(async () => {
      await result.current.validate("KOD");
    });
    expect(result.current.loading).toBe(false);
  });

  it("`loading` wraca do `false` po SUKCESIE", async () => {
    stubs.rpc.setData(RPC, [okRow()]);
    const { result } = render();
    await act(async () => {
      await result.current.validate("KOD");
    });
    expect(result.current.loading).toBe(false);
  });
});

describe("useValidateCoupon: odpowiedź bazy trafia do stanu bez zmian", () => {
  it("udany kupon zwraca PIERWSZY wiersz odpowiedzi", async () => {
    const row = okRow({ discount_cents: 1500, final_cents: 8500 });
    stubs.rpc.setData(RPC, [row, okRow({ discount_cents: 999 })]);
    const { result } = render();
    await act(async () => {
      await result.current.validate("KOD");
    });
    expect(result.current.result).toEqual(row);
  });

  it("odmowa bazy (ok:false z powodem) przechodzi bez podmiany powodu", async () => {
    // Powód z bazy jest tłumaczony w UI przez COUPON_ERROR_I18N_KEY - hook nie
    // ma prawa go zamienić na własny `not_found`.
    const row = okRow({ ok: false, error: "limit_reached", discount_cents: 0, final_cents: 10000 });
    stubs.rpc.setData(RPC, [row]);
    const { result } = render();
    await act(async () => {
      await result.current.validate("KOD");
    });
    expect(result.current.result?.error).toBe("limit_reached");
  });

  it("`reset()` czyści stan do `null`", async () => {
    stubs.rpc.setData(RPC, [okRow()]);
    const { result } = render();
    await act(async () => {
      await result.current.validate("KOD");
    });
    expect(result.current.result).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.result).toBeNull();
  });
});

describe("useValidateCoupon: stabilność `validate`", () => {
  it("ta sama referencja przy rerenderze bez zmiany wejść", () => {
    const { result, rerender } = render();
    const first = result.current.validate;
    rerender();
    expect(result.current.validate).toBe(first);
  });

  it.each([
    ["planId", { planId: "44444444-4444-4444-8444-444444444444" }],
    ["amountCents", { amountCents: 999 }],
    ["currency", { currency: "EUR" }],
  ])("NOWA referencja po zmianie %s", (_label, next) => {
    // Gdyby referencja przetrwała zmianę kwoty, handler Entera w `CouponInput`
    // walidowałby kupon przeciwko STAREJ kwocie.
    const base = { planId: PLAN, amountCents: 10000, currency: "PLN" };
    let props = base;
    const { result, rerender } = renderHookWithQueryClient(() => useValidateCoupon(props));
    const first = result.current.validate;
    props = { ...base, ...next };
    rerender();
    expect(result.current.validate).not.toBe(first);
  });
});

describe("DEFEKT: pusty zbiór wierszy z RPC daje ciszę zamiast komunikatu", () => {
  it.fails(
    "odpowiedź `data: []` MA dać rozpoznawalny błąd, a daje `null` - " +
      "stan nieodróżnialny od „jeszcze nie walidowano”",
    async () => {
      // Oczekiwanie: `validate_b2b_coupon` jako RETURNS TABLE może oddać zero
      // wierszy (nieznany kod, kupon innego najemcy). Klient, który wpisał kod,
      // musi dostać JAKIŚ werdykt. Produkcja robi `[0] ?? null` i zapisuje
      // `null`, czyli dokładnie to samo, co stan początkowy.
      stubs.rpc.setData(RPC, []);
      const { result } = render();
      let outcome: ValidateCouponResult | null = null;
      await act(async () => {
        outcome = await result.current.validate("NIEZNANY");
      });
      expect(outcome).not.toBeNull();
    },
  );

  it("STAN FAKTYCZNY: `data: []` daje `null` i zeruje poprzedni werdykt", async () => {
    // Sprzężony z `it.fails` powyżej. Dodatkowo pokazuje, że pusty zbiór
    // ZASTĘPUJE poprzedni, poprawny werdykt - klient traci nawet informację,
    // którą miał chwilę wcześniej.
    stubs.rpc.setResponse(RPC, (call) =>
      call.arg("_code") === "DOBRY" ? { data: [okRow()], error: null } : { data: [], error: null },
    );
    const { result } = render();
    await act(async () => {
      await result.current.validate("DOBRY");
    });
    expect(result.current.result?.ok).toBe(true);

    await act(async () => {
      await result.current.validate("NIEZNANY");
    });
    expect(result.current.result).toBeNull();
  });

  it("`data: null` z bazy idzie tą samą, cichą ścieżką", async () => {
    stubs.rpc.setData(RPC, null);
    const { result } = render();
    let outcome: ValidateCouponResult | null = null;
    await act(async () => {
      outcome = await result.current.validate("KOD");
    });
    expect(outcome).toBeNull();
    expect(stubs.rpc.calls).toHaveLength(1);
  });
});
