/**
 * UZGADNIANIE MIĘDZY STRUMIENIAMI - trzeci element warstwy semantycznej.
 *
 * Wejście: obserwacje tej samej metryki kanonicznej z kilku strumieni.
 * Wyjście: JEDNA liczba do raportu (ta ze strumienia autorytatywnego) plus
 * werdykt, czy pozostałe strumienie ją potwierdzają, oraz zakodowane POWODY
 * rozjazdu.
 *
 * Kluczowa różnica wobec „po prostu pokażmy obie liczby”: tutaj rozjazd jest
 * klasyfikowany. Systematyczne przesunięcie wynikające z konstrukcji strumienia
 * (sesje per karta, filtrowanie botów przez Google) to `expected_drift` - nie
 * ma czego naprawiać. Rozjazd poza pasmem tolerancji albo ODWRÓCENIE
 * oczekiwanej relacji (GA4 pokazuje WIĘCEJ odsłon niż nasz niefiltrowany licznik)
 * to `divergent` / `order_inverted`, czyli realny sygnał złej konfiguracji.
 *
 * Plik jest czysty - żadnego I/O, więc te same reguły obowiązują w serwerowej
 * funkcji, w panelu i w testach.
 */
import {
  type MetricDefinition,
  type MetricId,
  authoritativeBinding,
  bindingFor,
  comparabilityOf,
  metricById,
} from "./metrics";
import { type StreamId, streamById } from "./streams";
import type { CanonicalWindow } from "./window";

export interface StreamObservation {
  readonly streamId: StreamId;
  /** `null` = strumień nie jest skonfigurowany albo nie zwrócił danych. */
  readonly value: number | null;
  /** Liczba próbek/wierszy stojących za wartością - do oceny istotności. */
  readonly samples?: number;
}

export type ReconciliationVerdict =
  /** Metrykę raportuje tylko strumień autorytatywny - nie ma czego uzgadniać. */
  | "single_source"
  /** Powiązania równoważne, liczby zgodne w tolerancji. */
  | "aligned"
  /** Powiązania analogiczne, przesunięcie zgodne z konstrukcją strumieni. */
  | "expected_drift"
  /** Relacja wielkości sprzeczna z konstrukcją - sygnał błędnej konfiguracji. */
  | "order_inverted"
  /** Rozjazd poza pasmem tolerancji metryki. */
  | "divergent"
  /** Różne populacje (bramki zgody) albo okno niezdatne do porównań. */
  | "incomparable"
  /** Brak wartości autorytatywnej - nie ma czego cytować. */
  | "unavailable";

export type ReconciliationReason =
  | "consent_gate_mismatch"
  | "grain_mismatch"
  | "dedupe_mismatch"
  | "window_not_cross_stream_safe"
  | "beyond_tolerance"
  | "expected_order_inverted"
  | "missing_authoritative"
  | "single_binding"
  | "sample_too_small";

export interface ResolvedObservation extends StreamObservation {
  readonly role: "authoritative" | "corroborating";
  /** Odchylenie względne wobec wartości autorytatywnej (ułamek, ze znakiem). */
  readonly deviation: number | null;
  /** Czy ta obserwacja weszła do oceny rozjazdu. */
  readonly counted: boolean;
}

export interface ReconciliationEntry {
  readonly metricId: MetricId;
  /** JEDYNA liczba, którą wolno zacytować w raporcie zarządczym. */
  readonly canonicalValue: number | null;
  readonly authoritativeStream: StreamId;
  readonly observations: readonly ResolvedObservation[];
  /** Największe odchylenie bezwzględne wśród porównywalnych strumieni (ułamek). */
  readonly spread: number | null;
  readonly verdict: ReconciliationVerdict;
  readonly reasons: readonly ReconciliationReason[];
}

/**
 * Poniżej tej liczby zdarzeń nie orzekamy o kierunku relacji ani o rozjeździe:
 * przy kilkunastu zdarzeniach szum losowy przewyższa każdy efekt strukturalny.
 */
const MIN_SAMPLE_FOR_JUDGEMENT = 50;

