/**
 * Warstwa semantyczna analityki - publiczne wejście modułu.
 *
 * Sześć strumieni (GA4, zdarzenia first-party, Web Vitals, reklamy, newsletter,
 * odsłony treści i kliknięcia rekomendacji) miało sześć niezależnych definicji
 * „odsłony”, „sesji” i „unikalnych”. Ten moduł nadaje im jedną semantykę - i tę
 * samą trzem strumieniom huba „Przychód i lejek” (rozliczenia, cykl życia
 * konta, wydarzenia i kluby):
 *
 *  - `streams`   - CO każdy strumień mierzy (bramka zgody, tożsamość, deduplikacja, zegar),
 *  - `metrics`   - słownik metryk kanonicznych z JEDNYM strumieniem autorytatywnym na metrykę,
 *  - `window`    - jedno okno czasowe tłumaczone na format każdego strumienia,
 *  - `reconcile` - uzgodnienie liczb i klasyfikacja rozjazdu (oczekiwany vs błąd).
 *
 * Importuj z tego barrela - poszczególne pliki mogą się przegrupować, kontrakt
 * publiczny zostaje tutaj.
 *
 * CZEGO TU NIE MA, CELOWO: `metricHelp` i rejestru benchmarków. Z barrela
 * importuje m.in. `Ga4BiDashboard`, więc wszystko, co stąd wychodzi, jedzie do
 * jego chunku - objaśnienia i benchmarki ładują się dopiero przy otwarciu
 * arkusza wskaźnika, z własnych modułów.
 */
export {
  ALL_STREAMS,
  HUB_STREAMS,
  STREAMS,
  streamById,
  sharesConsentPopulation,
  sharesIdentityGrain,
  type ConsentGate,
  type DedupeMode,
  type IdentityGrain,
  type StreamDescriptor,
  type StreamId,
  type TimeBasis,
} from "./streams";

export {
  HUB_METRIC_IDS,
  METRICS,
  METRIC_GROUP,
  assertSameStreamRatio,
  authoritativeBinding,
  bindingFor,
  comparabilityOf,
  metricById,
  metricsForStream,
  type BindingRole,
  type Comparability,
  type MetricAggregation,
  type MetricBinding,
  type MetricDefinition,
  type MetricGroup,
  type MetricId,
  type MetricUnit,
  type MetricWindowKind,
} from "./metrics";

export {
  ga4RangeFromInstants,
  legacyRpcWindow,
  previousWindow,
  resolveCalendarWindow,
  resolveCustomWindow,
  resolveWindow,
  toLocalIsoDate,
  utcDateString,
  windowsOverlap,
  type CanonicalWindow,
  type Ga4DateRange,
  type ResolveWindowInput,
  type WindowGrain,
  type WindowNote,
  type WindowPresetId,
} from "./window";

export {
  needsAttention,
  reconcileAll,
  reconcileMetric,
  safeRatio,
  type RatioResult,
  type ReconcileOptions,
  type ReconciliationEntry,
  type ReconciliationReason,
  type ReconciliationVerdict,
  type ResolvedObservation,
  type StreamObservation,
} from "./reconcile";
