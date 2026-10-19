// Kontrakt parametrów URL huba (SPEC §2.3). Walidator jedzie w powłoce trasy,
// czyli w chunku WEJŚCIOWYM - stąd test zera importów na źródle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bezKomentarzy } from "@/lib/ci/sourceScan";
import {
  JOURNEY_STATUSES,
  REVENUE_PERIODS,
  REVENUE_SEARCH_QUERY_MAX,
  REVENUE_SECTIONS,
  REVENUE_SEGMENTS,
  REVENUE_TABS,
  REVENUE_TRACKS,
  REVENUE_VIEWS,
  isRevenueTab,
  parseRevenueHubSearch,
  type RevenueHubSearch,
} from "../search";

/** Tak router składa wyszukiwanie dziecka: surowy adres nadpisany walidatorem. */
const poRouterze = (raw: Record<string, unknown>) => ({ ...raw, ...parseRevenueHubSearch(raw) });

describe("search.ts - liść bez importów", () => {
  it("źródło nie importuje niczego", () => {
    const kod = bezKomentarzy(readFileSync("src/lib/revenue/search.ts", "utf8"));
    expect(kod).not.toMatch(/^\s*import\b/m);
    expect(kod).not.toMatch(/\bimport\s*\(|\brequire\s*\(|^\s*export\s+[^;]*\bfrom\b/m);
  });
});

describe("listy kontraktu", () => {
  it("zakładki, okresy i segmenty są dokładnie takie jak w SPEC", () => {
    expect(REVENUE_TABS).toEqual([
      "overview",
      "mrr",
      "funnel",
      "retention",
      "community",
      "diagnostics",
      "offer",
      "access",
      "journeys",
      "metrics",
      "inputs",
    ]);
    expect(REVENUE_PERIODS).toEqual([
      "week",
      "month",
      "prev-month",
      "quarter",
      "half-year",
      "year",
      "ltm",
      "custom",
    ]);
    expect(REVENUE_SEGMENTS).toEqual(["all", "b2c_individual", "b2c_reduced", "b2b_institution"]);
  });

  it("isRevenueTab przyjmuje wyłącznie zakładki", () => {
    expect(REVENUE_TABS.every(isRevenueTab)).toBe(true);
    for (const raw of ["nope", "Overview", "", 1, null, undefined, ["mrr"]]) {
      expect(isRevenueTab(raw)).toBe(false);
    }
  });
});

describe("parseRevenueHubSearch - poprawne wartości przechodzą", () => {
  const listy: [keyof RevenueHubSearch, readonly string[]][] = [
    ["w", REVENUE_PERIODS],
    ["seg", REVENUE_SEGMENTS],
    ["view", REVENUE_VIEWS],
    ["track", REVENUE_TRACKS],
    ["sec", REVENUE_SECTIONS],
    ["status", JOURNEY_STATUSES],
  ];
  it.each(listy)("%s: każda wartość z listy", (klucz, lista) => {
    for (const wartosc of lista) {
      expect(parseRevenueHubSearch({ [klucz]: wartosc })).toEqual({ [klucz]: wartosc });
    }
  });

  it("pełny adres zostaje w całości", () => {
    const pelny = {
      w: "custom",
      from: "2026-01-01",
      to: "2026-03-31",
      cur: "PLN",
      seg: "b2c_reduced",
      metric: "net_revenue_retention",
      ctx: "b2c_media_pl",
      finding: "catalog.plan_without_tier",
      fix: "catalog.plan_without_tier",
      area: "catalog",
      view: "map",
      stage: "mql",
      track: "sales",
      sec: "events",
      status: "paused",
      q: "kongres",
      new: "1",
      template: "welcome_onboarding",
    };
    expect(parseRevenueHubSearch(pelny)).toStrictEqual(pelny);
  });
});

describe("parseRevenueHubSearch - nieznane i zdeformowane odpadają", () => {
  it("pusty adres daje pusty obiekt - bez kluczy `undefined`", () => {
    expect(parseRevenueHubSearch({})).toStrictEqual({});
  });

  it("nieznane klucze nie trafiają do wyniku", () => {
    expect(parseRevenueHubSearch({ utm_source: "x", tab: "mrr" })).toStrictEqual({});
  });

  it("odrzucona wartość ZNANEGO klucza nie przecieka przez scalenie routera", () => {
    // Router robi `{ ...surowy, ...zwalidowany }` - klucz pominięty w wyniku
    // przepuściłby `?w=wczoraj` do komponentu z typem `RevenuePeriod`.
    const raw = {
      w: "wczoraj",
      seg: "membership_club",
      cur: "pln",
      view: "grid",
      track: "partner",
      sec: "offers",
      status: "deleted",
      new: "yes",
      metric: "<script>",
    };
    const wynik = poRouterze(raw);
    for (const klucz of Object.keys(raw)) {
      expect(wynik[klucz as keyof typeof wynik], klucz).toBeUndefined();
    }
  });

  it("kod waluty: trzy WIELKIE litery", () => {
    expect(parseRevenueHubSearch({ cur: "EUR" })).toEqual({ cur: "EUR" });
    for (const cur of ["eur", "EURO", "EU", "E1R", 978]) {
      expect(parseRevenueHubSearch({ cur }).cur).toBeUndefined();
    }
  });

  it("identyfikatory: znaki identyfikatora, bez spacji, ukośników i znaczników", () => {
    expect(parseRevenueHubSearch({ finding: "data_quality.ledger_drift" }).finding).toBe(
      "data_quality.ledger_drift",
    );
    for (const metric of ["a b", "x/y", "<b>", "", "-lead", "m".repeat(121)]) {
      expect(parseRevenueHubSearch({ metric }).metric, metric).toBeUndefined();
    }
    expect(parseRevenueHubSearch({ metric: "m".repeat(120) }).metric).toHaveLength(120);
  });

  it("`new` przyjmuje wyłącznie 1 (także jako liczbę z parsera adresu)", () => {
    expect(parseRevenueHubSearch({ new: 1 })).toEqual({ new: "1" });
    expect(parseRevenueHubSearch({ new: "1" })).toEqual({ new: "1" });
    expect(parseRevenueHubSearch({ new: 2 }).new).toBeUndefined();
  });
});

describe("parseRevenueHubSearch - granice okresu własnego", () => {
  it("from/to przechodzą tylko przy w=custom", () => {
    expect(parseRevenueHubSearch({ w: "custom", from: "2026-10-01", to: "2026-10-31" })).toEqual({
      w: "custom",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    for (const w of [undefined, "month", "ltm"]) {
      const wynik = poRouterze({ w, from: "2026-10-01", to: "2026-10-31" });
      expect(wynik.from, String(w)).toBeUndefined();
      expect(wynik.to, String(w)).toBeUndefined();
    }
  });

  it("data musi istnieć w kalendarzu i mieć postać YYYY-MM-DD", () => {
    for (const from of [
      "2026-02-30",
      "2026-13-01",
      "2026-1-01",
      "01.10.2026",
      "2026-10-01T00:00",
    ]) {
      expect(parseRevenueHubSearch({ w: "custom", from }).from, from).toBeUndefined();
    }
    expect(parseRevenueHubSearch({ w: "custom", from: "2028-02-29" }).from).toBe("2028-02-29");
    expect(parseRevenueHubSearch({ w: "custom", from: "2027-02-29" }).from).toBeUndefined();
  });
});

describe("parseRevenueHubSearch - fraza wyszukiwania", () => {
  it("białe znaki na brzegach są obcinane, pusta fraza znika", () => {
    expect(parseRevenueHubSearch({ q: "  kongres  " })).toEqual({ q: "kongres" });
    expect(parseRevenueHubSearch({ q: "   " }).q).toBeUndefined();
  });

  it(`fraza dłuższa niż ${REVENUE_SEARCH_QUERY_MAX} znaków jest ODRZUCANA, nie przycinana`, () => {
    const max = "x".repeat(REVENUE_SEARCH_QUERY_MAX);
    expect(parseRevenueHubSearch({ q: max }).q).toBe(max);
    expect(parseRevenueHubSearch({ q: `${max}y` }).q).toBeUndefined();
  });

  it("liczba z parsera adresu (`?q=2026`) wraca jako tekst", () => {
    expect(parseRevenueHubSearch({ q: 2026 })).toEqual({ q: "2026" });
  });
});
