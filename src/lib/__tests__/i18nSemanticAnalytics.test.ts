// Parytet PL/EN dla bundla warstwy semantycznej analityki.
//
// Ten podzbiór kluczy jest indeksowany DYNAMICZNIE - kody werdyktów, powodów,
// zastrzeżeń okna, bramek zgody i ziaren tożsamości pochodzą z rejestru w kodzie
// i są składane jako `adminAnalytics.semantic.<grupa>.<kod>`. Brak jednego klucza
// nie wywala builda: użytkownik zobaczy surowy kod w panelu. Dlatego pilnujemy
// pokrycia KAŻDEGO kodu z unii typów, w obu językach.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { semanticAnalyticsEn, semanticAnalyticsPl } from "@/lib/i18n-admin-semantic";
import { METRICS, STREAMS } from "@/lib/analytics/semantic";
import type {
  ReconciliationReason,
  ReconciliationVerdict,
} from "@/lib/analytics/semantic/reconcile";
import type { WindowNote } from "@/lib/analytics/semantic/window";

const VERDICTS: readonly ReconciliationVerdict[] = [
  "single_source",
  "aligned",
  "expected_drift",
  "order_inverted",
  "divergent",
  "incomparable",
  "unavailable",
];

const REASONS: readonly ReconciliationReason[] = [
  "consent_gate_mismatch",
  "grain_mismatch",
  "dedupe_mismatch",
  "window_not_cross_stream_safe",
  "beyond_tolerance",
  "expected_order_inverted",
  "missing_authoritative",
  "single_binding",
  "sample_too_small",
];

const WINDOW_NOTES: readonly WindowNote[] = [
  "ga4_property_timezone",
  "ga4_open_day",
  "instant_grain_not_available_in_ga4",
  "excludes_open_day",
  "legacy_rpc_window_ends_now",
];

const STREAM_STATUSES = ["available", "not_configured", "read_failed", "no_data"] as const;

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const PL = semanticAnalyticsPl.adminAnalytics.semantic as unknown as Record<string, unknown>;
const EN = semanticAnalyticsEn.adminAnalytics.semantic as unknown as Record<string, unknown>;

describe("bundle i18n warstwy semantycznej", () => {
  it("rejestruje sekcję `semantic` w obu językach", () => {
    expect(Object.keys(PL).length).toBeGreaterThan(0);
    expect(Object.keys(EN).length).toBeGreaterThan(0);
  });

  it("PL i EN mają identyczną strukturę kluczy", () => {
    const plKeys = new Set(keyPaths(PL));
    const enKeys = new Set(keyPaths(EN));
    const onlyPl = [...plKeys].filter((k) => !enKeys.has(k));
    const onlyEn = [...enKeys].filter((k) => !plKeys.has(k));
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("nie ma pustych wartości", () => {
    for (const [lang, bundle] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      const empty = keyPaths(bundle).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>(
            (acc, key) =>
              acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
            bundle,
          );
        if (Array.isArray(value)) return value.length === 0;
        return typeof value === "string" && value.trim() === "";
      });
      expect(empty, lang).toEqual([]);
    }
  });

  it("pokrywa każdy werdykt uzgodnienia etykietą i podpowiedzią", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const verdict of VERDICTS) {
        expect(
          i18n.exists(`adminAnalytics.semantic.verdict.${verdict}`, { lng: lang }),
          `${lang}/${verdict}`,
        ).toBe(true);
        expect(
          i18n.exists(`adminAnalytics.semantic.verdictHint.${verdict}`, { lng: lang }),
          `${lang}/hint/${verdict}`,
        ).toBe(true);
      }
    }
  });

  it("pokrywa każdy powód rozjazdu", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const reason of REASONS) {
        expect(
          i18n.exists(`adminAnalytics.semantic.reason.${reason}`, { lng: lang }),
          `${lang}/${reason}`,
        ).toBe(true);
      }
    }
  });

  it("pokrywa każde zastrzeżenie okna", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const note of WINDOW_NOTES) {
        expect(
          i18n.exists(`adminAnalytics.semantic.windowNotes.${note}`, { lng: lang }),
          `${lang}/${note}`,
        ).toBe(true);
      }
    }
  });

  it("pokrywa bramkę zgody, ziarno tożsamości i tryb deduplikacji każdego strumienia", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const stream of STREAMS) {
        expect(
          i18n.exists(`adminAnalytics.semantic.consentGate.${stream.consentGate}`, { lng: lang }),
          `${lang}/gate/${stream.id}`,
        ).toBe(true);
        expect(
          i18n.exists(`adminAnalytics.semantic.identityGrain.${stream.identityGrain}`, {
            lng: lang,
          }),
          `${lang}/grain/${stream.id}`,
        ).toBe(true);
        expect(
          i18n.exists(`adminAnalytics.semantic.dedupe.${stream.dedupe}`, { lng: lang }),
          `${lang}/dedupe/${stream.id}`,
        ).toBe(true);
      }
    }
  });

  it("pokrywa każdy status dostępności strumienia", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const status of STREAM_STATUSES) {
        expect(
          i18n.exists(`adminAnalytics.semantic.streams.${status}`, { lng: lang }),
          `${lang}/${status}`,
        ).toBe(true);
      }
    }
  });

  it("pokrywa każdą jednostkę występującą w słowniku metryk", () => {
    const units = new Set(METRICS.map((m) => m.unit));
    for (const lang of ["pl", "en"] as const) {
      for (const unit of units) {
        expect(
          i18n.exists(`adminAnalytics.semantic.dictionary.unit.${unit}`, { lng: lang }),
          `${lang}/${unit}`,
        ).toBe(true);
      }
    }
  });
});
