/**
 * Buduje scoped CSS dla rozmiarów czcionek widgetu "Dołącz do nas".
 *
 * Dlaczego CSS, a nie same style inline: platforma ma globalne reguły
 * (`.admin-compact li/label/span`, `.join-us-shell label`, `::placeholder`,
 * responsywne `!important` dla nagłówków i iOS-owe minimum 16px na inputach),
 * które celują bezpośrednio w elementy potomne. Inline `font-size` na
 * rodzicu (np. `<ul>`) nie jest wtedy dziedziczony przez `<li>`, a reguły
 * `!important` biją styl inline. Scoped `<style>` z tym samym `!important`
 * i selektorem po `data-jus-id` wygrywa deterministycznie - identycznie
 * w podglądzie buildera i na stronie publicznej.
 *
 * i18n: brak treści tekstowych - czysty CSS.
 */

export interface JoinUsSizes {
  titleSize?: number;
  descriptionSize?: number;
  perkSize?: number;
  labelSize?: number;
  placeholderSize?: number;
  buttonSize?: number;
  consentSize?: number;
}

/** Bezpieczny zakres rozmiarów (px) - chroni przed absurdalnymi wartościami. */
const MIN_PX = 8;
const MAX_PX = 96;

function normalize(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_PX, Math.max(MIN_PX, Math.round(value)));
}

/** Escapuje wartość atrybutu w selektorze. */
function escapeId(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

/**
 * Zwraca arkusz CSS (bez tagu <style>) lub pusty string, gdy operator nie
 * ustawił żadnego rozmiaru.
 */
export function buildJoinUsSizeCss(jusId: string, sizes: JoinUsSizes): string {
  if (!jusId) return "";
  const root = `[data-jus-id="${escapeId(jusId)}"]`;
  const rules: string[] = [];

  const simple = (key: keyof JoinUsSizes, extraDescendants?: string) => {
    const px = normalize(sizes[key]);
    if (px === null) return;
    const target = `${root} [data-edit-target="${key}"]`;
    rules.push(`${target}{font-size:${px}px !important;}`);
    if (extraDescendants) {
      rules.push(`${target} :is(${extraDescendants}){font-size:inherit !important;}`);
    }
  };

  simple("titleSize");
  simple("descriptionSize", "span,a,strong,em");
  simple("perkSize", "li,span,p,a,strong,em");
  simple("labelSize", "span,a");
  simple("buttonSize", "span,svg");
  simple("consentSize", "span,a,strong,em");

  const field = normalize(sizes.placeholderSize);
  if (field !== null) {
    const input = `${root} [data-edit-target="placeholderSize"]`;
    rules.push(`${input}{font-size:${field}px !important;}`);
    rules.push(`${input}::placeholder{font-size:${field}px !important;}`);
    // Floating label jest wizualnym placeholderem pola - musi iść za nim.
    rules.push(
      `${root} .input-group:has(> [data-edit-target="placeholderSize"]) .user-label{font-size:${field}px !important;}`,
    );
    // iOS Safari zoomuje przy focusie, gdy font-size < 16px na wąskim ekranie.
    if (field < 16) {
      rules.push(`@media (max-width:767px){${input}{font-size:16px !important;}}`);
    }
  }

  return rules.join("");
}
