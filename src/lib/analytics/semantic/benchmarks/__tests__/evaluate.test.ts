// Ocena wartości w pasmach benchmarku. Testy przypinają kontrakt AD-20:
// przedziały `[min, max)` z domkniętym ostatnim pasmem, otwarte końce,
// wyszukiwanie po ZAWARTOŚCI (etykiety się powtarzają, pasma `lower` rosną od
// „optymalnego”), normalizację skali i każdy powód braku oceny - żaden z nich
// nie może zamienić się w szary poziom udający ocenę.
import { describe, expect, it } from "vitest";
import type { LocalizedContext } from "../adapter";
import {
  SMALL_SAMPLE_N,
  contextDirection,
  evaluateMetric,
  normalizeToUnit,
  selectContext,
  tierOf,
  type EvaluatedBand,
} from "../evaluate";
import type { BenchContextSegment, Tier } from "../types";

function band(
  tier: Tier,
  min: number | null,
  max: number | null,
  basis: "B" | "E" = "B",
): EvaluatedBand {
  return { tier, min, max, basis };
}

/** Churn miesięczny news B2C - kierunek `lower`, pasma rosnąco po `min`. */
const CHURN: EvaluatedBand[] = [
  band("optimal", null, 2.7),
  band("good", 2.7, 3.5),
  band("normal", 3.5, 4.9),
  band("weak", 4.9, 7),
  band("critical", 7, null, "E"),
];

/** Udział planów rocznych - przedział docelowy z powtórzonymi etykietami. */
const ANNUAL_SHARE: EvaluatedBand[] = [
  band("weak", 0, 10),
  band("normal", 10, 25),
  band("optimal", 25, 50),
  band("normal", 50, 75),
  band("weak", 75, 100),
];

function ctx(
  id: string,
  bands: readonly EvaluatedBand[],
  extra: Partial<LocalizedContext> = {},
): LocalizedContext {
  return {
    id,
    label: id,
    segments: ["b2c_individual"],
    measure: "level",
    unit: "percent_pt",
    window: "month",
    direction: contextDirection({ bands }),
    method: "",
    sourceIds: ["src"],
    bands,
    ...extra,
  };
}

describe("tierOf - przedziały [min, max)", () => {
  const c = { id: "churn.news", bands: CHURN };

  it("granica należy do pasma, które się od niej ZACZYNA", () => {
    expect(tierOf(2.7, c)).toMatchObject({ tier: "good", basis: "B", contextId: "churn.news" });
    expect(tierOf(2.6999, c)).toMatchObject({ tier: "optimal" });
    expect(tierOf(4.9, c)).toMatchObject({ tier: "weak" });
    expect(tierOf(7, c)).toMatchObject({ tier: "critical", basis: "E" });
  });

  it("otwarte końce (null) to ±∞", () => {
    expect(tierOf(-1000, c)).toMatchObject({ tier: "optimal" });
    expect(tierOf(1e9, c)).toMatchObject({ tier: "critical" });
  });

  it("ostatnie pasmo jest domknięte z prawej, a wartość spoza dziedziny nie dostaje oceny", () => {
    const share = { id: "aps", bands: ANNUAL_SHARE };
    expect(tierOf(100, share)).toMatchObject({ tier: "weak", band: ANNUAL_SHARE[4] });
    expect(tierOf(100.01, share)).toEqual({ tier: "none", why: "incomparable", contextId: "aps" });
    expect(tierOf(-0.01, share)).toEqual({ tier: "none", why: "incomparable", contextId: "aps" });
  });

  it("wyszukuje po zawartości przedziału, nie po etykiecie ani kolejności", () => {
    const share = { id: "aps", bands: ANNUAL_SHARE };
    // „słaby” występuje dwa razy - wynik niesie WŁAŚCIWE pasmo, nie pierwsze o tej etykiecie.
    expect(tierOf(85, share)).toMatchObject({ tier: "weak", band: ANNUAL_SHARE[4] });
    expect(tierOf(5, share)).toMatchObject({ tier: "weak", band: ANNUAL_SHARE[0] });
    expect(tierOf(60, share)).toMatchObject({ tier: "normal", band: ANNUAL_SHARE[3] });
    // Odwrócona kolejność pasm nie zmienia wyniku.
    const reversed = { id: "aps", bands: [...ANNUAL_SHARE].reverse() };
    expect(tierOf(100, reversed)).toMatchObject({ tier: "weak", band: ANNUAL_SHARE[4] });
    expect(tierOf(30, reversed)).toMatchObject({ tier: "optimal" });
  });

  it("brak wartości to no_value, a nie najniższe pasmo", () => {
    expect(tierOf(null, c)).toEqual({ tier: "none", why: "no_value", contextId: "churn.news" });
    expect(tierOf(Number.NaN, c)).toEqual({
      tier: "none",
      why: "no_value",
      contextId: "churn.news",
    });
  });

  it("wynik niesie kierunek kontekstu i ocenioną wartość", () => {
    expect(tierOf(4.2, c)).toEqual({
      tier: "normal",
      band: CHURN[2],
      basis: "B",
      contextId: "churn.news",
      direction: "lower",
      value: 4.2,
    });
  });
});

