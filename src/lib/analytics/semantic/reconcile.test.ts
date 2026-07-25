// Uzgadnianie międzystrumieniowe. Testy sprawdzają, że warstwa ODRÓŻNIA dryf
// wynikający z konstrukcji strumienia (nie ma czego naprawiać) od realnej
// rozbieżności i od odwrócenia oczekiwanej relacji (błąd konfiguracji), oraz że
// nigdy nie porównuje liczb spod różnych bramek zgody.
import { describe, expect, it } from "vitest";
import {
  needsAttention,
  reconcileAll,
  reconcileMetric,
  resolveWindow,
  safeRatio,
  type StreamObservation,
} from ".";

const NOW = Date.parse("2026-07-15T14:37:00.000Z");
const SAFE_WINDOW = resolveWindow({ presetId: "28d", nowMs: NOW });
const OPEN_WINDOW = resolveWindow({ presetId: "28d", nowMs: NOW, includeOpenDay: true });

function obs(streamId: StreamObservation["streamId"], value: number | null): StreamObservation {
  return { streamId, value };
}

describe("reconcileMetric - wartość kanoniczna", () => {
  it("cytuje liczbę ze strumienia autorytatywnego, nie średnią", () => {
    const r = reconcileMetric("sessions", [obs("ga4", 1000), obs("first_party", 1200)], {
      window: SAFE_WINDOW,
    });
    expect(r.canonicalValue).toBe(1000);
    expect(r.authoritativeStream).toBe("ga4");
  });

  it("brak wartości autorytatywnej daje `unavailable`, nie liczbę zastępczą", () => {
    const r = reconcileMetric("sessions", [obs("ga4", null), obs("first_party", 1200)], {
      window: SAFE_WINDOW,
    });
    expect(r.verdict).toBe("unavailable");
    expect(r.canonicalValue).toBeNull();
    expect(r.reasons).toContain("missing_authoritative");
    // Liczba z GA4 nie istnieje - nie wolno w jej miejsce podstawić first-party.
    expect(r.observations.every((o) => o.counted === false)).toBe(true);
  });
});

describe("reconcileMetric - klasyfikacja rozjazdu", () => {
  it("systematyczne przesunięcie w tolerancji to `expected_drift`", () => {
    // Sesje per karta zawyżają first-party o ~20 % - to konstrukcja, nie błąd.
    const r = reconcileMetric("sessions", [obs("ga4", 1000), obs("first_party", 1200)], {
      window: SAFE_WINDOW,
    });
    expect(r.verdict).toBe("expected_drift");
    expect(r.reasons).toContain("grain_mismatch");
    expect(r.spread).toBeCloseTo(0.2, 5);
    expect(needsAttention(r)).toBe(false);
  });

  it("rozjazd poza pasmem tolerancji to `divergent`", () => {
    // page_views: tolerancja 30 %, tu first-party jest 2,5x wyższe.
    const r = reconcileMetric("page_views", [obs("ga4", 1000), obs("first_party", 2500)], {
      window: SAFE_WINDOW,
    });
    expect(r.verdict).toBe("divergent");
    expect(r.reasons).toContain("beyond_tolerance");
    expect(needsAttention(r)).toBe(true);
  });

  it("odwrócenie oczekiwanej relacji to `order_inverted`", () => {
    // GA4 filtruje boty i sesjonizuje po użytkowniku, więc NIE MOŻE mieć więcej
    // odsłon niż nasz surowy licznik - jeśli ma, jedna z rur jest zepsuta.
    const r = reconcileMetric("page_views", [obs("ga4", 2000), obs("first_party", 900)], {
      window: SAFE_WINDOW,
    });
    expect(r.verdict).toBe("order_inverted");
    expect(r.reasons).toContain("expected_order_inverted");
    expect(needsAttention(r)).toBe(true);
  });

  it("remis w granicach szumu nie przewraca werdyktu na `order_inverted`", () => {
    const r = reconcileMetric("page_views", [obs("ga4", 1000), obs("first_party", 995)], {
      window: SAFE_WINDOW,
    });
    expect(r.verdict).toBe("expected_drift");
  });

  it("metryka z jednym strumieniem to `single_source`", () => {
    const r = reconcileMetric("engagement_rate", [obs("ga4", 0.52)], { window: SAFE_WINDOW });
    expect(r.verdict).toBe("single_source");
    expect(r.reasons).toContain("single_binding");
    expect(r.spread).toBeNull();
  });

  it("mały wolumen wstrzymuje orzekanie", () => {
    const r = reconcileMetric("page_views", [obs("ga4", 10), obs("first_party", 40)], {
      window: SAFE_WINDOW,
    });
    expect(r.reasons).toContain("sample_too_small");
    expect(needsAttention(r)).toBe(false);
  });

  it("próg małego wolumenu nie dotyczy wskaźników ani percentyli", () => {
    // engagement_rate ma wartość 0,52 - to nie wolumen, więc bramka się nie odpala.
    const r = reconcileMetric("engagement_rate", [obs("ga4", 0.52)], { window: SAFE_WINDOW });
    expect(r.reasons).not.toContain("sample_too_small");
  });
});

