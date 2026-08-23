// Organizm: tabela „Szczegóły per kupon" z sumą rabatów pod spodem.
//
// CO TEN PLIK DOWODZI.
//   1. STOPKA ZGADZA SIĘ Z KOLUMNĄ. W trasie suma rabatów i kolumna rabatu były
//      dwoma niezależnymi wyrażeniami - raport mógł sam sobie przeczyć i nikt
//      by tego nie zobaczył w recenzji. Tutaj suma przychodzi jednym propem,
//      a test sprawdza zgodność.
//   2. Rabat jest wypisany ze ZNAKIEM MINUS, a przychód bez - to rozróżnienie
//      niesie całe znaczenie obu kolumn.
//   3. Kolumna „Realizacje" renderuje wartość BEZ `Number()`, więc string
//      z PostgREST-a pokazuje się tak samo jak liczba - a ta sama wartość
//      w sumach i na wykresie idzie już przez `Number()`.
//   4. BRAK kolumny w odpowiedzi RPC daje w komórce „NaN", a `null` daje
//      „0.00" - awarii kontraktu nie da się odróżnić od zera przychodu.
//   5. Pusty zbiór pokazuje komunikat i NIE rysuje stopki z sumą 0.00, która
//      wyglądałaby jak wynik pomiaru.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Liczenia sum i konwersji
// (`couponAnalyticsView.test.ts`) ani wywołania RPC (test trasy).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { CouponAnalyticsTable } from "@/components/admin/coupons/organisms/CouponAnalyticsTable";
import {
  summarizeCouponAnalytics,
  type CouponAnalyticsRow,
} from "@/lib/billing/couponAnalyticsView";

afterEach(cleanup);

const LABELS = {
  title: "Szczegóły per kupon",
  empty: "Brak danych.",
  code: "Kod",
  redemptions: "Realizacje",
  netRevenue: "Przychód netto",
  totalDiscount: "Rabat łącznie",
  totalDiscountGranted: "Łączny rabat udzielony",
};

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

/** Rysuje tabelę z sumą policzoną TĄ SAMĄ funkcją, co w trasie. */
function renderTable(rows: CouponAnalyticsRow[]) {
  render(
    <CouponAnalyticsTable
      rows={rows}
      totalDiscountCents={summarizeCouponAnalytics(rows).totalDiscountCents}
      labels={LABELS}
    />,
  );
}

function komorkiWiersza(indeks: number): string[] {
  const wiersz = screen.getAllByRole("row")[indeks + 1];
  return within(wiersz)
    .getAllByRole("cell")
    .map((c) => c.textContent ?? "");
}

describe("stan pusty", () => {
  it("brak danych pokazuje komunikat i NIE rysuje tabeli", () => {
    renderTable([]);
    expect(screen.getByText("Brak danych.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("brak danych NIE pokazuje stopki z sumą 0.00 - zero wyglądałoby jak wynik pomiaru", () => {
    renderTable([]);
    expect(screen.queryByText(/Łączny rabat udzielony/)).not.toBeInTheDocument();
  });
});

describe("wiersz kuponu", () => {
  it("przychód bez znaku, rabat ZE ZNAKIEM MINUS - to rozróżnienie niesie znaczenie kolumn", () => {
    renderTable([row({ revenue_cents: 8000, discount_cents_total: 2000 })]);
    const c = komorkiWiersza(0);
    expect(c[2]).toBe("80.00");
    expect(c[3]).toBe("-20.00");
  });

  it("nazwa kuponu pojawia się pod kodem tylko wtedy, gdy istnieje", () => {
    renderTable([row({ name: "Kampania VIP" })]);
    expect(screen.getByText("Kampania VIP")).toBeInTheDocument();
    cleanup();
    renderTable([row({ name: null })]);
    expect(komorkiWiersza(0)[0]).toBe("NES-A1");
  });

  it("realizacje jako STRING wypisują się dosłownie - kolumna nie przechodzi przez Number()", () => {
    renderTable([row({ redemptions: "7" as unknown as number })]);
    expect(komorkiWiersza(0)[1]).toBe("7");
  });

  it("NULL w kolumnie kwoty pokazuje 0.00 - straty nie da się odróżnić od braku danych", () => {
    renderTable([row({ revenue_cents: null as unknown as number })]);
    expect(komorkiWiersza(0)[2]).toBe("0.00");
  });

  it("BRAK kolumny w odpowiedzi RPC wypisuje w komórce literalne 'NaN'", () => {
    const bezPola = { ...row() } as Record<string, unknown>;
    delete bezPola.revenue_cents;
    renderTable([bezPola as unknown as CouponAnalyticsRow]);
    expect(komorkiWiersza(0)[2]).toBe("NaN");
  });
});

describe("stopka z sumą rabatów", () => {
  it("suma pod tabelą ZGADZA SIĘ z sumą kolumny rabatu", () => {
    renderTable([
      row({ coupon_id: "c-1", discount_cents_total: 2000 }),
      row({ coupon_id: "c-2", code: "NES-B2", discount_cents_total: 550 }),
    ]);
    const kolumna = [komorkiWiersza(0)[3], komorkiWiersza(1)[3]];
    expect(kolumna).toEqual(["-20.00", "-5.50"]);
    expect(screen.getByText("25.50")).toBeInTheDocument();
  });

  it("stopka jest wypisana BEZ znaku minus, choć kolumna go ma - to ta sama liczba", () => {
    renderTable([row({ discount_cents_total: 2000 })]);
    expect(screen.getByText("20.00")).toBeInTheDocument();
  });

  it("BRAK kolumny rabatu w jednym wierszu zatruwa stopkę wartością NaN", () => {
    const bezPola = { ...row({ coupon_id: "c-2", code: "NES-B2" }) } as Record<string, unknown>;
    delete bezPola.discount_cents_total;
    renderTable([row(), bezPola as unknown as CouponAnalyticsRow]);
    expect(screen.getByText("NaN")).toBeInTheDocument();
  });
});

describe("liczba wierszy", () => {
  it("każdy kupon to jeden wiersz, a nagłówek nie jest liczony jako dane", () => {
    renderTable([row({ coupon_id: "c-1" }), row({ coupon_id: "c-2" }), row({ coupon_id: "c-3" })]);
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});
