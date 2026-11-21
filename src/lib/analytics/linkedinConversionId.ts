// Czysta normalizacja ID konwersji LinkedIn (bez zależności przeglądarkowych),
// współdzielona przez schemat ustawień i moduł zdarzeń Insight.

const ID_RE = /^\d{1,20}$/;
const SNIPPET_RE = /conversion_id\s*["']?\s*:\s*["']?(\d{1,20})/;

/**
 * Przyjmuje sam numer albo fragment `window.lintrk('track', { conversion_id: 123 })`
 * z Campaign Manager; cokolwiek innego -> "".
 */
export function extractLinkedInConversionId(raw: string): string {
  const value = raw.trim();
  if (ID_RE.test(value)) return value;
  const match = SNIPPET_RE.exec(value);
  return match?.[1] ?? "";
}
