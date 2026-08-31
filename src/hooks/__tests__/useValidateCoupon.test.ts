// Live-walidacja kuponu B2B po stronie klienta: `src/hooks/useValidateCoupon.ts`.
//
// TEN PLIK REJESTRUJE DWA DEFEKTY, ZAMIAST JE NAPRAWIAC (`it.fails`). Oba
// dotycza pieniedzy i oba wymagaja decyzji produktowej, a nie technicznej -
// dlatego zostaja opisane i przypiete testem, ktory ZAPALI SIE SAM, gdy ktos je
// naprawi (`it.fails` przechodzi tylko dopoki asercja pada).
//
// ATRAPUJEMY GRANICE: klienta Supabase. Normalizacja kodu i mapowanie wyniku
// biegna prawdziwe.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  result: { data: [] as unknown[] | null, error: null as unknown },
  throws: null as Error | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.calls.push({ name, args });
      if (rpc.throws) throw rpc.throws;
      return rpc.result;
    },
  },
}));

import { useValidateCoupon } from "@/hooks/useValidateCoupon";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const PLAN = "11111111-1111-1111-1111-111111111111";

function setup(planId: string | null = PLAN) {
  return renderHook(() => useValidateCoupon({ planId, amountCents: 49_900, currency: "PLN" }));
}

beforeEach(() => {
  rpc.calls = [];
  rpc.result = { data: [], error: null };
  rpc.throws = null;
});

