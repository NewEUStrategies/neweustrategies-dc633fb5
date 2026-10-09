// Klucze słownika wypisane MAPAMI (statusy, kierunki, znaczenia, wiersze
// tooltipa) - bramka rozjazdu kod-słownik nie widzi wartości map, więc ten
// plik sprawdza je wprost: każda wartość ma treść w obu językach.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts";
import {
  DIRECTION_KEYS,
  METRIC_DIRECTIONS,
  RANGE_STATUSES,
  STATUS_KEYS,
  meaningKey,
} from "@/lib/charts/status";
import { FACT_KEYS } from "@/components/charts/chartFacts";

const klucze = (): string[] => {
  const out = new Set<string>([
    ...Object.values(STATUS_KEYS),
    ...Object.values(DIRECTION_KEYS),
    ...Object.values(FACT_KEYS),
  ]);
  for (const status of RANGE_STATUSES) {
    for (const direction of [...METRIC_DIRECTIONS, null]) out.add(meaningKey(status, direction));
  }
  for (const r of ["A", "B", "C"]) out.add(`reliability.${r}`);
  for (const p of ["D", "W", "B", "E", "unknown"]) out.add(`provenance.${p}`);
  return [...out];
};

describe("klucze systemu wykresów wypisane mapami", () => {
  it.each(["pl", "en"] as const)("każdy ma treść w języku %s", (lng) => {
    for (const key of klucze()) {
      expect(i18n.exists(`charts.${key}`, { lng }), `${lng}: charts.${key}`).toBe(true);
    }
  });

  it("żaden polski napis systemu nie używa pauzy zamiast łącznika", () => {
    for (const key of klucze()) {
      expect(i18n.t(`charts.${key}`, { lng: "pl" }), key).not.toContain("—");
    }
  });
});
