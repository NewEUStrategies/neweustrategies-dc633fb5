// @vitest-environment node
// PARYTET PL/EN TREŚCI BENCHMARKÓW (karta S6, kryterium 2; SPEC §5.5).
//
// Treść rejestru to DANE z datą i przypisem, nie napisy interfejsu - dlatego
// nie pilnuje jej bramka słowników `i18nParity.gate`. Ten test jest jej
// odpowiednikiem dla pól `Bi`: nazwa, rozwinięcie skrótu, wzór,
// interpretacja, dźwignie, zastrzeżenia, etykiety i metody kontekstów, noty
// pasm i powód braku metryki.
//
// BEZ LISTY WYJĄTKÓW - ŚWIADOMIE. Wyjątek dodany „na chwilę” zostaje na
// zawsze i uczy, że parytet jest negocjowalny. Jedyną regułą rozluźniającą
// jest wzór napisu FORMALNEGO (sam wzór, skrót, liczby i operatory - np.
// „ARR = MRR × 12”), który w obu językach jest z definicji ten sam. Nazwa
// własna z polskim znakiem w EN jest transliterowana („Nowy Swiat”), a nota
// typu „P50–P75” dostaje angielskie słowa („median (P50) to P75”).
import { describe, expect, it } from "vitest";
import type { GeneratedBenchmark } from "../adapter";
import { COMMUNITY_BENCHMARKS } from "../groups/community.server";
import { ECONOMICS_BENCHMARKS } from "../groups/economics.server";
import { EMAIL_BENCHMARKS } from "../groups/email.server";
import { FUNNEL_BENCHMARKS } from "../groups/funnel.server";
import { RETENTION_BENCHMARKS } from "../groups/retention.server";
import { REVENUE_BENCHMARKS } from "../groups/revenue.server";
import type { Bi } from "../types";

const ALL: readonly GeneratedBenchmark[] = [
  ...REVENUE_BENCHMARKS,
  ...RETENTION_BENCHMARKS,
  ...ECONOMICS_BENCHMARKS,
  ...FUNNEL_BENCHMARKS,
  ...EMAIL_BENCHMARKS,
  ...COMMUNITY_BENCHMARKS,
];

/** Polskie litery diakrytyczne - w EN oznaczają nieprzetłumaczony fragment. */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/u;

/** Napis formalny (wzór, skrót, liczby, operatory) - jedyny, który może być identyczny w PL i EN. */
const FORMAL = /^[\p{Lu}\d\s%/×→()+\-−.,:=<>≤≥]+$/u;

interface Field {
  where: string;
  text: Bi;
}

/** Każde pole `Bi` rejestru z adresem do komunikatu błędu. */
function biFields(): Field[] {
  const out: Field[] = [];
  for (const b of ALL) {
    const add = (name: string, text: Bi | undefined): void => {
      if (text) out.push({ where: `${b.key}.${name}`, text });
    };
    add("name", b.name);
    add("expansion", b.expansion);
    add("formula", b.formula);
    add("interpretation", b.interpretation);
    add("levers", b.levers);
    add("noMetricReason", b.noMetricReason);
    b.caveats.forEach((c, i) => add(`caveats[${i}]`, c.text));
    for (const c of b.contexts) {
      add(`${c.id}.label`, c.label);
      add(`${c.id}.method`, c.method);
      c.bands.forEach((band, i) => add(`${c.id}.bands[${i}].note`, band.note));
    }
  }
  return out;
}

const FIELDS = biFields();

describe("parytet PL/EN pól Bi rejestru benchmarków", () => {
  it("zbiór pól jest pełny: 77 wpisów × pola stałe + konteksty, zastrzeżenia i noty", () => {
    expect(ALL).toHaveLength(77);
    // Dolna granica: 5 pól stałych na wpis + 2 na każdy z 194 kontekstów.
    expect(FIELDS.length).toBeGreaterThan(77 * 5 + 194 * 2);
  });

  it("każde pole ma niepusty tekst PL i EN", () => {
    const empty = FIELDS.filter((f) => f.text.pl.trim() === "" || f.text.en.trim() === "");
    expect(empty.map((f) => f.where)).toEqual([]);
  });

  it("EN bez polskich znaków diakrytycznych", () => {
    const leaked = FIELDS.filter((f) => POLISH.test(f.text.en)).map(
      (f) => `${f.where}: ${f.text.en.match(/\S*[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\S*/gu)?.join(", ")}`,
    );
    expect(leaked).toEqual([]);
  });

  it("PL ≠ EN poza napisami formalnymi (wzór, skrót, liczby)", () => {
    const same = FIELDS.filter((f) => f.text.pl === f.text.en && !FORMAL.test(f.text.pl)).map(
      (f) => `${f.where}: ${f.text.pl}`,
    );
    expect(same).toEqual([]);
  });

  it("wzór napisu formalnego przepuszcza wzory, a zatrzymuje słowa", () => {
    expect(FORMAL.test("ARR = MRR × 12")).toBe(true);
    expect(FORMAL.test("(MRR1 − MRR0) / MRR0")).toBe(true);
    expect(FORMAL.test("P50–P75")).toBe(false);
    expect(FORMAL.test("top 10%")).toBe(false);
  });

  it("dźwignie 77/77 w obu językach - konkretne zdania, nie zaślepka", () => {
    const withLevers = ALL.filter((b) => b.levers.pl.trim() !== "" && b.levers.en.trim() !== "");
    expect(withLevers).toHaveLength(77);
    for (const b of ALL) {
      expect(b.levers.pl.length, b.key).toBeGreaterThan(80);
      expect(b.levers.en.length, b.key).toBeGreaterThan(80);
      expect(b.levers.pl.length, b.key).toBeLessThanOrEqual(600);
      expect(b.levers.en.length, b.key).toBeLessThanOrEqual(600);
    }
  });

  it("wpis bez metryki ma powód po polsku i po angielsku", () => {
    for (const b of ALL.filter((x) => !x.metricId)) {
      expect(b.noMetricReason?.pl.trim(), b.key).toBeTruthy();
      expect(b.noMetricReason?.en.trim(), b.key).toBeTruthy();
    }
  });
});