/** Tolerancja szumu przy sprawdzaniu kierunku relacji (2 %). */
const ORDER_EPSILON = 0.02;

function relativeDeviation(value: number, base: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value - base) / base;
}

/**
 * Czy zachowany jest oczekiwany porządek malejący wartości.
 * `expectedOrder: ["first_party", "ga4"]` czyta się: first-party >= GA4.
 */
function expectedOrderHolds(
  def: MetricDefinition,
  valueByStream: ReadonlyMap<StreamId, number>,
): boolean {
  const order = def.expectedOrder;
  if (!order || order.length < 2) return true;
  const present = order
    .map((id) => ({ id, value: valueByStream.get(id) }))
    .filter((x): x is { id: StreamId; value: number } => typeof x.value === "number");
  for (let i = 1; i < present.length; i++) {
    const higher = present[i - 1].value;
    const lower = present[i].value;
    // Dopuszczamy 2 % szumu, żeby remis nie przewracał werdyktu.
    if (higher < lower * (1 - ORDER_EPSILON)) return false;
  }
  return true;
}

export interface ReconcileOptions {
  /**
   * Okno, na którym zebrano obserwacje. Okno bez `crossStreamSafe` (kroczące
   * godzinowe albo z dniem otwartym) nie pozwala orzekać o rozjeździe - GA4 nie
   * domknęło doby, więc każde porównanie pokazałoby fałszywą rozbieżność.
   */
  readonly window?: CanonicalWindow;
}

/** Uzgodnij jedną metrykę kanoniczną na podstawie obserwacji ze strumieni. */
export function reconcileMetric(
  metricId: MetricId,
  observations: readonly StreamObservation[],
  options: ReconcileOptions = {},
): ReconciliationEntry {
  const def = metricById(metricId);
  const auth = authoritativeBinding(metricId);
  const reasons = new Set<ReconciliationReason>();

  const authObs = observations.find((o) => o.streamId === auth.streamId);
  const canonicalValue = authObs?.value ?? null;

  if (canonicalValue === null) {
    reasons.add("missing_authoritative");
    return {
      metricId,
      canonicalValue: null,
      authoritativeStream: auth.streamId,
      observations: observations.map((o) => ({
        ...o,
        role: o.streamId === auth.streamId ? "authoritative" : "corroborating",
        deviation: null,
        counted: false,
      })),
      spread: null,
      verdict: "unavailable",
      reasons: [...reasons],
    };
  }

  const valueByStream = new Map<StreamId, number>();
  for (const o of observations) {
    if (typeof o.value === "number") valueByStream.set(o.streamId, o.value);
  }

  const windowSafe = options.window ? options.window.crossStreamSafe : true;
  if (!windowSafe) reasons.add("window_not_cross_stream_safe");

  let anyAnalogous = false;
  let maxSpread: number | null = null;

  const resolved: ResolvedObservation[] = observations.map((o) => {
    if (o.streamId === auth.streamId) {
      return { ...o, role: "authoritative", deviation: 0, counted: true };
    }
    const binding = bindingFor(metricId, o.streamId);
    if (!binding || o.value === null) {
      return { ...o, role: "corroborating", deviation: null, counted: false };
    }

    const comparability = comparabilityOf(auth, binding);
    if (comparability === "incomparable") {
      reasons.add("consent_gate_mismatch");
      return { ...o, role: "corroborating", deviation: null, counted: false };
    }
    if (comparability === "analogous") {
      anyAnalogous = true;
      if (binding.grain !== auth.grain) reasons.add("grain_mismatch");
      if (streamById(binding.streamId).dedupe !== streamById(auth.streamId).dedupe) {
        reasons.add("dedupe_mismatch");
      }
    }

    const deviation = relativeDeviation(o.value, canonicalValue);
    const counted = windowSafe && deviation !== null;
    if (counted && deviation !== null) {
      const magnitude = Math.abs(deviation);
      maxSpread = maxSpread === null ? magnitude : Math.max(maxSpread, magnitude);
    }
    return { ...o, role: "corroborating", deviation, counted };
  });

  const comparableCount = resolved.filter((o) => o.counted && o.role === "corroborating").length;
  if (def.bindings.length < 2) reasons.add("single_binding");

  if (comparableCount === 0) {
    const verdict: ReconciliationVerdict = reasons.has("consent_gate_mismatch")
      ? "incomparable"
      : reasons.has("window_not_cross_stream_safe")
        ? "incomparable"
        : "single_source";
    return {
      metricId,
      canonicalValue,
      authoritativeStream: auth.streamId,
      observations: resolved,
      spread: null,
      verdict,
      reasons: [...reasons],
    };
  }

  // Przy małym wolumenie nie orzekamy - szum przewyższa efekt strukturalny.
  // Dotyczy wyłącznie metryk zliczających: dla wskaźników (ułamków) i percentyli
  // wartość nie jest wolumenem, więc ten próg nie miałby sensu.
  const volume =
    def.unit === "count" ? Math.max(canonicalValue, ...valueByStream.values()) : Infinity;
  if (volume < MIN_SAMPLE_FOR_JUDGEMENT) {
    reasons.add("sample_too_small");
    return {
      metricId,
      canonicalValue,
      authoritativeStream: auth.streamId,
      observations: resolved,
      spread: maxSpread,
      verdict: anyAnalogous ? "expected_drift" : "aligned",
      reasons: [...reasons],
    };
  }

  if (!expectedOrderHolds(def, valueByStream)) {
    reasons.add("expected_order_inverted");
    return {
      metricId,
      canonicalValue,
      authoritativeStream: auth.streamId,
      observations: resolved,
      spread: maxSpread,
      verdict: "order_inverted",
      reasons: [...reasons],
    };
  }

  if (maxSpread !== null && maxSpread > def.driftTolerance) {
    reasons.add("beyond_tolerance");
    return {
      metricId,
      canonicalValue,
      authoritativeStream: auth.streamId,
      observations: resolved,
      spread: maxSpread,
      verdict: "divergent",
      reasons: [...reasons],
    };
  }

  return {
    metricId,
    canonicalValue,
    authoritativeStream: auth.streamId,
    observations: resolved,
    spread: maxSpread,
    verdict: anyAnalogous ? "expected_drift" : "aligned",
    reasons: [...reasons],
  };
}

