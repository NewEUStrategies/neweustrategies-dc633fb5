// Centralna TABELA rozmiarów czcionek platformy (etykiety, pola, listy
// rozwijane, przyciski, pole czatu, tekst pomocniczy).
//
// PO CO: dotąd każdy rozmiar żył jako `font-size: 12px !important` rozsiany po
// `src/styles.css`. Każda korekta wymagała edycji CSS i "przewijała się"
// losowo między widokami. Teraz CSS konsumuje WYŁĄCZNIE zmienne `--fs-*`,
// a ich wartości pochodzą z jednej tabeli: domyślnej (poniżej) i - jeśli
// tenant coś nadpisze - z `site_design_tokens.font_scale`.
//
// Kontrakt:
//   - klucz tokenu jest stabilny (zapisywany w bazie),
//   - `cssVar` jest stabilny (konsumowany przez styles.css),
//   - wartość to liczba pikseli w zakresie [min, max] (walidacja + clamp).

export interface FontScaleToken {
  /** Stabilny klucz zapisu w bazie. */
  key: string;
  /** Zmienna CSS konsumowana przez `src/styles.css`. */
  cssVar: string;
  /** Klucz i18n etykiety (`fontScale.tokens.<key>.label`). */
  labelKey: string;
  /** Klucz i18n opisu zasięgu (`fontScale.tokens.<key>.scope`). */
  scopeKey: string;
  /** Domyślny rozmiar w px. */
  defaultPx: number;
  /** Dolna granica bezpieczeństwa (czytelność). */
  minPx: number;
  /** Górna granica bezpieczeństwa (układ). */
  maxPx: number;
}

export const FONT_SCALE_TOKENS: readonly FontScaleToken[] = [
  {
    key: "label",
    cssVar: "--fs-label",
    labelKey: "fontScale.tokens.label.label",
    scopeKey: "fontScale.tokens.label.scope",
    defaultPx: 12,
    minPx: 9,
    maxPx: 18,
  },
  {
    key: "input",
    cssVar: "--fs-input",
    labelKey: "fontScale.tokens.input.label",
    scopeKey: "fontScale.tokens.input.scope",
    defaultPx: 12,
    minPx: 9,
    maxPx: 18,
  },
  {
    key: "placeholder",
    cssVar: "--fs-placeholder",
    labelKey: "fontScale.tokens.placeholder.label",
    scopeKey: "fontScale.tokens.placeholder.scope",
    defaultPx: 12,
    minPx: 9,
    maxPx: 18,
  },
  {
    key: "droplist",
    cssVar: "--fs-droplist",
    labelKey: "fontScale.tokens.droplist.label",
    scopeKey: "fontScale.tokens.droplist.scope",
    defaultPx: 12,
    minPx: 9,
    maxPx: 18,
  },
  {
    key: "button",
    cssVar: "--fs-button",
    labelKey: "fontScale.tokens.button.label",
    scopeKey: "fontScale.tokens.button.scope",
    defaultPx: 12,
    minPx: 9,
    maxPx: 18,
  },
  {
    key: "chatComposer",
    cssVar: "--fs-chat-composer",
    labelKey: "fontScale.tokens.chatComposer.label",
    scopeKey: "fontScale.tokens.chatComposer.scope",
    defaultPx: 11.5,
    minPx: 9,
    maxPx: 18,
  },
] as const;

/** Nadpisania tenanta: klucz tokenu → rozmiar w px. */
export type FontScaleValue = Record<string, number>;

export const EMPTY_FONT_SCALE: FontScaleValue = {};

const tokenByKey = new Map(FONT_SCALE_TOKENS.map((t) => [t.key, t]));

const clamp = (token: FontScaleToken, px: number): number =>
  Math.min(token.maxPx, Math.max(token.minPx, px));

/**
 * Przycina zapis z bazy do znanych kluczy i bezpiecznych zakresów.
 * Nieznane klucze i wartości nieliczbowe są pomijane - CSS nigdy nie dostaje
 * wartości spoza kontraktu.
 */
export function normalizeFontScale(raw: unknown): FontScaleValue {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_FONT_SCALE;
  const out: FontScaleValue = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const token = tokenByKey.get(key);
    if (!token) continue;
    const px = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(px)) continue;
    out[key] = clamp(token, px);
  }
  return out;
}

/** Rozmiar efektywny (nadpisanie tenanta albo domyślny z tabeli). */
export function effectiveFontSize(value: FontScaleValue, key: string): number {
  const token = tokenByKey.get(key);
  if (!token) return 0;
  const override = value[key];
  return typeof override === "number" ? clamp(token, override) : token.defaultPx;
}

/**
 * CSS ze zmiennymi `--fs-*` dla `:root`. Emitujemy tylko realne nadpisania -
 * wartości domyślne żyją w `src/styles.css`, więc SSR bez wiersza w bazie
 * renderuje dokładnie tę samą typografię.
 */
export function fontScaleToCss(value: FontScaleValue): string {
  const decls = FONT_SCALE_TOKENS.filter((t) => typeof value[t.key] === "number")
    .map((t) => `${t.cssVar}:${clamp(t, value[t.key] as number)}px;`)
    .join("");
  return decls ? `:root{${decls}}` : "";
}
