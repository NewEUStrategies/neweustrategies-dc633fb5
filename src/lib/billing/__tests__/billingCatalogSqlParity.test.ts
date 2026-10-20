// PARYTET KATALOGU CEN: TS ⇄ SQL (S2, SPEC §8.3, R-06).
//
// Księga MRR liczy się w SQL (trigger historii subskrypcji), a cennik, kasa
// i panel - w TS. Trzy rzeczy muszą być JEDNĄ definicją po obu stronach:
//   1. pozycje katalogu (`billing_catalog_entry` = BILLING_CATALOG +
//      BILLING_CATALOG_LEGACY) - inaczej subskrypcja nowej ceny nie ma
//      warstwy ani cyklu w księdze;
//   2. miesiące na cykl (`billing_months_per_interval` = `monthlyEquivalent`) -
//      wspólny zestaw przypadków z pgTAP (`-- fixture:monthly-equivalent`);
//   3. MRR z katalogu (`subscription_mrr_minor` = `catalogPlanQuote` +
//      `monthlyEquivalent`) - wspólny zestaw `-- fixture:catalog-mrr`.
// Test czyta migrację i plik pgTAP jako tekst (bez bazy). pgTAP sprawdza te
// same zestawy po stronie bazy, więc rozjazd zapala jedną z dwóch bramek.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BILLING_CATALOG,
  BILLING_CATALOG_LEGACY,
  catalogEntryByPriceId,
  ledgerCatalogEntryByPriceId,
  type CatalogPriceEntry,
} from "@/lib/billing/catalog";
import { monthlyEquivalent } from "@/lib/billing/subscriptionRepricing";
import {
  catalogMrrMinor,
  cycleOfCatalogEntry,
  mrrMinorFromAmount,
} from "@/lib/revenue/finance/mrrMath";

const MIGRACJA = "supabase/migrations/20261020110000_revenue_catalog_mirror.sql";
const PGTAP = "supabase/tests/revenue_catalog_mirror_test.sql";

function plik(sciezka: string): string {
  expect(existsSync(sciezka), `brak pliku: ${sciezka}`).toBe(true);
  return readFileSync(sciezka, "utf8");
}

/**
 * Linie między znacznikami `-- <nazwa>:begin` i `-- <nazwa>:end` stojącymi
 * w OSOBNYCH liniach - nagłówek migracji cytuje znaczniki w zdaniu, więc
 * zwykłe `indexOf` trafiłoby w komentarz zamiast w blok.
 */
function blok(tekst: string, nazwa: string): string {
  const linia = (rodzaj: "begin" | "end") =>
    new RegExp(`^[ \\t]*-- ${nazwa.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:${rodzaj}[ \\t]*$`, "m");
  const start = linia("begin").exec(tekst);
  const koniec = linia("end").exec(tekst);
  expect(start, `brak znacznika ${nazwa}:begin`).not.toBeNull();
  expect(koniec, `brak znacznika ${nazwa}:end`).not.toBeNull();
  expect(koniec!.index).toBeGreaterThan(start!.index);
  return tekst.slice(start!.index, koniec!.index);
}

/** Krotki SQL `( ... )` z bloku jako listy surowych wartości. */
function krotki(tekst: string): string[][] {
  return [...tekst.matchAll(/^\s*\(([^()]*)\),?\s*;?\s*$/gm)].map((m) =>
    m[1].split(",").map((pole) => pole.trim()),
  );
}

const napis = (raw: string) => raw.replace(/^'|'$/g, "");
const bool = (raw: string) => raw === "true";
const liczbaLubNull = (raw: string) => (raw === "NULL" ? null : Number(raw));

interface WierszKatalogu {
  priceId: string;
  productId: string;
  tierKey: string;
  interval: string;
  rank: number;
  perSeat: boolean;
  volumeTiered: boolean;
  oneTime: boolean;
  legacy: boolean;
}

function katalogSql(): WierszKatalogu[] {
  return krotki(blok(plik(MIGRACJA), "katalog")).map(
    ([priceId, productId, tierKey, interval, rank, perSeat, volumeTiered, oneTime, legacy]) => ({
      priceId: napis(priceId),
      productId: napis(productId),
      tierKey: napis(tierKey),
      interval: napis(interval),
      rank: Number(rank),
      perSeat: bool(perSeat),
      volumeTiered: bool(volumeTiered),
      oneTime: bool(oneTime),
      legacy: bool(legacy),
    }),
  );
}

function katalogTs(): WierszKatalogu[] {
  return [...BILLING_CATALOG, ...BILLING_CATALOG_LEGACY].map((e: CatalogPriceEntry) => ({
    priceId: e.priceId,
    productId: e.productId,
    tierKey: e.tierKey,
    interval: e.interval,
    rank: e.rank,
    perSeat: e.perSeat === true,
    volumeTiered: e.volumeTiered === true,
    oneTime: e.oneTime === true,
    legacy: e.legacy === true,
  }));
}

