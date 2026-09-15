import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorGa4MeasurementId, resolveGa4MeasurementId } from "@/lib/analytics/measurementId";

const KLUCZE_ENV = [
  "GA4_MEASUREMENT_ID",
  "GOOGLE_ANALYTICS_MEASUREMENT_ID",
  "VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY",
] as const;

beforeEach(() => {
  // Sekrety projektu są wstrzykiwane do środowiska wykonawczego - zerujemy je,
  // żeby każdy przypadek kontrolował dokładnie jedno źródło.
  KLUCZE_ENV.forEach((key) => vi.stubEnv(key, ""));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveGa4MeasurementId", () => {
  it("zwraca null, gdy nic nie jest skonfigurowane", () => {
    expect(resolveGa4MeasurementId(null)).toEqual({ measurementId: null, source: null });
  });

  it("sekret GA4_MEASUREMENT_ID ma pierwszeństwo", () => {
    vi.stubEnv("GA4_MEASUREMENT_ID", "G-SECRET1");
    vi.stubEnv("GOOGLE_ANALYTICS_MEASUREMENT_ID", "G-SECRET2");
    expect(resolveGa4MeasurementId("G-PANEL")).toEqual({
      measurementId: "G-SECRET1",
      source: "secret",
    });
  });

  it("sekret GOOGLE_ANALYTICS_MEASUREMENT_ID działa, gdy brak GA4_MEASUREMENT_ID", () => {
    vi.stubEnv("GOOGLE_ANALYTICS_MEASUREMENT_ID", " G-SECRET2 ");
    expect(resolveGa4MeasurementId("G-PANEL")).toEqual({
      measurementId: "G-SECRET2",
      source: "secret",
    });
  });

  it("wpis panelu wyprzedza konektor", () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY", "G-KONEKTOR");
    expect(resolveGa4MeasurementId("G-PANEL")).toEqual({
      measurementId: "G-PANEL",
      source: "settings",
    });
  });

  it("konektor jest źródłem zapasowym", () => {
    vi.stubEnv("VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY", "G-KONEKTOR");
    expect(resolveGa4MeasurementId("")).toEqual({
      measurementId: "G-KONEKTOR",
      source: "connector",
    });
  });

  it("przycina białe znaki (np. spację z wklejonego tagu Google)", () => {
    vi.stubEnv("GOOGLE_ANALYTICS_MEASUREMENT_ID", "G-EN05JH34VP ");
    expect(connectorGa4MeasurementId()).toBe("");
    expect(resolveGa4MeasurementId(null)).toEqual({
      measurementId: "G-EN05JH34VP",
      source: "secret",
    });
  });
});
