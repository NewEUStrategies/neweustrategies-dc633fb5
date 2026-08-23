// Agregaty analityki kuponów - KAŻDE dzielenie i KAŻDA konwersja osobno.
//
// CO TEN PLIK DOWODZI.
//   1. DZIELENIE PRZEZ ZERO NIE ISTNIEJE. Konwersja to jedyne dzielenie przez
//      wartość zmienną w tej powierzchni i jest osłonięte warunkiem - pusty
//      zbiór daje „0", a nie „NaN". To OBALA hipotezę, że kafle analityki
//      pokazują „NaN%" na pustym zakresie.
//   2. NaN JEST, ale przychodzi z KONWERSJI, nie z dzielenia: brak kolumny
//      w odpowiedzi RPC (`undefined`) zatruwa całą sumę, a `null` cichnie do
//      zera. Awarii kontraktu funkcji SQL nie da się więc odróżnić od zera
//      przychodu - i to jest defekt, nie ozdoba.
//   3. „TOP 10" to pierwsze dziesięć wierszy ODPOWIEDZI - klient nie sortuje.
//      W chwili, w której ktoś zmieni `ORDER BY` w migracji, wykres przestaje
//      być TOP-em i nikt się o tym nie dowie.
//   4. Kafel „Kupony" liczy wiersze odpowiedzi, a funkcja SQL ma LIMIT 100.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Wywołania RPC i argumentów `_from`/`_to` (to
// dowodzi test trasy) ani renderu tabeli (organizm `CouponAnalyticsTable`).
import { describe, expect, it } from "vitest";
import {
  summarizeCouponAnalytics,
  top10BarOption,
  top10ByRedemptions,
  type CouponAnalyticsRow,
} from "@/lib/billing/couponAnalyticsView";

function row(overrides: Partial<CouponAnalyticsRow> = {}): CouponAnalyticsRow {
  return {
    coupon_id: "c-1",
    code: "NES-A1",
    name: null,
    redemptions: 2,
    revenue_cents: 8000,
    discount_cents_total: 2000,
    ...overrides,
  };
}

/** Wiersz z BRAKUJĄCĄ kolumną - dryf kontraktu funkcji SQL. */
function rowBezPola(pole: keyof CouponAnalyticsRow): CouponAnalyticsRow {
  const pelny: Record<string, unknown> = { ...row() };
  delete pelny[pole];
  return pelny as unknown as CouponAnalyticsRow;
}

describe("konwersja - jedyne dzielenie przez wartość zmienną", () => {
  it("PUSTY zbiór daje '0', a NIE 'NaN' - dzielenie jest osłonięte warunkiem", () => {
    expect(summarizeCouponAnalytics([]).conversion).toBe("0");
  });

  it("trzy kupony, jeden z realizacjami, dają 33.3", () => {
    const rows = [
      row({ coupon_id: "c-1", redemptions: 4 }),
      row({ coupon_id: "c-2", redemptions: 0 }),
      row({ coupon_id: "c-3", redemptions: 0 }),
    ];
    expect(summarizeCouponAnalytics(rows).conversion).toBe("33.3");
  });

  it("same kupony BEZ realizacji dają '0.0' - dzielnik jest niezerowy, więc wynik jest liczbą", () => {
    const rows = [
      row({ coupon_id: "c-1", redemptions: 0 }),
      row({ coupon_id: "c-2", redemptions: 0 }),
    ];
    expect(summarizeCouponAnalytics(rows).conversion).toBe("0.0");
  });

  it("wszystkie kupony z realizacjami dają '100.0'", () => {
    expect(summarizeCouponAnalytics([row(), row({ coupon_id: "c-2" })]).conversion).toBe("100.0");
  });

  it("realizacje przychodzące jako STRING (bigint z PostgREST) nadal liczą się do konwersji", () => {
    const rows = [
      row({ redemptions: "3" as unknown as number }),
      row({ coupon_id: "c-2", redemptions: 0 }),
    ];
    expect(summarizeCouponAnalytics(rows).conversion).toBe("50.0");
  });
});

describe("sumy kafli", () => {
  it("pusty zakres daje zera, a nie puste napisy", () => {
    expect(summarizeCouponAnalytics([])).toEqual({
      coupons: 0,
      totalRedemptions: 0,
      totalRevenueCents: 0,
      totalDiscountCents: 0,
      conversion: "0",
    });
  });

  it("dwa wiersze sumują się kolumna po kolumnie", () => {
    const suma = summarizeCouponAnalytics([
      row({ redemptions: 2, revenue_cents: 8000, discount_cents_total: 2000 }),
      row({ coupon_id: "c-2", redemptions: 3, revenue_cents: 1500, discount_cents_total: 500 }),
    ]);
    expect(suma.coupons).toBe(2);
    expect(suma.totalRedemptions).toBe(5);
    expect(suma.totalRevenueCents).toBe(9500);
    expect(suma.totalDiscountCents).toBe(2500);
  });

  it("NULL w kolumnie kwoty cichnie do ZERA - straty nie da się odróżnić od braku danych", () => {
    const suma = summarizeCouponAnalytics([
      row({ revenue_cents: null as unknown as number }),
      row({ coupon_id: "c-2", revenue_cents: 1500 }),
    ]);
    expect(suma.totalRevenueCents).toBe(1500);
  });

  it.each([
    ["revenue_cents", "totalRevenueCents"],
    ["discount_cents_total", "totalDiscountCents"],
    ["redemptions", "totalRedemptions"],
  ] as const)(
    "BRAK kolumny %s w odpowiedzi RPC zatruwa całą sumę wartością NaN",
    (kolumna, poleSumy) => {
      const suma = summarizeCouponAnalytics([rowBezPola(kolumna), row({ coupon_id: "c-2" })]);
      expect(Number.isNaN(suma[poleSumy])).toBe(true);
      // Konsekwencja widoczna dla operatora: kafel wypisuje literalne „NaN".
      expect((suma[poleSumy] / 100).toFixed(2)).toBe("NaN");
    },
  );
});

