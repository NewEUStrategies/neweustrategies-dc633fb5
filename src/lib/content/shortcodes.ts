// Shortcode'y WordPressa - wspólny moduł importu (`lib/blocks/gutenberg.ts`)
// i renderu (bloki, legacy HTML, widget tekstu buildera).
//
// PO CO. WordPress (wptexturize) zapisuje cudzysłowy atrybutów jako `”“″`
// albo encje `&#8220;&#8221;&#8243;`, więc `[infogram id=”70a5…”]` nie
// pasował do żadnej reguły importu i trafiał do czytelnika jako tekst. Wpisy
// zaimportowane wcześniej mają taki shortcode w bazie (blok `paragraph`/`html`
// albo legacy HTML), dlatego render też go rozpoznaje.
//
// ZASADY.
// - Cudzysłowy normalizujemy WYŁĄCZNIE wewnątrz znacznika `[nazwa atrybut=…]`;
//   polskie „cudzysłowy” w zwykłym tekście zostają nietknięte.
// - Shortcode obsługujemy tylko wtedy, gdy jest CAŁĄ treścią bloku/akapitu.
//   Shortcode w środku zdania zostaje bez zmian.
// - Atrybuty przechodzą walidację, a adres osadzenia powstaje wyłącznie z listy
//   dostawców `parseEmbedUrl` (`isIframeEmbed`). Nic z atrybutu nie trafia do
//   HTML bez walidacji.
//
// Czysty moduł bez DOM: SSR i hydratacja liczą ten sam wynik.
import { INFOGRAM_ID, isIframeEmbed, parseEmbedUrl } from "@/lib/blocks/embed";

export interface Shortcode {
  /** Nazwa małymi literami (`infogram`, `su_divider`). */
  readonly name: string;
  /** Atrybuty po normalizacji cudzysłowów; klucze małymi literami. */
  readonly attrs: Readonly<Record<string, string>>;
  /** Treść między `[nazwa]` a `[/nazwa]` (pusta dla samozamykających). */
  readonly content: string;
}

/** Cudzysłowy zapisywane przez WordPress zamiast `"` (znaki i encje). */
const QUOTE_VARIANTS =
  /[“”„″]|&(?:#8220|#8221|#8222|#8243|#x201[cdeCDE]|#x2033|quot|ldquo|rdquo|bdquo|Prime);/g;

/**
 * Znacznik shortcode'u z atrybutem: `[nazwa klucz=…]`. Nazwa jak w WordPressie
 * (litera, potem litery/cyfry/`_`/`-`); w ciele co najmniej jedno `klucz=`.
 * Ciało bez `<`/`>`: nawias obejmujący znaczniki HTML nie jest shortcode'em,
 * a podmiana `&quot;` w atrybucie HTML zepsułaby znacznik.
 */
const TAG_WITH_ATTRS = /\[([A-Za-z][\w-]*)(\s+[^[\]<>]*?=[^[\]<>]*)\]/g;

/** Zamienia `”“″„` i ich encje na `"` tylko wewnątrz znaczników z atrybutami. */
export function normalizeShortcodeQuotes(input: string): string {
  if (!input || input.indexOf("[") === -1) return input;
  return input.replace(
    TAG_WITH_ATTRS,
    (_m, name: string, body: string) => `[${name}${body.replace(QUOTE_VARIANTS, '"')}]`,
  );
}

const ATTR_RE = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\]]+))/g;

