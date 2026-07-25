// Inwarianty rejestru warstwy semantycznej. Te testy pilnują właściwości, na
// których opiera się cała reszta: dokładnie jeden strumień autorytatywny na
// metrykę, kompletność deskryptorów strumieni i spójność reguł porównywalności.
// Bez nich rejestr mógłby cicho zgnić i znowu wpuścić dwie liczby pod jedną nazwą.
import { describe, expect, it } from "vitest";
import {
  METRICS,
  STREAMS,
  assertSameStreamRatio,
  authoritativeBinding,
  bindingFor,
  comparabilityOf,
  metricById,
  metricsForStream,
  sharesConsentPopulation,
  sharesIdentityGrain,
  streamById,
  type StreamId,
} from ".";

describe("rejestr strumieni", () => {
  it("zawiera dokładnie sześć strumieni z unikalnymi id", () => {
    expect(STREAMS).toHaveLength(6);
    const ids = STREAMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("każdy strumień deklaruje pełny zestaw atrybutów semantycznych", () => {
    for (const s of STREAMS) {
      expect(s.labelPl.length).toBeGreaterThan(0);
      expect(s.labelEn.length).toBeGreaterThan(0);
      expect(s.store.length).toBeGreaterThan(0);
      expect(s.producer.length).toBeGreaterThan(0);
      expect(s.latencyHours).toBeGreaterThanOrEqual(0);
      // Zastrzeżenia są sensem istnienia rejestru - strumień bez nich znaczy,
      // że ktoś dodał źródło, nie opisawszy jego semantyki.
      expect(s.caveats.length).toBeGreaterThan(0);
    }
  });

  it("okno deduplikacji jest podane wtedy i tylko wtedy, gdy tryb to `window`", () => {
    for (const s of STREAMS) {
      if (s.dedupe === "window") {
        expect(s.dedupeWindowMinutes).toBeGreaterThan(0);
      } else {
        expect(s.dedupeWindowMinutes).toBeUndefined();
      }
    }
  });

  it("streamById rzuca dla nieznanego strumienia", () => {
    expect(() => streamById("nope" as StreamId)).toThrow(/Unknown analytics stream/);
  });

  it("reklamy i zdarzenia first-party stoją za RÓŻNYMI bramkami zgody", () => {
    // To jest powód, dla którego CTR reklam nie wolno liczyć na odsłonach stron.
    expect(sharesConsentPopulation("ad_events", "first_party")).toBe(false);
    expect(streamById("ad_events").consentGate).toBe("marketing");
    expect(streamById("first_party").consentGate).toBe("analytics");
  });

  it("sesja GA4 i sesja first-party to różne ziarna tożsamości", () => {
    expect(sharesIdentityGrain("ga4", "first_party")).toBe(false);
  });
});

describe("słownik metryk kanonicznych", () => {
  it("każda metryka ma DOKŁADNIE jedno powiązanie autorytatywne", () => {
    for (const m of METRICS) {
      const authoritative = m.bindings.filter((b) => b.role === "authoritative");
      expect(authoritative, `metryka ${m.id}`).toHaveLength(1);
    }
  });

  it("każda metryka ma definicję PL i EN oraz co najmniej jeden guard", () => {
    for (const m of METRICS) {
      expect(m.definitionPl.length, m.id).toBeGreaterThan(20);
      expect(m.definitionEn.length, m.id).toBeGreaterThan(20);
      expect(m.labelPl.length, m.id).toBeGreaterThan(0);
      expect(m.labelEn.length, m.id).toBeGreaterThan(0);
      expect(m.guards.length, m.id).toBeGreaterThan(0);
    }
  });

  it("tolerancja rozjazdu jest niezerowa tylko przy wielu strumieniach", () => {
    for (const m of METRICS) {
      if (m.bindings.length === 1) {
        expect(m.driftTolerance, m.id).toBe(0);
      } else {
        expect(m.driftTolerance, m.id).toBeGreaterThan(0);
      }
    }
  });

  it("każde id strumienia w powiązaniach istnieje w rejestrze strumieni", () => {
    const known = new Set(STREAMS.map((s) => s.id));
    for (const m of METRICS) {
      for (const b of m.bindings) {
        expect(known.has(b.streamId), `${m.id} -> ${b.streamId}`).toBe(true);
      }
    }
  });

  it("expectedOrder odwołuje się wyłącznie do powiązanych strumieni", () => {
    for (const m of METRICS) {
      const bound = new Set(m.bindings.map((b) => b.streamId));
      for (const id of m.expectedOrder ?? []) {
        expect(bound.has(id), `${m.id} -> ${id}`).toBe(true);
      }
    }
  });

  it("metricById / authoritativeBinding rzucają dla nieznanej metryki", () => {
    // @ts-expect-error - celowo poza unią MetricId
    expect(() => metricById("ghost")).toThrow(/Unknown canonical metric/);
    // @ts-expect-error - celowo poza unią MetricId
    expect(() => authoritativeBinding("ghost")).toThrow(/Unknown canonical metric/);
  });

  it("bindingFor zwraca undefined dla strumienia, który metryki nie obsługuje", () => {
    expect(bindingFor("sessions", "newsletter")).toBeUndefined();
    expect(bindingFor("sessions", "ga4")?.field).toBe("sessions");
  });

  it("metricsForStream wskazuje metryki obsługiwane przez dany strumień", () => {
    const vitals = metricsForStream("web_vitals").map((m) => m.id);
    expect(vitals).toEqual(["lcp_p75", "inp_p75", "cls_p75"]);
    expect(metricsForStream("ga4").map((m) => m.id)).toContain("engagement_rate");
  });

  it("odsłony stron i odsłony treści są ODDZIELNYMI metrykami", () => {
    // Sedno fragmentacji: obie nazywały się „views”, a mierzą co innego.
    const pv = metricById("page_views");
    const cv = metricById("content_views");
    expect(pv.id).not.toBe(cv.id);
    expect(authoritativeBinding("page_views").streamId).toBe("ga4");
    expect(authoritativeBinding("content_views").streamId).toBe("content_views");
    expect(cv.definitionEn).toMatch(/1\.5 s of dwell/);
  });
});

describe("porównywalność powiązań", () => {
  it("różne bramki zgody dają `incomparable`", () => {
    const impressions = authoritativeBinding("ad_impressions");
    const views = authoritativeBinding("page_views");
    expect(comparabilityOf(impressions, views)).toBe("incomparable");
  });

  it("ta sama bramka, inne ziarno daje `analogous`", () => {
    const ga4 = bindingFor("sessions", "ga4");
    const fp = bindingFor("sessions", "first_party");
    expect(ga4 && fp && comparabilityOf(ga4, fp)).toBe("analogous");
  });

  it("porównanie powiązania z samym sobą daje `equivalent`", () => {
    const b = authoritativeBinding("cta_clicks");
    expect(comparabilityOf(b, b)).toBe("equivalent");
  });
});

describe("assertSameStreamRatio", () => {
  it("przepuszcza wskaźnik liczony w jednym strumieniu", () => {
    expect(assertSameStreamRatio("ad_clicks", "ad_impressions")).toEqual({ ok: true });
    expect(assertSameStreamRatio("email_clicks", "email_opens")).toEqual({ ok: true });
  });

  it("blokuje CTR reklam liczony na odsłonach stron i wyjaśnia dlaczego", () => {
    const result = assertSameStreamRatio("ad_clicks", "page_views");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/consent: marketing/);
      expect(result.reason).toMatch(/consent: analytics/);
      expect(result.reason).toMatch(/do not cancel out/);
    }
  });

  it("blokuje CTR rekomendacji liczony na odsłonach stron", () => {
    // related_clicks żyje w strumieniu content_views (dwell 1,5 s + dedup 5 min),
    // page_views w GA4 - jedyny poprawny mianownik to content_views.
    expect(assertSameStreamRatio("related_clicks", "page_views").ok).toBe(false);
    expect(assertSameStreamRatio("related_clicks", "content_views").ok).toBe(true);
  });
});
