// Reguły edytora przepisu automatyzacji, wyjęte z `WorkflowEditorDialog`.
//
// Dialog jest dużym organizmem (435 linii JSX), a reguły, które niesie, są
// małe i policzalne: jak przesuwa się krok, kiedy wyzwalacz jest „inny",
// co dzieje się z parametrami przy zmianie akcji i jak wygląda w polu wartość,
// która w bazie jest tablicą. Każda z nich da się złamać bez błędu typów
// i bez zmiany wyglądu - dlatego mieszkają tutaj, gdzie sprawdza się je
// na WYNIKU, a nie na renderze.
import type { WorkflowStep } from "@/lib/admin/workflows";
import { DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";

/** Wartość wybieraka oznaczająca „typ zdarzenia spoza katalogu”. */
export const CUSTOM_TRIGGER = "__custom__";

/** Para warunku (containment na payloadzie zdarzenia). */
export interface ConditionPair {
  key: string;
  value: string;
}

/** Świeża, pusta para warunku. */
export function emptyConditionPair(): ConditionPair {
  return { key: "", value: "" };
}

/** Krok dokładany przyciskiem „dodaj” - pierwsza akcja katalogu silnika. */
export function defaultStep(): WorkflowStep {
  return { action: "notify_staff", params: {} };
}

/**
 * Czy zapisany wyzwalacz jest spoza katalogu zdarzeń domenowych.
 *
 * Liczone z WARTOŚCI, nie ze stanu formularza: pusty typ (nowy przepis) to nie
 * jest „inny typ”, tylko brak wyboru - inaczej nowy przepis otwierałby się
 * z polem tekstowym zamiast z listą i redaktor wpisywałby nazwę zdarzenia
 * z palca, obok katalogu.
 */
export function isCustomTriggerType(triggerEventType: string): boolean {
  return (
    triggerEventType !== "" && !(DOMAIN_EVENT_TYPES as readonly string[]).includes(triggerEventType)
  );
}

/**
 * Wartość dla `<Select>` wyzwalacza. `undefined` (a nie pusty napis) dla braku
 * wyboru, bo Radix pokazuje podpowiedź tylko dla wartości niezdefiniowanej.
 */
export function triggerSelectValue(
  customTrigger: boolean,
  triggerEventType: string,
): string | undefined {
  if (customTrigger) return CUSTOM_TRIGGER;
  return triggerEventType || undefined;
}

/**
 * Skutek wyboru w wybieraku wyzwalacza.
 *
 * Wybór „inny typ” ZERUJE typ zdarzenia. Zostawienie poprzedniej wartości
 * dałoby przepis, który w polu tekstowym pokazuje zdarzenie z katalogu i
 * wygląda na gotowy, choć redaktor wybrał tryb ręczny właśnie po to, żeby
 * wpisać coś innego.
 */
export function applyTriggerSelection(value: string): {
  customTrigger: boolean;
  triggerEventType: string;
} {
  return value === CUSTOM_TRIGGER
    ? { customTrigger: true, triggerEventType: "" }
    : { customTrigger: false, triggerEventType: value };
}

/**
 * Przesunięcie kroku w sekwencji. Poza zakresem oddaje TĘ SAMĄ referencję -
 * brak ruchu ma nie renderować listy od nowa i nie gubić fokusu.
 */
export function moveStep<T>(steps: readonly T[], index: number, delta: -1 | 1): readonly T[] {
  const target = index + delta;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  const [removed] = next.splice(index, 1);
  next.splice(target, 0, removed);
  return next;
}

/** Podmiana jednego elementu listy; reszta zachowuje tożsamość. */
export function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}

/** Usunięcie jednego elementu listy po pozycji. */
export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

/** Zmiana jednego pola pary warunku, bez ruszania drugiego. */
export function patchConditionPair(
  pairs: readonly ConditionPair[],
  index: number,
  patch: Partial<ConditionPair>,
): ConditionPair[] {
  return pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair));
}

/**
 * Wartość parametru kroku w polu tekstowym.
 *
 * Parametry ról przychodzą z bazy jako `string[]`, ale podczas edycji trzymamy
 * surowy CSV. Konwersja w drugą stronę (podział po przecinku) należy do
 * `serializeWorkflowSteps` - gdyby robiło ją pole, wpisywany przecinek znikałby
 * przy każdym renderze i nie dałoby się wpisać drugiej roli.
 */
export function paramInputValue(raw: unknown): string {
  if (Array.isArray(raw)) return raw.join(", ");
  return typeof raw === "string" ? raw : "";
}

/** Zmiana jednego parametru kroku; pozostałe parametry zostają. */
export function stepWithParam(
  step: WorkflowStep,
  key: string,
  value: WorkflowStepParamValue,
): WorkflowStep {
  return { ...step, params: { ...step.params, [key]: value } };
}