describe("contextDirection - kierunek z sekwencji rang", () => {
  it("rosnąco = higher, malejąco = lower, wzrost i spadek = range", () => {
    expect(contextDirection({ bands: CHURN })).toBe("lower");
    expect(
      contextDirection({
        bands: [band("critical", null, 1), band("weak", 1, 2), band("optimal", 2, null)],
      }),
    ).toBe("higher");
    expect(contextDirection({ bands: ANNUAL_SHARE })).toBe("range");
  });

  it("monotoniczny kontekst wskaźnika przedziałowego dostaje własny kierunek (D4)", () => {
    // annual_plan_share B2B: wskaźnik `range`, ale pasma rosną monotonicznie.
    const b2b = [
      band("critical", 0, 10),
      band("weak", 10, 25),
      band("normal", 25, 45),
      band("good", 45, 55),
      band("optimal", 55, 100),
    ];
    expect(contextDirection({ bands: b2b, direction: "range" })).toBe("higher");
  });

  it("bez sekwencji (jedno pasmo, same równe rangi) zostaje deklaracja", () => {
    expect(contextDirection({ bands: [band("normal", null, null)], direction: "lower" })).toBe(
      "lower",
    );
    expect(contextDirection({ bands: [band("normal", 0, 1), band("normal", 1, 2)] })).toBe(
      "higher",
    );
  });
});

describe("normalizeToUnit - skala metryki → skala pasm", () => {
  it("ułamek → punkty procentowe ×100 (churn 0,049 to 4,9 pp, nie 0,049 %)", () => {
    expect(normalizeToUnit(0.049, "ratio", "percent_pt")).toBeCloseTo(4.9, 10);
    expect(normalizeToUnit(0.049, "ratio", "fraction")).toBe(0.049);
  });

  it("dni → godziny ×24, milisekundy → godziny", () => {
    expect(normalizeToUnit(30, "days", "hours")).toBe(720);
    expect(normalizeToUnit(5_400_000, "milliseconds", "hours")).toBe(1.5);
    expect(normalizeToUnit(3, "hours", "hours")).toBe(3);
  });

  it("grosze, krotności i miesiące przechodzą 1:1", () => {
    expect(normalizeToUnit(1900, "money_minor", "money_minor")).toBe(1900);
    expect(normalizeToUnit(3.2, "multiple", "multiple")).toBe(3.2);
    expect(normalizeToUnit(14, "months", "months")).toBe(14);
  });

  it("brak przeliczenia = null (ocena unit_mismatch)", () => {
    expect(normalizeToUnit(120, "count", "percent_pt")).toBeNull();
    expect(normalizeToUnit(1900, "money_minor", "percent_pt")).toBeNull();
    expect(normalizeToUnit(0.5, "score", "percent_pt")).toBeNull();
    expect(normalizeToUnit(Number.POSITIVE_INFINITY, "ratio", "percent_pt")).toBeNull();
  });
});

