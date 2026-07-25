// Generator interpretacji warstwy semantycznej. Reguła, której pilnują te testy:
// insight powstaje TYLKO wtedy, gdy jest decyzja do podjęcia. Dryf wynikający z
// konstrukcji strumieni nie może produkować wpisów, bo w stałym szumie prawdziwa
// rozbieżność by ginęła.
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  reconcileMetric,
  resolveWindow,
  type ReconciliationEntry,
  type StreamObservation,
} from "@/lib/analytics/semantic";
import type {
  SemanticSnapshotResult,
  SemanticStreamHealth,
} from "@/lib/analytics/semantic/snapshot.functions";
import { buildSemanticInsights } from "./semanticInsights";

const NOW = Date.parse("2026-07-15T14:37:00.000Z");
const SAFE = resolveWindow({ presetId: "28d", nowMs: NOW });
const OPEN = resolveWindow({ presetId: "28d", nowMs: NOW, includeOpenDay: true });

/**
 * Zastępnik `t`: zwraca sam klucz, a dla `returnObjects` tablicę z kluczem.
 * Testujemy LOGIKĘ doboru insightów, nie treść tłumaczeń (parytet PL/EN pilnuje
 * osobny test bundla i18n).
 */
const t = ((key: string, options?: { returnObjects?: boolean }) =>
  options?.returnObjects ? [key] : key) as unknown as TFunction;

function windowDto(w: typeof SAFE): SemanticSnapshotResult["window"] {
  return {
    presetId: w.presetId,
    sinceIso: w.sinceIso,
    untilIso: w.untilIso,
    days: w.days,
    grain: w.grain,
    crossStreamSafe: w.crossStreamSafe,
    notes: w.notes,
    ga4: w.ga4,
  };
}

const ALL_STREAMS_OK: readonly SemanticStreamHealth[] = [
  { streamId: "ga4", available: true },
  { streamId: "first_party", available: true },
  { streamId: "web_vitals", available: true },
  { streamId: "ad_events", available: true },
  { streamId: "newsletter", available: true },
  { streamId: "content_views", available: true },
];

function entry(
  metricId: Parameters<typeof reconcileMetric>[0],
  observations: readonly StreamObservation[],
  crossStreamSafe = true,
): ReconciliationEntry {
  return reconcileMetric(metricId, observations, { window: crossStreamSafe ? SAFE : OPEN });
}

function snapshot(overrides: Partial<SemanticSnapshotResult> = {}): SemanticSnapshotResult {
  return {
    window: windowDto(SAFE),
    previous: { sinceIso: SAFE.sinceIso, untilIso: SAFE.untilIso },
    entries: [],
    deltas: [],
    ratios: [],
    streams: ALL_STREAMS_OK,
    ga4Configured: true,
    ...overrides,
  };
}

describe("buildSemanticInsights", () => {
  it("dryf oczekiwany nie generuje żadnego wpisu poza potwierdzeniem zgodności", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({
        entries: [
          entry("sessions", [
            { streamId: "ga4", value: 1000 },
            { streamId: "first_party", value: 1200 },
          ]),
        ],
      }),
      t,
    });
    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe("semantic-aligned");
    expect(insights[0].severity).toBe("good");
  });

  it("rozjazd poza tolerancją daje wpis ostrzegawczy per metryka", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({
        entries: [
          entry("page_views", [
            { streamId: "ga4", value: 1000 },
            { streamId: "first_party", value: 2500 },
          ]),
        ],
      }),
      t,
    });
    expect(insights.map((i) => i.id)).toEqual(["semantic-divergent-page_views"]);
    expect(insights[0].severity).toBe("warn");
    expect(insights[0].fixes.length).toBeGreaterThan(0);
  });

  it("odwrócona relacja jest krytyczna i wyprzedza zwykły rozjazd", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({
        entries: [
          entry("page_views", [
            { streamId: "ga4", value: 2000 },
            { streamId: "first_party", value: 900 },
          ]),
          entry("sessions", [
            { streamId: "ga4", value: 1000 },
            { streamId: "first_party", value: 3000 },
          ]),
        ],
      }),
      t,
    });
    const ids = insights.map((i) => i.id);
    expect(ids).toContain("semantic-inverted-page_views");
    expect(ids.indexOf("semantic-inverted-page_views")).toBeLessThan(
      ids.indexOf("semantic-divergent-sessions"),
    );
    expect(insights[0].severity).toBe("critical");
  });

  it("okno z dniem otwartym generuje ostrzeżenie o nieuczciwym porównaniu", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({ window: windowDto(OPEN) }),
      t,
    });
    expect(insights.map((i) => i.id)).toContain("semantic-window");
  });

  it("brak GA4 jest krytyczny - nie ma strumienia autorytatywnego dla ruchu", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({
        ga4Configured: false,
        streams: [{ streamId: "ga4", available: false, reason: "not_configured" }],
      }),
      t,
    });
    const ga4 = insights.find((i) => i.id === "semantic-ga4-missing");
    expect(ga4?.severity).toBe("critical");
  });

  it("luki w metrykach kluczowych są raportowane, ale ograniczone liczbowo", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({
        entries: [
          entry("sessions", [{ streamId: "ga4", value: null }]),
          entry("visitors", [{ streamId: "ga4", value: null }]),
          entry("page_views", [{ streamId: "ga4", value: null }]),
        ],
      }),
      t,
    });
    const gaps = insights.filter((i) => i.id.startsWith("semantic-gap-"));
    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.severity === "info")).toBe(true);
  });

  it("nie raportuje luk dla metryk poza rdzeniem raportu", () => {
    const insights = buildSemanticInsights({
      snapshot: snapshot({
        entries: [entry("email_opens", [{ streamId: "newsletter", value: null }])],
      }),
      t,
    });
    expect(insights.map((i) => i.id)).toEqual(["semantic-aligned"]);
  });
});
