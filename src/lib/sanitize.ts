/**
 * Sanitization helpers for user-authored builder content.
 * Use everywhere we render values coming out of `builder_data` JSONB or any
 * other user-controlled field.
 *
 * Two engines behind one API:
 *   - Browser: DOMPurify. Imported from `dompurify` directly - NEVER from
 *     `isomorphic-dompurify`, whose browser build calls
 *     `purify.sanitize.bind(purify)` at module scope and therefore crashes the
 *     whole Cloudflare Worker at init (no DOM -> no `sanitize` -> TypeError ->
 *     every request 500s as an opaque h3 HTTPError), and whose Node fallback
 *     (jsdom) cannot run on workerd either.
 *   - Server (SSR in workerd / Node dev): the allowlist walker in
 *     lib/ssrSanitizeHtml. The `import.meta.env.SSR` branch is statically
 *     replaced per build target, so the client bundle tree-shakes the parser
 *     away and the worker bundle never calls DOMPurify.
 *
 * Obie ścieżki przeglądarkowe przechodzą przez KANARKA silnika
 * (lib/sanitizeEngineGuard): przed pierwszym użyciem sprawdzamy, że DOMPurify w
 * tym środowisku faktycznie usuwa `<script>` / `<style>` / `<iframe>`. Gdy nie
 * usuwa (patrz udokumentowana regresja `nodeName` w dompurify >= 3.4.8 na
 * silnikach DOM definiujących `nodeName` poza `Node.prototype`), degradujemy do
 * zaescape'owanego tekstu, zamiast wypuścić niesanityzowany HTML do DOM-u.
 * Dlatego `dompurify` jest w package.json PRZYPIĘTY dokładnie (bez `^`) - i
 * dlatego samo przypięcie nie jest jedyną mitygacją.
 */
import DOMPurify from "dompurify";

import { ssrSanitizeHtml } from "./ssrSanitizeHtml";
import { assertSanitizerEngine, escapeHtmlToText } from "./sanitizeEngineGuard";

// ---------- HTML ----------

/** Polityka HTML treści blokowych/builderowych (najostrzejsza). */
const HTML_POLICY: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "style"],
};

/** Polityka HTML dla treści markdownowych (dopuszcza atrybut `style`). */
const MARKDOWN_POLICY: Parameters<typeof DOMPurify.sanitize>[1] = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
};

const purifyWithHtmlPolicy = (dirty: string): string => DOMPurify.sanitize(dirty, HTML_POLICY);
const purifyWithMarkdownPolicy = (dirty: string): string =>
  DOMPurify.sanitize(dirty, MARKDOWN_POLICY);

/** Sanitize a string of HTML, preserving safe markup only. */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return "";
  if (import.meta.env.SSR) return ssrSanitizeHtml(dirty);
  if (assertSanitizerEngine(purifyWithHtmlPolicy) === "degraded") return escapeHtmlToText(dirty);
  return purifyWithHtmlPolicy(dirty);
}

/** Sanitize markdown-rendered HTML. Allow more (figures, blockquotes). */
export function sanitizeMarkdownHtml(dirty: string): string {
  if (!dirty) return "";
  if (import.meta.env.SSR) return ssrSanitizeHtml(dirty, { allowStyleAttr: true });
  // Kanarek jest wspólny dla obu polityk - degradacja silnika nie zależy od
  // konfiguracji, tylko od kształtu DOM-u, a jedno badanie wystarczy.
  if (assertSanitizerEngine(purifyWithHtmlPolicy) === "degraded") return escapeHtmlToText(dirty);
  return purifyWithMarkdownPolicy(dirty);
}

// Czyste helpery żyją w sanitizePure.ts (bez DOMPurify) - patrz komentarz tam.
// Re-eksport utrzymuje dotychczasowe API tego modułu; konsumenci na ścieżce
// bootowania importują bezpośrednio z sanitizePure, żeby nie ciągnąć DOMPurify.
export {
  htmlToPlainText,
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
  hardenStyleCss,
} from "./sanitizePure";