// ---------------------------------------------------------------------------
describe("kontrakt wywolania RPC", () => {
  it("normalizuje kod przed wyslaniem", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.validate("  rabat-10  ");
    });

    expect(rpc.calls[0]!.name).toBe("validate_b2b_coupon");
    expect(rpc.calls[0]!.args["_code"]).toBe("RABAT-10");
  });

  it("pusty kod NIE dotyka sieci - odpowiedz powstaje lokalnie", async () => {
    const { result } = setup();

    let out: unknown;
    await act(async () => {
      out = await result.current.validate("   ");
    });

    expect(rpc.calls).toEqual([]);
    expect(out).toMatchObject({ ok: false, error: "empty_code", final_cents: 49_900 });
  });

  it("przekazuje kwote i walute bez zmian - klient nie dyktuje kwoty koncowej", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.validate("RABAT");
    });

    expect(rpc.calls[0]!.args).toMatchObject({ _amount_cents: 49_900, _currency: "PLN" });
  });

  it("BRAK planu jest wysylany jako ZEROWY UUID, nie jako NULL", async () => {
    const { result } = setup(null);

    await act(async () => {
      await result.current.validate("RABAT");
    });

    // Utrwalenie faktycznego zachowania obejscia z `useValidateCoupon.ts`.
    expect(rpc.calls[0]!.args["_plan_id"]).toBe(ZERO_UUID);
  });

  it("`reset()` czysci wynik", async () => {
    rpc.result = { data: [{ ok: true, error: null, coupon_id: "c1" }], error: null };
    const { result } = setup();
    await act(async () => {
      await result.current.validate("RABAT");
    });
    expect(result.current.result).not.toBeNull();

    act(() => {
      result.current.reset();
    });

    expect(result.current.result).toBeNull();
  });

  it("pusta odpowiedz RPC daje null, nie wynik-widmo", async () => {
    rpc.result = { data: [], error: null };
    const { result } = setup();

    let out: unknown;
    await act(async () => {
      out = await result.current.validate("RABAT");
    });

    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("DEFEKT 1: kazdy blad jest pokazywany jako 'kupon nieprawidlowy'", () => {
  /**
   * CO JEST ZLE. `catch` w `useValidateCoupon.ts` mapuje KAZDY wyjatek na
   * `{ ok: false, error: "not_found" }`. Zerwane polaczenie, awaria RPC, brak
   * uprawnien i literowka w kodzie kuponu daja uzytkownikowi TO SAMO zdanie:
   * ze jego kupon jest nieprawidlowy (`coupon.error.notFound`).
   *
   * DLACZEGO TO WAZNE. To jest NIEPRAWDZIWA informacja o pieniadzach. Klient z
   * waznym kuponem, ktory trafil na sekunde awarii sieci, dowiaduje sie, ze
   * kupon nie istnieje - i placi pelna cene albo rezygnuje. Zaden log po
   * stronie klienta tego nie odroznia, bo stan koncowy jest identyczny.
   *
   * DLACZEGO NIE NAPRAWIAM TEGO TUTAJ. Rozdzielenie stanow (nieprawidlowy
   * kupon vs. blad techniczny) wymaga nowego wariantu bledu w
   * `ValidateCouponResult["error"]`, nowego klucza i18n w PL i EN oraz decyzji,
   * co ma zobaczyc uzytkownik przy awarii - to zmiana produktowa, a zasady tego
   * zadania zabraniaja zmieniac zachowanie produkcyjne, zeby test przeszedl.
   * Autorytetem kwoty ten hook NIE jest (serwer waliduje ponownie w
   * `createCheckoutOrder` i rezerwuje atomowo przy checkoucie), wiec defekt
   * dotyczy komunikatu, nie rozliczenia.
   */
  it.fails("blad sieci POWINIEN byc odrozniony od nieistniejacego kuponu", async () => {
    rpc.throws = new Error("TypeError: Failed to fetch");
    const { result } = setup();

    let out: { error: string | null } | null = null;
    await act(async () => {
      out = (await result.current.validate("RABAT")) as { error: string | null };
    });

    // Docelowo: osobny wariant bledu technicznego. Dzis: "not_found".
    expect(out!.error).not.toBe("not_found");
  });

  it.fails(
    "blad RPC (np. brak uprawnien) POWINIEN byc odrozniony od literowki w kodzie",
    async () => {
      rpc.result = { data: null, error: new Error("permission denied for function") };
      const { result } = setup();

      let out: { error: string | null } | null = null;
      await act(async () => {
        out = (await result.current.validate("RABAT")) as { error: string | null };
      });

      expect(out!.error).not.toBe("not_found");
    },
  );

  it("stan zastany (utrwalony): oba powyzsze przypadki daja dzis 'not_found'", async () => {
    rpc.throws = new Error("Failed to fetch");
    const { result } = setup();

    let network: { ok: boolean; error: string | null } | null = null;
    await act(async () => {
      network = (await result.current.validate("RABAT")) as { ok: boolean; error: string | null };
    });

    expect(network).toMatchObject({ ok: false, error: "not_found", discount_cents: 0 });
    // Kwota koncowa wraca NIETKNIETA - awaria nie potrafi obnizyc ceny.
    expect(network!["final_cents" as keyof typeof network]).toBe(49_900);
  });
});

// ---------------------------------------------------------------------------
describe("DEFEKT 2: zerowy UUID NIE jest przez RPC traktowany jak NULL", () => {
  /**
   * CO MOWI KOD KLIENTA. Komentarz w `useValidateCoupon.ts` brzmi:
   * "Typy Supabase widza _plan_id jako non-nullable; RPC ma OK z NULL, dlatego
   * przekazujemy pusty string dla braku planu jak dla planu."
   *
   * CO ROBI RPC NAPRAWDE. `validate_b2b_coupon` bramkuje ograniczenie planowe
   * warunkiem:
   *     IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL
   *        AND NOT (_plan_id = ANY(c.plan_ids)) THEN ... 'plan_not_eligible'
   * Zerowy UUID JEST wartoscia nie-NULL, wiec warunek `_plan_id IS NOT NULL`
   * jest spelniony, a zerowy UUID nigdy nie nalezy do `plan_ids`. Kupon
   * ograniczony do planow dostaje wiec `plan_not_eligible` DOKLADNIE w sytuacji,
   * dla ktorej obejscie powstalo - gdy planu nie wybrano. Przy prawdziwym NULL
   * caly warunek bylby pominiety i kupon by przeszedl.
   *
   * SKUTEK: kupon B2B ograniczony do planow jest odrzucany na ekranie, na
   * ktorym plan nie jest jeszcze wybrany. Uzytkownik widzi "kupon nie dotyczy
   * tego planu" dla kuponu, ktory jest wazny.
   *
   * DLACZEGO NIE NAPRAWIAM. Poprawka lezy po stronie SQL (normalizacja zerowego
   * UUID na NULL w RPC) albo w typach generowanych - obie zmieniaja zachowanie
   * produkcyjne warstwy pieniedzy i wymagaja osobnej zgody.
   *
   * Ta asercja czyta PRAWDZIWA definicje RPC z migracji (wzorzec
   * `dbEnumParity.test.ts`), wiec zapali sie sama, gdy ktos ja poprawi.
   */
  const MIGRATIONS = resolve(process.cwd(), "supabase/migrations");

  function latestValidateCouponBody(): string {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let body = "";
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), "utf8");
      const idx = sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(");
      if (idx === -1) continue;
      const end = sql.indexOf("END $$;", idx);
      body = sql.slice(idx, end === -1 ? undefined : end);
    }
    if (!body) throw new Error("test: nie znaleziono definicji validate_b2b_coupon w migracjach");
    return body;
  }

  it("RPC istnieje i bramkuje ograniczenie planowe warunkiem _plan_id IS NOT NULL", () => {
    const body = latestValidateCouponBody();

    expect(body).toContain("_plan_id IS NOT NULL");
    expect(body).toContain("plan_not_eligible");
  });

  it.fails("RPC POWINIEN normalizowac zerowy UUID na NULL, zanim sprawdzi plan_ids", () => {
    const body = latestValidateCouponBody();

    // Docelowo: jawna normalizacja, np. NULLIF(_plan_id, '00000000-...'::uuid).
    expect(body).toMatch(/NULLIF\s*\(\s*_plan_id/i);
  });

  it("klient i RPC rozjezdzaja sie: klient sle zerowy UUID, RPC czyta go jako konkretny plan", async () => {
    const { result } = setup(null);
    await act(async () => {
      await result.current.validate("RABAT");
    });

    const sent = rpc.calls[0]!.args["_plan_id"];
    const body = latestValidateCouponBody();

    expect(sent).toBe(ZERO_UUID);
    expect(body).not.toMatch(/NULLIF\s*\(\s*_plan_id/i);
  });
});
