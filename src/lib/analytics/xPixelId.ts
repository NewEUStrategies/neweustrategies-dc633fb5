// Czysta normalizacja identyfikatora piksela X Ads (bez zależności
// przeglądarkowych), współdzielona przez schemat ustawień, panel i moduł zdarzeń.

/** Znacznik na `window`: kod bazowy nie wysyła drugiego `config` dla tego samego piksela. */
export const X_PIXEL_MARKER = "__nesXPixel";

/** Identyfikator piksela X (np. `rjppz`): małe litery i cyfry. */
export const X_PIXEL_ID_RE = /^[a-z0-9]{4,12}$/;
const SNIPPET_RE = /twq\(\s*["']config["']\s*,\s*["']([a-z0-9]{4,12})["']/i;

/**
 * Przyjmuje sam identyfikator albo cały kod bazowy z X Ads Managera
 * (`twq('config','rjppz')`); cokolwiek innego -> "".
 */
export function extractXPixelId(raw: string): string {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (X_PIXEL_ID_RE.test(lower)) return lower;
  const match = SNIPPET_RE.exec(value);
  return match?.[1]?.toLowerCase() ?? "";
}

/** Identyfikator zdarzenia X (np. `tw-rjppz-q1w2e`): `tw-<piksel>-<zdarzenie>`. */
export const X_EVENT_ID_RE = /^tw-[a-z0-9]{4,12}-[a-z0-9]{4,12}$/;
const EVENT_SNIPPET_RE = /twq\(\s*["']event["']\s*,\s*["'](tw-[a-z0-9]{4,12}-[a-z0-9]{4,12})["']/i;
const EVENT_ID_ANYWHERE_RE = /\b(tw-[a-z0-9]{4,12}-[a-z0-9]{4,12})\b/i;

/**
 * Przyjmuje sam identyfikator zdarzenia albo cały kod zdarzenia z X Events
 * Managera (`twq('event', 'tw-rjppz-q1w2e', {...})`); cokolwiek innego -> "".
 */
export function extractXEventId(raw: string): string {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (X_EVENT_ID_RE.test(lower)) return lower;
  const match = EVENT_SNIPPET_RE.exec(value) ?? EVENT_ID_ANYWHERE_RE.exec(value);
  return match?.[1]?.toLowerCase() ?? "";
}

/** Piksel, do którego należy zdarzenie (`tw-rjppz-…` -> `rjppz`); dla śmieci "". */
export function xEventPixelId(eventId: string): string {
  const id = extractXEventId(eventId);
  return id ? (id.split("-")[1] ?? "") : "";
}
