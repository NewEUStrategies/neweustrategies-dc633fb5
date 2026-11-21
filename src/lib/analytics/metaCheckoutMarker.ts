// Znacznik płatności dla piksela Meta: most między kasą a stroną powrotu.
//
// Kasa (plan, darowizna) zna kwotę i walutę, ale wynik płatności zna dopiero
// operator, który odsyła kupującego na stronę potwierdzenia (`return_url`).
// Kasa zapisuje więc w `sessionStorage` TEJ karty, co zostało zamówione, a
// strona potwierdzenia ZUŻYWA znacznik (odczyt = usunięcie) i wysyła
// Purchase/Subscribe/Donate jeden raz. Wejście na stronę potwierdzenia bez
// świeżej płatności (zakładka, odświeżenie) nie wysyła niczego.
//
// Bez danych osobowych: kwota, waluta, identyfikator planu i kategoria.
import type { MetaStandardEvent } from "./metaPixelEvents";

export type MetaCheckoutKind = "membership" | "donation";
export type MetaCheckoutEvent = Extract<MetaStandardEvent, "Purchase" | "Subscribe" | "Donate">;

export interface MetaCheckoutMarker {
  event: MetaCheckoutEvent;
  value: number;
  currency: string;
  contentId: string;
  category: string;
  eventId: string;
  createdAt: number;
}

/** Płatność dłuższa niż 6 h to już nie ten sam powrót z kasy. */
export const META_CHECKOUT_MARKER_TTL_MS = 6 * 60 * 60 * 1000;
const EVENTS: readonly MetaCheckoutEvent[] = ["Purchase", "Subscribe", "Donate"];

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
    typeof v["createdAt"] === "number"
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

/** Odczytuje i USUWA znacznik; zwraca go tylko, gdy jest poprawny i świeży. */
export function consumeMetaCheckout(
  kind: MetaCheckoutKind,
  now: number = Date.now(),
): MetaCheckoutMarker | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(storageKey(kind));
    store.removeItem(storageKey(kind));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isMarker(parsed)) return null;
  const age = now - parsed.createdAt;
  if (age < 0 || age > META_CHECKOUT_MARKER_TTL_MS) return null;
  return parsed;
}
