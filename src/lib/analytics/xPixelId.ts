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