describe("billing_catalog_entry = BILLING_CATALOG + BILLING_CATALOG_LEGACY", () => {
  it("te same pozycje, w tej samej kolejności, pole po polu", () => {
    expect(katalogSql()).toEqual(katalogTs());
  });

  it("katalog v6.2 zawiera student_annual (student / rok / ranga 11)", () => {
    const wiersz = katalogSql().find((w) => w.priceId === "student_annual");
    expect(wiersz).toMatchObject({ tierKey: "student", interval: "year", rank: 11, legacy: false });
  });

  it("wpisy legacy są tylko w lustrze księgi - kasa i webhook ich nie znają", () => {
    for (const entry of BILLING_CATALOG_LEGACY) {
      expect(entry.legacy).toBe(true);
      expect(catalogEntryByPriceId(entry.priceId)).toBeNull();
      expect(ledgerCatalogEntryByPriceId(entry.priceId)).toEqual(entry);
    }
  });

  it("klucz ceny jest unikalny w obu katalogach razem", () => {
    const klucze = katalogTs().map((w) => w.priceId);
    expect(new Set(klucze).size).toBe(klucze.length);
  });
});

describe("billing_months_per_interval = monthlyEquivalent (wspólny fixture z pgTAP)", () => {
  const przypadki = krotki(blok(plik(PGTAP), "fixture:monthly-equivalent")).map(
    ([interval, count, amount, mrr]) => ({
      interval: napis(interval),
      count: Number(count),
      amount: Number(amount),
      mrr: Number(mrr),
    }),
  );

  it("fixture nie jest pusty i obejmuje oba słowniki cykli", () => {
    expect(przypadki.length).toBeGreaterThanOrEqual(10);
    const cykle = new Set(przypadki.map((p) => p.interval));
    for (const c of ["day", "week", "month", "year", "two_weeks", "quarter"])
      expect(cykle).toContain(c);
  });

  it.each(
    krotki(blok(plik(PGTAP), "fixture:monthly-equivalent")).map(([i, c, a, m]) => [
      `${napis(i)} × ${c}: ${a} -> ${m}`,
      napis(i),
      Number(c),
      Number(a),
      Number(m),
    ]),
  )("%s", (_opis, interval, count, amount, mrr) => {
    // Słownik aplikacji tłumaczy ta sama funkcja co synchronizacja katalogu
    // (`catalogRecurringFor`); krotność z fixture mnoży jej cykl, jak w SQL.
    const aplikacji =
      interval === "two_weeks" || interval === "quarter"
        ? cycleOfCatalogEntry({ priceId: "x", productId: "x", tierKey: "x", interval, rank: 0 })
        : null;
    const cykl = aplikacji
      ? {
          interval: aplikacji.interval,
          intervalCount: aplikacji.intervalCount * Math.max(count, 1),
        }
      : { interval: interval as "day" | "week" | "month" | "year", intervalCount: count };
    expect(Math.round(monthlyEquivalent(amount, cykl))).toBe(mrr);
    expect(mrrMinorFromAmount(amount, cykl)).toBe(mrr);
  });
});

describe("subscription_mrr_minor (katalog) = catalogPlanQuote + monthlyEquivalent", () => {
  const przypadki = krotki(blok(plik(PGTAP), "fixture:catalog-mrr")).map(
    ([priceId, seats, cents, threshold, volume, mrr]) => ({
      priceId: napis(priceId),
      seats: Number(seats),
      cents: Number(cents),
      threshold: liczbaLubNull(threshold),
      volume: liczbaLubNull(volume),
      mrr: Number(mrr),
    }),
  );

  it("fixture obejmuje próg wolumenowy, limit miejsc i plan bez miejsc", () => {
    expect(przypadki.some((p) => p.threshold !== null && p.seats >= (p.threshold ?? 0))).toBe(true);
    expect(przypadki.some((p) => p.seats > 100)).toBe(true);
    expect(przypadki.some((p) => p.priceId === "plus_monthly" && p.seats > 1)).toBe(true);
  });

  it.each(przypadki.map((p) => [`${p.priceId} × ${p.seats}`, p] as const))("%s", (_opis, p) => {
    const entry = catalogEntryByPriceId(p.priceId);
    expect(entry, p.priceId).not.toBeNull();
    const mrr = catalogMrrMinor(
      {
        tier_key: entry!.tierKey,
        interval: entry!.interval,
        price_cents: p.cents,
        volume_threshold_seats: p.threshold,
        volume_price_cents: p.volume,
      },
      p.seats,
    );
    expect(mrr).toBe(p.mrr);
  });
});