/** Atrybuty z ciała znacznika (po normalizacji cudzysłowów). */
export function parseShortcodeAttrs(body: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of normalizeShortcodeQuotes(`[x ${body}]`).matchAll(ATTR_RE)) {
    const key = m[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Pojedynczy atrybut z ciała znacznika (pusty napis, gdy go brak). */
export function shortcodeAttr(body: string, name: string): string {
  return parseShortcodeAttrs(body)[name.toLowerCase()] ?? "";
}

/**
 * Nazwy bez `_`/`-` i bez atrybutów, które mimo to są shortcode'ami WordPressa.
 * Pozostałe gołe `[słowo]` (np. akapit „[aktualizacja]”) NIE są traktowane jako
 * shortcode, żeby render nie ukrył redakcyjnego tekstu.
 */
const BARE_SHORTCODE_NAMES = new Set([
  "audio",
  "embed",
  "gallery",
  "infogram",
  "playlist",
  "toc",
  "video",
]);

/** Treść akapitu, która nie jest tekstem: białe znaki, `&nbsp;`, `<br>`. */
const BLANK_HTML = /(?:\s|\u00a0|&nbsp;|&#160;|&#xa0;|<br\s*\/?>)+/gi;

/** Zewnętrzne opakowanie bloku: `<p>…</p>` / `<div>…</div>` bez innych znaczników. */
const WRAPPER = /^<(p|div)(?:\s[^>]*)?>([\s\S]*)<\/\1>$/i;

const STANDALONE =
  /^\[([A-Za-z][\w-]*)((?:\s+[^[\]<>]*)?)\](?:([^[\]<>]*)\[\/([A-Za-z][\w-]*)\])?$/;

/**
 * Shortcode będący CAŁĄ treścią bloku (HTML akapitu/bloku `html` albo tekst).
 * Zwraca `null`, gdy w bloku jest cokolwiek poza jednym shortcode'em.
 */
export function standaloneShortcode(html: string | null | undefined): Shortcode | null {
  if (!html || html.indexOf("[") === -1) return null;
  let inner = html.trim();
  for (let guard = 0; guard < 3; guard += 1) {
    const wrapped = WRAPPER.exec(inner);
    if (!wrapped || /<(?:p|div)[\s>]/i.test(wrapped[2])) break;
    inner = wrapped[2].trim();
  }
  inner = normalizeShortcodeQuotes(inner.replace(BLANK_HTML, " ").trim());
  const m = STANDALONE.exec(inner);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const closing = m[4]?.toLowerCase();
  if (closing !== undefined && closing !== name) return null;
  const body = m[2] ?? "";
  const hasAttrs = /=/.test(body);
  const looksLikeShortcode =
    hasAttrs || closing !== undefined || /[_-]/.test(name) || BARE_SHORTCODE_NAMES.has(name);
  if (!looksLikeShortcode) return null;
  return {
    name,
    attrs: hasAttrs ? parseShortcodeAttrs(body) : {},
    content: (m[3] ?? "").trim(),
  };
}

function embedUrlCandidate(sc: Shortcode): string {
  switch (sc.name) {
    case "infogram": {
      const id = sc.attrs.id ?? "";
      return INFOGRAM_ID.test(id) ? `https://e.infogram.com/${id}?src=embed` : "";
    }
    case "embed":
      return sc.content;
    case "su_youtube":
    case "su_vimeo":
    case "su_video":
      return sc.attrs.url ?? "";
    default:
      return "";
  }
}

/**
 * Adres osadzenia znanego shortcode'u - wyłącznie wtedy, gdy `parseEmbedUrl`
 * rozpoznaje go jako dostawcę iframe. Zwraca adres WEJŚCIOWY (do pola `url`
 * bloku `embed`); kanoniczny adres iframe liczy `parseEmbedUrl` przy renderze.
 */
export function shortcodeEmbedUrl(sc: Shortcode): string | null {
  const candidate = embedUrlCandidate(sc);
  if (!candidate) return null;
  return isIframeEmbed(parseEmbedUrl(candidate)) ? candidate : null;
}

export type StandaloneShortcodeResult =
  | { readonly kind: "embed"; readonly name: string; readonly url: string }
  | { readonly kind: "unsupported"; readonly name: string };

/**
 * Rozstrzyga blok złożony z jednego shortcode'u: znany dostawca -> `embed`,
 * pozostałe -> `unsupported` (czytelnik ich nie widzi). `null`, gdy blok nie
 * jest samodzielnym shortcode'em (render bez zmian).
 */
export function resolveStandaloneShortcode(
  html: string | null | undefined,
): StandaloneShortcodeResult | null {
  const sc = standaloneShortcode(html);
  if (!sc) return null;
  const url = shortcodeEmbedUrl(sc);
  if (url) return { kind: "embed", name: sc.name, url };
  // Nieznany shortcode z treścią (`[su_note]tekst[/su_note]`) niesie tekst
  // redakcji - ukrycie go zgubiłoby treść, więc blok zostaje bez zmian.
  // Wyjątek: `[embed]` trzyma w treści adres, nie tekst.
  if (sc.content && sc.name !== "embed") return null;
  return { kind: "unsupported", name: sc.name };
}

function escAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Znaczniki osadzenia jak `renderEmbed` (bloki), żeby legacy HTML i widget
 * tekstu buildera malowały tę samą ramkę. Adres i dostawca pochodzą wyłącznie
 * z `parseEmbedUrl` po `isIframeEmbed`.
 */
function embedHtml(url: string): string {
  const parsed = parseEmbedUrl(url);
  if (!parsed || !isIframeEmbed(parsed)) return "";
  const frame = parsed.provider === "infogram" ? "min-h-[480px]" : "aspect-video";
  return (
    `<div class="relative ${frame} w-full" data-shortcode-embed="${escAttr(parsed.provider)}">` +
    `<iframe src="${escAttr(parsed.embedUrl)}" title="${escAttr(parsed.provider)}"` +
    ` allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"` +
    ` allowfullscreen loading="lazy" class="absolute inset-0 w-full h-full rounded-lg"></iframe></div>`
  );
}

/** Akapit `<p>…</p>` z samym shortcode'em (po sanitizacji). */
const SHORTCODE_PARAGRAPH = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi;

/**
 * Goła linia z samym shortcode'em między elementami blokowymi (treść klasyczna
 * WordPressa bez `wpautop`): na początku dokumentu albo po zamknięciu bloku,
 * przed kolejnym blokiem albo końcem.
 */
const SHORTCODE_LINE =
  /(^|<\/(?:p|div|h[1-6]|ul|ol|blockquote|figure|table|pre)>|<br\s*\/?>)((?:\s|&nbsp;)*\[[A-Za-z][\w-]*[^[\]<>]*\](?:[^[\]<>]*\[\/[A-Za-z][\w-]*\])?(?:\s|&nbsp;)*)(?=<(?:p|div|h[1-6]|ul|ol|blockquote|figure|table|pre|br)[\s>/]|$)/gi;

export interface DecorateShortcodesOptions {
  /**
   * Podgląd w panelu: zamiast ukrywać nieobsłużony shortcode, pokaż plakietkę
   * z tą etykietą (np. „Nieobsłużony shortcode: [nazwa]”). Brak = czytelnik.
   */
  readonly unsupportedLabel?: (name: string) => string;
}

function unsupportedBadge(name: string, label: (name: string) => string): string {
  return (
    `<p class="not-prose inline-flex rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground"` +
    ` data-unsupported-shortcode="${escAttr(name)}">${escAttr(label(name))}</p>`
  );
}

function replaceStandalone(
  segment: string,
  whole: string,
  options: DecorateShortcodesOptions,
): string {
  if (segment.indexOf("[") === -1) return whole;
  const resolved = resolveStandaloneShortcode(segment);
  if (!resolved) return whole;
  if (resolved.kind === "embed") return embedHtml(resolved.url);
  return options.unsupportedLabel ? unsupportedBadge(resolved.name, options.unsupportedLabel) : "";
}

/**
 * Post-sanityzacyjny dekorator HTML (legacy treść wpisu, widget `text`
 * buildera): akapit albo linia złożone z jednego shortcode'u stają się
 * osadzeniem znanego dostawcy, a nieznany shortcode znika. Wnosi wyłącznie
 * znaczniki zbudowane z walidowanych wartości (`embedHtml`), nigdy treść
 * atrybutu shortcode'u. HTML bez `[` wraca bez zmian (ten sam napis).
 */
export function decorateStandaloneShortcodes(
  html: string,
  options: DecorateShortcodesOptions = {},
): string {
  if (!html || html.indexOf("[") === -1) return html;
  return html
    .replace(SHORTCODE_PARAGRAPH, (whole: string, inner: string) =>
      replaceStandalone(inner, whole, options),
    )
    .replace(SHORTCODE_LINE, (whole: string, before: string, line: string) => {
      const out = replaceStandalone(line, line, options);
      return out === line ? whole : `${before}${out}`;
    });
}
