// Organizm: historia realizacji kuponów - RAPORT FINANSOWY na ekranie.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY KOLUMNY PIENIĘDZY liczą się z semantyki `couponMoney`, a nie
//      z nazwy kolumny bazy: „Rabat" to `applied_cents`, „Zapłacono" to
//      `original - applied`. Podmiana tych dwóch kolumn nie psuje żadnego typu
//      i nie widać jej w recenzji - a sprawia, że kupon o największym rabacie
//      wygląda na najbardziej dochodowy.
//   2. Rabat WIĘKSZY od kwoty zamówienia (dane niespójne) daje „0.00",
//      a nie liczbę ujemną - zacisk mieszka w helperze i musi tu być widoczny.
//   3. Utrata osadzonego kuponu (PostgREST oddaje TABLICĘ zamiast obiektu,
//      a podwójne rzutowanie w trasie to ukrywa) zamienia kod na „-" BEZ
//      żadnego błędu. Dowód stoi na wierszu z `b2b_coupons: null`.
//   4. Identyfikator użytkownika jest SKRACANY do ośmiu znaków na ekranie.
//   5. Trzy stany zawartości są rozłączne, a błąd odczytu jest nieodróżnialny
//      od pustego zakresu (defekt zgłoszony w teście trasy).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki `couponMoney` (ma własny plik) -
// dowodzimy UŻYCIA. Plakietki planu (`redemptionsParts.test.tsx`).
//
// RODO: identyfikatory w fixture'ach są jawnie fałszywe, bez e-maili.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  RedemptionsTable,
  type RedemptionTableRow,
  type RedemptionsTableLabels,
} from "@/components/admin/coupons/organisms/RedemptionsTable";

afterEach(cleanup);

const LABELS: RedemptionsTableLabels = {
  title: "Historia realizacji",
  loading: "Wczytywanie…",
  empty: "Brak realizacji w zakresie.",
  date: "Data",
  code: "Kod",
  user: "Użytkownik",
  beforeDiscount: "Przed rabatem",
  discount: "Rabat",
  paid: "Zapłacono",
  plan: "Plan",
  granted: "nadano",
  awaiting: "czeka na płatność",
};

function redemption(overrides: Partial<RedemptionTableRow> = {}): RedemptionTableRow {
  return {
    id: "red-1",
    user_id: "9f8e7d6c-1111-2222-3333-444455556666",
    applied_cents: 2000,
    original_cents: 10000,
    currency: "PLN",
    created_at: "2026-08-20T10:00:00.000Z",
    effects_applied_at: null,
    b2b_coupons: { code: "NES-A1B2", name: "VIP", grants_tier_key: null },
    ...overrides,
  };
}

function renderTable(overrides: Partial<Parameters<typeof RedemptionsTable>[0]> = {}) {
  render(
    <RedemptionsTable
      rows={[redemption()]}
      loading={false}
      lang="pl"
      labels={LABELS}
      {...overrides}
    />,
  );
}

/** Teksty komórek jedynego wiersza danych. */
function komorki(): string[] {
  const wiersz = screen.getAllByRole("row")[1];
  return within(wiersz)
    .getAllByRole("cell")
    .map((c) => c.textContent ?? "");
}

