/**
 * Jedno źródło prawdy dla identyfikatora pomiaru GA4 po stronie serwera.
 *
 * Kolejność: sekret projektu -> ustawienia najemcy (panel) -> konektor
 * Google Analytics (`VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY`).
 * Konektor jest źródłem zapasowym - dokładnie jak w kliencie
 * (`ConsentScriptInjector`), żeby panel i realne wysyłanie zdarzeń nigdy
 * nie raportowały różnych wartości.
 */

export type Ga4MeasurementIdSource = "secret" | "settings" | "connector" | null;

export interface ResolvedGa4MeasurementId {
  measurementId: string | null;
  source: Ga4MeasurementIdSource;
}

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function connectorGa4MeasurementId(): string {
  return clean(process.env["VITE_LOVABLE_CONNECTOR_GOOGLE_ANALYTICS_API_KEY"]);
}

export function resolveGa4MeasurementId(storedId?: string | null): ResolvedGa4MeasurementId {
  const fromSecret = clean(process.env["GA4_MEASUREMENT_ID"]);
  if (fromSecret) return { measurementId: fromSecret, source: "secret" };

  const fromSettings = clean(storedId ?? undefined);
  if (fromSettings) return { measurementId: fromSettings, source: "settings" };

  const fromConnector = connectorGa4MeasurementId();
  if (fromConnector) return { measurementId: fromConnector, source: "connector" };

  return { measurementId: null, source: null };
}
