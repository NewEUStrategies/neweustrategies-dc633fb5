/**
 * Warstwa semantyczna analityki - publiczne wejście modułu.
 *
 * Sześć strumieni (GA4, zdarzenia first-party, Web Vitals, reklamy, newsletter,
 * odsłony treści i kliknięcia rekomendacji) miało sześć niezależnych definicji
 * „odsłony”, „sesji” i „unikalnych”. Ten moduł nadaje im jedną semantykę:
 *
 *  - `streams`   - CO każdy strumień mierzy (bramka zgody, tożsamość, deduplikacja, zegar),
 *  - `metrics`   - słownik metryk kanonicznych z JEDNYM strumieniem autorytatywnym na metrykę,
 *  - `window`    - jedno okno czasowe tłumaczone na format każdego strumienia,
 *  - `reconcile` - uzgodnienie liczb i klasyfikacja rozjazdu (oczekiwany vs błąd).
 *
 * Importuj z tego barrela - poszczególne pliki mogą się przegrupować, kontrakt
 * publiczny zostaje tutaj.
 */
export {
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
  METRICS,
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
  type MetricId,
  type MetricUnit,
} from "./metrics";

export {
  ga4RangeFromInstants,
  legacyRpcWindow,
  previousWindow,
  resolveCustomWindow,
  resolveWindow,
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
