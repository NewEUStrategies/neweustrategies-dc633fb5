// Parser liczb dowodowych hero kariery ("45", "100%", "3x").
//
// Czysty moduł bez Reacta: wartość pochodzi ze słownika i18n (string), a atom
// `CareerStat` animuje wyłącznie część liczbową - sufiks ("%", "x") renderuje
// statycznie. Wartości nienumeryczne wracają jako `target: null` i wyświetlają
// się bez animacji, więc redakcja może wpisać do słownika dowolny tekst.

export interface ParsedStatValue {
  /** Cel odliczania; `null`, gdy wartość nie zaczyna się liczbą całkowitą. */
  readonly target: number | null;
  /** Sufiks doklejany za liczbą (np. "%", "x", "+"). */
  readonly suffix: string;
}

const LEADING_INT = /^(\d+)(.*)$/;

export function parseStatValue(raw: string): ParsedStatValue {
  const match = LEADING_INT.exec(raw.trim());
  if (!match) return { target: null, suffix: raw };
  return { target: Number.parseInt(match[1], 10), suffix: match[2] };
}

/** Ease-out cubic - odliczanie zwalnia przy końcu zamiast urywać się liniowo. */
export function easeOutCubic(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - clamped, 3);
}
