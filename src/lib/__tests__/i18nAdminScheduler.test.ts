// Parytet PL/EN bundla panelu zdrowia harmonogramu.
//
// Część kluczy jest indeksowana DYNAMICZNIE z kontraktu kodu
// (`adminScheduler.sources.<źródło>`, `adminScheduler.freshness.<stan>`,
// `adminScheduler.headline.<stan>`), więc brak tłumaczenia nie wywala builda -
// operator zobaczyłby surowy klucz w miejscu, w którym diagnozuje awarię
// doręczeń. Dlatego pilnujemy pokrycia KAŻDEJ wartości unii w obu językach.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { adminSchedulerEn, adminSchedulerPl } from "@/lib/i18n-admin-scheduler";
import { SCHEDULER_SOURCES, type SchedulerFreshness } from "@/lib/jobs/scheduler";

const FRESHNESS: readonly SchedulerFreshness[] = ["fresh", "lagging", "stale", "never"];

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...keyPaths(value as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe("i18n adminScheduler (PL/EN)", () => {
  it("oba języki mają ten sam zbiór kluczy", () => {
    const pl = keyPaths(adminSchedulerPl).sort();
    const en = keyPaths(adminSchedulerEn).sort();
    expect({
      onlyPl: pl.filter((k) => !en.includes(k)),
      onlyEn: en.filter((k) => !pl.includes(k)),
    }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("żaden ciąg nie jest pusty", () => {
    for (const [lang, bundle] of [
      ["pl", adminSchedulerPl],
      ["en", adminSchedulerEn],
    ] as const) {
      const empties = keyPaths(bundle).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>(
            (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
            bundle as unknown,
          );
        return typeof value === "string" && value.trim() === "";
      });
      expect({ lang, empties }).toEqual({ lang, empties: [] });
    }
  });

  it("bez pauzy '—' (standard interpunkcji projektu)", () => {
    const withDash = [adminSchedulerPl, adminSchedulerEn]
      .map((bundle) => JSON.stringify(bundle))
      .filter((json) => json.includes("—"));
    expect(withDash).toEqual([]);
  });

  it("każde źródło przebiegu ma etykietę w obu językach", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const source of SCHEDULER_SOURCES) {
        const key = `adminScheduler.sources.${source}`;
        expect(i18n.getFixedT(lang)(key), `${lang}:${key}`).not.toBe(key);
      }
    }
  });

  it("każdy stan świeżości ma etykietę i nagłówek w obu językach", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const state of FRESHNESS) {
        for (const key of [
          `adminScheduler.freshness.${state}`,
          `adminScheduler.headline.${state}`,
        ]) {
          expect(i18n.getFixedT(lang)(key), `${lang}:${key}`).not.toBe(key);
        }
      }
    }
  });

  it("nagłówki poza stanem 'never' interpolują wiek ostatniego przebiegu", () => {
    for (const bundle of [adminSchedulerPl, adminSchedulerEn]) {
      for (const state of ["fresh", "lagging", "stale"] as const) {
        expect(bundle.adminScheduler.headline[state]).toContain("{{ago}}");
      }
    }
  });
});