describe("reconcileMetric - granice porównywalności", () => {
  it("okno z dniem otwartym blokuje orzekanie o rozjeździe", () => {
    // GA4 nie domknęło jeszcze doby, więc każde porównanie pokazałoby fałszywy
    // deficyt po stronie GA4.
    const r = reconcileMetric("page_views", [obs("ga4", 1000), obs("first_party", 2500)], {
      window: OPEN_WINDOW,
    });
    expect(r.verdict).toBe("incomparable");
    expect(r.reasons).toContain("window_not_cross_stream_safe");
    expect(r.spread).toBeNull();
    // Wartość kanoniczna nadal jest dostępna - blokujemy WERDYKT, nie liczbę.
    expect(r.canonicalValue).toBe(1000);
  });

  it("obserwacja ze strumienia niepowiązanego z metryką jest ignorowana", () => {
    const r = reconcileMetric("sessions", [obs("ga4", 1000), obs("newsletter", 50_000)], {
      window: SAFE_WINDOW,
    });
    expect(r.verdict).toBe("single_source");
    const nl = r.observations.find((o) => o.streamId === "newsletter");
    expect(nl?.counted).toBe(false);
    expect(nl?.deviation).toBeNull();
  });

  it("brak okna w opcjach traktujemy jako okno porównywalne", () => {
    const r = reconcileMetric("sessions", [obs("ga4", 1000), obs("first_party", 1100)]);
    expect(r.verdict).toBe("expected_drift");
  });
});

describe("reconcileAll", () => {
  it("zachowuje kolejność wejścia i uzgadnia każdą metrykę osobno", () => {
    const entries = reconcileAll(
      [
        { metricId: "sessions", observations: [obs("ga4", 1000), obs("first_party", 1150)] },
        { metricId: "page_views", observations: [obs("ga4", 3000), obs("first_party", 9000)] },
        { metricId: "cta_clicks", observations: [obs("first_party", 220)] },
      ],
      { window: SAFE_WINDOW },
    );
    expect(entries.map((e) => e.metricId)).toEqual(["sessions", "page_views", "cta_clicks"]);
    expect(entries.map((e) => e.verdict)).toEqual(["expected_drift", "divergent", "single_source"]);
    expect(entries.filter(needsAttention)).toHaveLength(1);
  });
});

describe("safeRatio", () => {
  it("liczy wskaźnik w obrębie jednego strumienia", () => {
    const r = safeRatio(
      { metricId: "ad_clicks", value: 40 },
      { metricId: "ad_impressions", value: 1000 },
    );
    expect(r.value).toBeCloseTo(0.04, 6);
    expect(r.reason).toBeUndefined();
  });

  it("odmawia wskaźnika sklejonego z dwóch strumieni", () => {
    const r = safeRatio(
      { metricId: "ad_clicks", value: 40 },
      { metricId: "page_views", value: 10_000 },
    );
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/different streams/);
  });

  it("zwraca null (nie zero) przy zerowym mianowniku", () => {
    const r = safeRatio(
      { metricId: "email_clicks", value: 12 },
      { metricId: "email_opens", value: 0 },
    );
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/denominator is zero/);
  });

  it("zwraca null przy brakującej wartości", () => {
    expect(
      safeRatio({ metricId: "ad_clicks", value: null }, { metricId: "ad_impressions", value: 10 })
        .value,
    ).toBeNull();
    expect(
      safeRatio({ metricId: "ad_clicks", value: 5 }, { metricId: "ad_impressions", value: null })
        .value,
    ).toBeNull();
  });
});