/** Uzgodnij wiele metryk naraz, zachowując kolejność wejścia. */
export function reconcileAll(
  input: ReadonlyArray<{ metricId: MetricId; observations: readonly StreamObservation[] }>,
  options: ReconcileOptions = {},
): readonly ReconciliationEntry[] {
  return input.map((i) => reconcileMetric(i.metricId, i.observations, options));
}

/** Werdykty wymagające reakcji człowieka - filtr dla sekcji „do wyjaśnienia”. */
export function needsAttention(entry: ReconciliationEntry): boolean {
  return entry.verdict === "divergent" || entry.verdict === "order_inverted";
}

export interface RatioResult {
  readonly value: number | null;
  readonly reason?: string;
}

/**
 * Bezpieczne wyliczenie metryki złożonej. Odmawia, gdy licznik i mianownik
 * pochodzą z różnych strumieni (bramki zgody się nie skracają) oraz gdy
 * mianownik jest zerowy - zwracamy `null`, nie `0`, bo „0 %” czyta się jako
 * „nikt nie kliknął”, a nie „nie ma podstawy do wyliczenia”.
 */
export function safeRatio(
  numerator: { metricId: MetricId; value: number | null },
  denominator: { metricId: MetricId; value: number | null },
): RatioResult {
  const nStream = authoritativeBinding(numerator.metricId).streamId;
  const dStream = authoritativeBinding(denominator.metricId).streamId;
  if (nStream !== dStream) {
    return {
      value: null,
      reason:
        `${numerator.metricId} (${nStream}) and ${denominator.metricId} (${dStream}) come from ` +
        "different streams; their consent gates do not cancel out.",
    };
  }
  if (
    numerator.value === null ||
    denominator.value === null ||
    !Number.isFinite(numerator.value) ||
    !Number.isFinite(denominator.value) ||
    denominator.value === 0
  ) {
    return { value: null, reason: "denominator is zero or unavailable" };
  }
  return { value: numerator.value / denominator.value };
}