describe("TOP 10", () => {
  it("bierze PIERWSZE dziesięć wierszy odpowiedzi i tnie resztę", () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      row({ coupon_id: `c-${i}`, code: `KOD-${i}`, redemptions: i }),
    );
    const top = top10ByRedemptions(rows);
    expect(top).toHaveLength(10);
    expect(top.at(-1)?.code).toBe("KOD-9");
  });

  it("realizacje są zamieniane na LICZBY, także gdy PostgREST odda je stringiem", () => {
    const top = top10ByRedemptions([row({ redemptions: "7" as unknown as number })]);
    expect(top[0].redemptions).toBe(7);
  });

  // Para `it.fails` + `it()`. Po naprawie (własne sortowanie po stronie
  // klienta) usuwa się OBA RAZEM.
  it.fails(
    "'TOP 10' POWINNO stawiać na pierwszym miejscu kupon o największej liczbie realizacji",
    () => {
      const top = top10ByRedemptions([
        row({ coupon_id: "c-1", code: "MALY", redemptions: 2 }),
        row({ coupon_id: "c-2", code: "DUZY", redemptions: 99 }),
        row({ coupon_id: "c-3", code: "SREDNI", redemptions: 5 }),
      ]);
      expect(top[0].code).toBe("DUZY");
    },
  );

  it("STAN FAKTYCZNY: kolejność jest przepisana z odpowiedzi RPC bez sprawdzenia", () => {
    const top = top10ByRedemptions([
      row({ coupon_id: "c-1", code: "MALY", redemptions: 2 }),
      row({ coupon_id: "c-2", code: "DUZY", redemptions: 99 }),
      row({ coupon_id: "c-3", code: "SREDNI", redemptions: 5 }),
    ]);
    expect(top.map((r) => r.code)).toEqual(["MALY", "DUZY", "SREDNI"]);
  });
});

describe("DEFEKT: obcięcie odpowiedzi do 100 wierszy jest niewidoczne", () => {
  const sto = Array.from({ length: 100 }, (_, i) => row({ coupon_id: `c-${i}`, code: `KOD-${i}` }));

  it.fails("podsumowanie POWINNO mówić, że odpowiedź jest obcięta limitem funkcji SQL", () => {
    expect("truncated" in summarizeCouponAnalytics(sto)).toBe(true);
  });

  it("STAN FAKTYCZNY: 100 wierszy wygląda dokładnie tak samo jak 100 kuponów w bazie", () => {
    const suma = summarizeCouponAnalytics(sto);
    expect(suma.coupons).toBe(100);
    expect("truncated" in suma).toBe(false);
    // Konwersja liczona jest na tej samej, obciętej setce.
    expect(suma.conversion).toBe("100.0");
  });
});

describe("opcja wykresu słupkowego", () => {
  const top = top10ByRedemptions([
    row({ coupon_id: "c-1", code: "NES-A1", redemptions: 4 }),
    row({ coupon_id: "c-2", code: "NES-B2", redemptions: 1 }),
  ]);

  it("kategorie osi X to KODY kuponów w kolejności wejścia", () => {
    const option = top10BarOption(top, "Realizacje") as {
      xAxis: { data: string[] };
    };
    expect(option.xAxis.data).toEqual(["NES-A1", "NES-B2"]);
  });

  it("dane serii to LICZBY realizacji, nie stringi", () => {
    const option = top10BarOption(top, "Realizacje") as {
      series: Array<{ data: unknown[] }>;
    };
    expect(option.series[0].data).toEqual([4, 1]);
  });

  it("nazwa serii przychodzi z zewnątrz - to ona zmienia się z językiem interfejsu", () => {
    const option = top10BarOption(top, "Redemptions") as { series: Array<{ name: string }> };
    expect(option.series[0].name).toBe("Redemptions");
  });

  it("pusty TOP daje wykres bez kategorii i bez słupków, a nie wyjątek", () => {
    const option = top10BarOption([], "Realizacje") as {
      xAxis: { data: string[] };
      series: Array<{ data: unknown[] }>;
    };
    expect(option.xAxis.data).toEqual([]);
    expect(option.series[0].data).toEqual([]);
  });
});
