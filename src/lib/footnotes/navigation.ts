// Nawigacja po przypisach - JEDNO miejsce z logiką skoków marker <-> sekcja.
//
// Kontrakt markera (patrz lib/footnotes.ts) daje nam parę identyfikatorów:
//   marker w treści:  id="fnref-N", href="#fn-N"
//   wpis w sekcji:    id="fn-N",    backlink href="#fnref-N"
//
// Natywny skok kotwicy jest tu za słaby z dwóch powodów: sticky header zasłania
// cel (brak offsetu), a `history` zapełnia się wpisami przy każdym skoku tam i
// z powrotem. Dlatego przechwytujemy klik i przewijamy sami - płynnie, z
// offsetem i z poszanowaniem `prefers-reduced-motion`.

/** Odstęp od górnej krawędzi (sticky header + oddech). */
const SCROLL_OFFSET_PX = 112;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Przewija do elementu o danym `id`; zwraca false, gdy celu nie ma w DOM. */
export function scrollToFootnoteId(id: string): boolean {
  if (typeof document === "undefined") return false;
  const target = document.getElementById(id);
  if (!target) return false;
  const top = target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET_PX;
  window.scrollTo({ top: Math.max(top, 0), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  // Fokus bez ponownego skoku - dla czytników ekranu i klawiatury.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  try {
    window.history.replaceState(null, "", `#${id}`);
  } catch {
    /* replaceState bywa zablokowany w piaskownicach - skok i tak zadziałał */
  }
  return true;
}

/**
 * Wyciąga docelowy `id` przypisu z klikniętego elementu.
 * Obsługuje marker w treści (`#fn-N`), backlink z sekcji (`#fnref-N`) oraz
 * klikalny numer pozycji w sekcji (`[data-footnote-backlink]`).
 */
export function resolveFootnoteTargetId(el: Element | null): string | null {
  const a = el?.closest?.("a[href^='#fn-'], a[href^='#fnref-']") as HTMLAnchorElement | null;
  if (!a) return null;
  const hash = a.getAttribute("href") ?? "";
  if (!hash.startsWith("#")) return null;
  const id = hash.slice(1);
  return /^fn(ref)?-\d+$/.test(id) ? id : null;
}