describe("selectContext - ctxId > segment > all", () => {
  const contexts: { id: string; segments: BenchContextSegment[] }[] = [
    { id: "m.news", segments: ["b2c_individual"] },
    { id: "m.smb", segments: ["b2b_institution"] },
    { id: "m.membership", segments: ["membership_club"] },
  ];
  const bench = { contexts, defaultContextBySegment: { all: "m.news", b2b_institution: "m.smb" } };

  it("jawny wybór wygrywa z segmentem", () => {
    expect(selectContext(bench, "b2b_institution", "m.membership")?.id).toBe("m.membership");
  });

  it("domyślny kontekst segmentu, potem ogólny", () => {
    expect(selectContext(bench, "b2b_institution")?.id).toBe("m.smb");
    expect(selectContext(bench, "membership_club")?.id).toBe("m.news");
    expect(selectContext(bench)?.id).toBe("m.news");
  });

  it("nieznane ctxId spada do domyślnego zamiast gasić ocenę", () => {
    expect(selectContext(bench, "b2b_institution", "m.removed")?.id).toBe("m.smb");
  });

  it("bez domyślnych - null", () => {
    expect(selectContext({ contexts, defaultContextBySegment: {} }, "events")).toBeNull();
  });
});

describe("evaluateMetric - pełna ocena i każdy powód braku oceny", () => {
  const churnBench = {
    contexts: [ctx("logo_churn_monthly.news_b2c", CHURN)],
    defaultContextBySegment: { all: "logo_churn_monthly.news_b2c" },
  };
  const moneyBench = {
    contexts: [
      ctx(
        "arpu.pl_net",
        [
          band("weak", null, 1200),
          band("normal", 1200, 1800),
          band("good", 1800, 2500),
          band("optimal", 2500, null),
        ],
        {
          unit: "money_minor",
          currency: "PLN",
          vat: "net",
        },
      ),
      ctx(
        "arpu.pl_gross",
        [band("weak", null, 1500), band("normal", 1500, 2500), band("good", 2500, null)],
        {
          unit: "money_minor",
          currency: "PLN",
          vat: "gross",
        },
      ),
      ctx(
        "arpu.usd",
        [band("weak", null, 600), band("normal", 600, 800), band("good", 800, null)],
        {
          unit: "money_minor",
          currency: "USD",
          vat: "net",
        },
      ),
      ctx("arpu.yoy", [band("weak", null, 0), band("normal", 0, 5), band("good", 5, null)], {
        measure: "change_yoy",
      }),
    ],
    defaultContextBySegment: { all: "arpu.pl_net" },
  };

  it("ocenia churn z ułamka po normalizacji do punktów procentowych", () => {
    expect(evaluateMetric({ value: 0.049, unit: "ratio", n: 400 }, churnBench)).toMatchObject({
      tier: "weak",
      value: expect.closeTo(4.9, 10),
      direction: "lower",
      contextId: "logo_churn_monthly.news_b2c",
    });
  });

  it("ocenia kwotę netto w groszach w tej samej walucie", () => {
    expect(
      evaluateMetric({ value: 1900, unit: "money_minor", currency: "PLN", vat: "net" }, moneyBench),
    ).toMatchObject({
      tier: "good",
      contextId: "arpu.pl_net",
    });
  });

  it("no_benchmark: brak wpisu albo wpis bez kontekstów", () => {
    expect(evaluateMetric({ value: 1, unit: "ratio" }, null)).toEqual({
      tier: "none",
      why: "no_benchmark",
    });
    expect(
      evaluateMetric({ value: 1, unit: "ratio" }, { contexts: [], defaultContextBySegment: {} }),
    ).toEqual({
      tier: "none",
      why: "no_benchmark",
    });
  });

  it("no_context: żaden kontekst nie pasuje do wyboru ani segmentu", () => {
    const bench = { contexts: churnBench.contexts, defaultContextBySegment: {} };
    expect(evaluateMetric({ value: 0.03, unit: "ratio", segment: "events" }, bench)).toEqual({
      tier: "none",
      why: "no_context",
    });
  });

  it("no_data: pusta baza; no_value: brak liczby", () => {
    expect(evaluateMetric({ value: null, unit: "ratio", n: 0 }, churnBench)).toMatchObject({
      why: "no_data",
    });
    expect(evaluateMetric({ value: null, unit: "ratio" }, churnBench)).toMatchObject({
      tier: "none",
      why: "no_value",
      contextId: "logo_churn_monthly.news_b2c",
    });
  });

  it(`small_sample: n < ${SMALL_SAMPLE_N}, a przy ${SMALL_SAMPLE_N} już ocena`, () => {
    expect(
      evaluateMetric({ value: 0.03, unit: "ratio", n: SMALL_SAMPLE_N - 1 }, churnBench),
    ).toMatchObject({
      why: "small_sample",
    });
    expect(
      evaluateMetric({ value: 0.03, unit: "ratio", n: SMALL_SAMPLE_N }, churnBench),
    ).toMatchObject({
      tier: "good",
    });
  });

  it("measure_mismatch: podana wielkość różni się od kontekstu", () => {
    expect(
      evaluateMetric(
        { value: 0.03, unit: "ratio", measure: "change_yoy", ctxId: "arpu.pl_net" },
        moneyBench,
      ),
    ).toMatchObject({ why: "measure_mismatch", contextId: "arpu.pl_net" });
    // Wielkość zgodna - ocena.
    expect(
      evaluateMetric(
        { value: 0.03, unit: "ratio", measure: "change_yoy", ctxId: "arpu.yoy" },
        moneyBench,
      ),
    ).toMatchObject({ tier: "normal" });
  });

  it("currency_mismatch: PLN wobec pasma USD (D7) i kwota bez waluty", () => {
    expect(
      evaluateMetric(
        { value: 900, unit: "money_minor", currency: "PLN", ctxId: "arpu.usd" },
        moneyBench,
      ),
    ).toMatchObject({ why: "currency_mismatch", contextId: "arpu.usd" });
    expect(evaluateMetric({ value: 900, unit: "money_minor" }, moneyBench)).toMatchObject({
      why: "currency_mismatch",
    });
  });

  it("vat_mismatch: pasmo brutto przy kwocie netto (domyślnie netto) i odwrotnie", () => {
    expect(
      evaluateMetric(
        { value: 1900, unit: "money_minor", currency: "PLN", ctxId: "arpu.pl_gross" },
        moneyBench,
      ),
    ).toMatchObject({ why: "vat_mismatch" });
    expect(
      evaluateMetric(
        { value: 1900, unit: "money_minor", currency: "PLN", vat: "gross" },
        moneyBench,
      ),
    ).toMatchObject({ why: "vat_mismatch", contextId: "arpu.pl_net" });
  });

  it("unit_mismatch: brak przeliczenia jednostki (licznik wobec pasma procentowego, procent wobec kwoty)", () => {
    expect(evaluateMetric({ value: 120, unit: "count" }, churnBench)).toMatchObject({
      why: "unit_mismatch",
    });
    expect(
      evaluateMetric({ value: 0.2, unit: "ratio", currency: "PLN" }, moneyBench),
    ).toMatchObject({
      why: "unit_mismatch",
    });
  });

  it("incomparable: wartość poza dziedziną pasm", () => {
    const shareBench = {
      contexts: [ctx("aps.media", ANNUAL_SHARE, { measure: "share_of_base" })],
      defaultContextBySegment: { all: "aps.media" },
    };
    expect(evaluateMetric({ value: 1.2, unit: "ratio" }, shareBench)).toMatchObject({
      why: "incomparable",
      contextId: "aps.media",
    });
    expect(evaluateMetric({ value: 0.3, unit: "ratio" }, shareBench)).toMatchObject({
      tier: "optimal",
    });
  });
});
