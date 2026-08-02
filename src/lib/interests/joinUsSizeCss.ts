/**
 * Buduje scoped CSS dla rozmiarów czcionek i ikon widgetu "Dołącz do nas".
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
 * DLACZEGO POWTARZAMY `[data-jus-id]` W SELEKTORZE (SPECIFICITY_REPEATS):
 * samo `!important` nie wystarcza - w kaskadzie konkurują z nami INNE reguły
 * `!important` o wyższej specyficzności, generowane przez samą platformę:
 *   1. `buildWidgetTypographyCss()` (panel "Typografia" widgetu) emituje
 *      `[data-w-id="X"][data-w-id][data-w-id] p:not(.cms-post-title)
 *       :not([data-typography-exempt]):not(.post-list-numbered-index)
 *       :not(.rl-num){font-size:… !important}` → (0,7,1),
 *   2. globalne minimum iOS `@media (max-width:767px) input:not(…)×4
 *      {font-size:16px !important}` → (0,4,1),
 *   3. mobilne clampy nagłówków `[data-builder-renderer][data-device="mobile"]
 *      h3:not(.cms-post-title)` → (0,3,1).
 * Bez podbicia specyficzności ustawienie rozmiaru w tooltipie/panelu nie było
 * widoczne ani w podglądzie, ani na stronie publicznej, gdy widget miał
 * ustawioną typografię. Powtórzenie atrybutu daje (0,{1+N},…) - przy N = 7
 * mamy ≥ (0,9,1), czyli z zapasem ponad (0,7,1). Reguły powstają wyłącznie
 * wtedy, gdy operator faktycznie ustawił rozmiar (inaczej `""`).
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
  /** Sztywny rozmiar ikon (px). Puste = ikony skalują się z tekstem (1em). */
  iconSize?: number;
}

/** Bezpieczny zakres rozmiarów (px) - chroni przed absurdalnymi wartościami. */
const MIN_PX = 8;
const MAX_PX = 96;

/** Ile razy dokładamy `[data-jus-id]` do korzenia - patrz komentarz u góry. */
const SPECIFICITY_REPEATS = 7;

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
  const root = `[data-jus-id="${escapeId(jusId)}"]` + "[data-jus-id]".repeat(SPECIFICITY_REPEATS);
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
  // `svg` w liście potomków: ikony mają bok w `em`, więc muszą dziedziczyć
  // font-size kontrolki, do której należą (inaczej `1em` liczyłoby się od
  // rozmiaru narzuconego przez inną regułę).
  simple("perkSize", "li,span,p,a,strong,em,svg");
  simple("labelSize", "span,a");
  const label = normalize(sizes.labelSize);
  if (label !== null) {
    rules.push(`${root} .user-label{font-size:${label}px !important;}`);
  }
  simple("buttonSize", "span,svg");
  simple("consentSize", "span,a,strong,em");

  const field = normalize(sizes.placeholderSize);
  if (field !== null) {
    const input = `${root} [data-edit-target="placeholderSize"]`;
    rules.push(`${input}{font-size:${field}px !important;}`);
    rules.push(`${input}::placeholder{font-size:${field}px !important;}`);
    // iOS Safari zoomuje przy focusie, gdy font-size < 16px na wąskim ekranie.
    if (field < 16) {
      rules.push(`@media (max-width:767px){${input}{font-size:16px !important;}}`);
    }
  }

  // Ikony: bez `iconSize` skalują się z własnym tekstem (inline `1em` w
  // JoinUsForm), więc zmiana rozmiaru bulletpointów / przycisku / pól rusza
  // też ikonę. `iconSize` przypina je na sztywno w px.
  const icon = normalize(sizes.iconSize);
  if (icon !== null) {
    rules.push(
      `${root} [data-jus-icon]{width:${icon}px !important;height:${icon}px !important;` +
        `min-width:${icon}px !important;min-height:${icon}px !important;}`,
    );
  }

  return rules.join("");
}
