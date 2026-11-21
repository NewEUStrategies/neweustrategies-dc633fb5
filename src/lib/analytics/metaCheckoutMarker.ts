// Znacznik płatności dla piksela Meta: most między kasą a stroną powrotu.
//
// Kasa (plan, darowizna, bilet) zna kwotę i walutę, ale wynik płatności zna
// dopiero operator, który odsyła kupującego na stronę powrotu (`return_url`).
// Kasa zapisuje więc w `sessionStorage` TEJ karty, co zostało zamówione:
// - plan i darowizna: strona potwierdzenia ZUŻYWA znacznik (odczyt =
//   usunięcie) i wysyła Purchase/Subscribe/StartTrial/Donate jeden raz,
// - bilet: powrót trafia na stronę wydarzenia, więc znacznik niesie numer
//   zamówienia, a zdarzenie wychodzi dopiero, gdy baza potwierdzi `paid`
//   (patrz `metaTicketPurchase.ts`).
// Wejście na stronę potwierdzenia bez świeżej płatności nie wysyła niczego.
//
// Bez danych osobowych: kwota, waluta, identyfikatory planu/wydarzenia/zamówienia.
import type { MetaStandardEvent } from "./metaPixelEvents";

export type MetaCheckoutKind = "membership" | "donation" | "ticket";
export type MetaCheckoutEvent = Extract<
  MetaStandardEvent,
  "Purchase" | "Subscribe" | "Donate" | "StartTrial"
>;

export interface MetaCheckoutMarker {
  event: MetaCheckoutEvent;
  value: number;
  currency: string;
  contentId: string;
  category: string;
  eventId: string;
  createdAt: number;
  /** Zamówienie do potwierdzenia w bazie (bilety). */
  orderId?: string;
  /** Przewidywana wartość klienta (StartTrial). */
  predictedLtv?: number;
}

/** Płatność dłuższa niż 6 h to już nie ten sam powrót z kasy. */
export const META_CHECKOUT_MARKER_TTL_MS = 6 * 60 * 60 * 1000;
const EVENTS: readonly MetaCheckoutEvent[] = ["Purchase", "Subscribe", "Donate", "StartTrial"];

function storageKey(kind: MetaCheckoutKind): string {
  return `meta:checkout:${kind}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isMarker(value: unknown): value is MetaCheckoutMarker {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["event"] === "string" &&
    (EVENTS as readonly string[]).includes(v["event"]) &&
    typeof v["value"] === "number" &&
    Number.isFinite(v["value"]) &&
    typeof v["currency"] === "string" &&
    typeof v["contentId"] === "string" &&
    typeof v["category"] === "string" &&
    typeof v["eventId"] === "string" &&
    typeof v["createdAt"] === "number" &&
    isOptionalString(v["orderId"]) &&
    isOptionalNumber(v["predictedLtv"])
  );
}

export function rememberMetaCheckout(
  kind: MetaCheckoutKind,
  marker: Omit<MetaCheckoutMarker, "createdAt">,
  now: number = Date.now(),
): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(storageKey(kind), JSON.stringify({ ...marker, createdAt: now }));
  } catch {
    /* pełny/zablokowany storage - pomiar jest best-effort */
  }
}

/** Odczytuje znacznik BEZ usuwania; nieważny lub przeterminowany usuwa i zwraca null. */
export function peekMetaCheckout(
  kind: MetaCheckoutKind,
  now: number = Date.now(),
): MetaCheckoutMarker | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(storageKey(kind));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const age = isMarker(parsed) ? now - parsed.createdAt : -1;
  if (!isMarker(parsed) || age < 0 || age > META_CHECKOUT_MARKER_TTL_MS) {
    clearMetaCheckout(kind);
    return null;
  }
  return parsed;
}

export function clearMetaCheckout(kind: MetaCheckoutKind): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(storageKey(kind));
  } catch {
    /* ignore */
  }
}

/** Odczytuje i USUWA znacznik; zwraca go tylko, gdy jest poprawny i świeży. */
export function consumeMetaCheckout(
  kind: MetaCheckoutKind,
  now: number = Date.now(),
): MetaCheckoutMarker | null {
  const marker = peekMetaCheckout(kind, now);
  clearMetaCheckout(kind);
  return marker;
}
