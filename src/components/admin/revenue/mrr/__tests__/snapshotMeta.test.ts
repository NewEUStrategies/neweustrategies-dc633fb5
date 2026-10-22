// `snapshotMetaOf` (I9, Z-S7-06 / Z-S2-05): waluta wiodąca wskaźników
// ilorazowych z migawki, nie z kopii reguły w panelu.
//
// Regresja, której dowodzi ten plik: dawna kopia reguły patrzyła tylko na
// MRR i przychód zrealizowany. Najemca, którego jedyne kwoty w oknie to
// zamówienia albo bilety wydarzeń, dostawał podpis „brak waluty", choć
// serwer liczył NRR/GRR w konkretnej walucie (`ratioCurrency`).
import { describe, expect, it } from "vitest";

import { snapshotMetaOf } from "@/components/admin/revenue/mrr/useSnapshotMeta";

const BASE = { dataSince: "2026-01-01", entries: [] } as const;

describe("snapshotMetaOf - waluta wiodąca z migawki", () => {
  it("bez filtra: `ratioCurrency` serwera, także gdy MRR i przychód są puste", () => {
    expect(snapshotMetaOf({ ...BASE, ratioCurrency: "EUR" }, null).leadingCurrency).toBe("EUR");
  });

  it("filtr `?cur=` wygrywa (migawka liczona w tej samej walucie)", () => {
    expect(snapshotMetaOf({ ...BASE, ratioCurrency: "PLN" }, "EUR").leadingCurrency).toBe("EUR");
  });

  it("migawka bez kwot - `null`, nie zgadywanie", () => {
    expect(snapshotMetaOf({ ...BASE, ratioCurrency: null }, null).leadingCurrency).toBeNull();
  });

  it("dzień początku księgi i win-back przechodzą bez zmian", () => {
    const meta = snapshotMetaOf(
      {
        dataSince: "2025-03-01",
        ratioCurrency: "PLN",
        entries: [
          {
            metricId: "winback_rate_12m",
            canonicalValue: 0.12,
          } as never,
        ],
      },
      null,
    );
    expect(meta).toEqual({ dataSince: "2025-03-01", leadingCurrency: "PLN", winback12m: 0.12 });
  });
});