describe("stany zawartości", () => {
  it("wczytywanie pokazuje komunikat zamiast tabeli", () => {
    renderTable({ loading: true, rows: [] });
    expect(screen.getByText("Wczytywanie…")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("pusty zakres mówi WPROST, że w zakresie nie ma realizacji", () => {
    renderTable({ rows: [] });
    expect(screen.getByText("Brak realizacji w zakresie.")).toBeInTheDocument();
  });

  it("odmowa bazy dałaby TEN SAM napis co pusty zakres - organizm nie zna stanu błędu", () => {
    // Defekt jest zgłoszony przez `it.fails` w teście trasy; tutaj utrwalamy,
    // że warstwa widoku ma tylko dwa stany braku danych.
    renderTable({ rows: [] });
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
  });

  it("tabela ma siedem kolumn - komplet raportu, nie podzbiór", () => {
    renderTable();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Data",
      "Kod",
      "Użytkownik",
      "Przed rabatem",
      "Rabat",
      "Zapłacono",
      "Plan",
    ]);
  });
});

describe("kolumny pieniędzy", () => {
  it("100 zł przed rabatem, 20 zł rabatu, 80 zł zapłacone - rabat NIE jest kwotą zapłaconą", () => {
    renderTable({ rows: [redemption({ original_cents: 10000, applied_cents: 2000 })] });
    const c = komorki();
    expect(c[3]).toBe("100.00 PLN");
    expect(c[4]).toBe("-20.00 PLN");
    expect(c[5]).toBe("80.00 PLN");
  });

  it("rabat WIĘKSZY od kwoty zamówienia daje zapłacone 0.00, a nie wartość ujemną", () => {
    renderTable({ rows: [redemption({ original_cents: 1000, applied_cents: 3000 })] });
    expect(komorki()[5]).toBe("0.00 PLN");
  });

  it("rabat zerowy pokazuje '-0.00' i pełną kwotę zapłaconą", () => {
    renderTable({ rows: [redemption({ original_cents: 5000, applied_cents: 0 })] });
    expect(komorki()[4]).toBe("-0.00 PLN");
    expect(komorki()[5]).toBe("50.00 PLN");
  });

  it("waluta wiersza jest wypisana przy KAŻDEJ z trzech kwot", () => {
    renderTable({ rows: [redemption({ currency: "EUR" })] });
    const c = komorki();
    expect(c[3]).toContain("EUR");
    expect(c[4]).toContain("EUR");
    expect(c[5]).toContain("EUR");
  });
});

describe("kolumna kodu i użytkownika", () => {
  it("kod i nazwa kuponu pochodzą z osadzonej relacji", () => {
    renderTable();
    expect(screen.getByText("NES-A1B2")).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
  });

  it("UTRATA osadzonego kuponu zamienia kod na '-' i nie zgłasza żadnego błędu", () => {
    renderTable({ rows: [redemption({ b2b_coupons: null })] });
    expect(komorki()[1]).toBe("-");
    expect(komorki()[6]).toBe("-");
  });

  it("kupon bez nazwy pokazuje sam kod, bez pustego wiersza podpisu", () => {
    renderTable({
      rows: [redemption({ b2b_coupons: { code: "NES-A1B2", name: null, grants_tier_key: null } })],
    });
    expect(komorki()[1]).toBe("NES-A1B2");
  });

  it("identyfikator użytkownika jest SKRACANY do ośmiu znaków", () => {
    renderTable();
    expect(komorki()[2]).toBe("9f8e7d6c");
  });

  it("realizacja bez użytkownika (gość) pokazuje kreskę", () => {
    renderTable({ rows: [redemption({ user_id: null })] });
    expect(komorki()[2]).toBe("-");
  });
});

describe("data realizacji", () => {
  it("ten sam znacznik czasu daje INNY napis po polsku i po angielsku", () => {
    renderTable({ rows: [redemption({ created_at: "2026-01-05T10:00:00.000Z" })], lang: "pl" });
    const pl = komorki()[0];
    cleanup();
    renderTable({ rows: [redemption({ created_at: "2026-01-05T10:00:00.000Z" })], lang: "en" });
    expect(komorki()[0]).not.toBe(pl);
  });

  it("USZKODZONA data wypisuje 'Invalid Date' zamiast wywalać cały raport", () => {
    renderTable({ rows: [redemption({ created_at: "nie-data" })] });
    expect(komorki()[0]).toBe("Invalid Date");
  });
});

describe("wiele wierszy", () => {
  it("każda realizacja to osobny wiersz, także przy tym samym kuponie", () => {
    renderTable({
      rows: [redemption({ id: "red-1" }), redemption({ id: "red-2" }), redemption({ id: "red-3" })],
    });
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});
