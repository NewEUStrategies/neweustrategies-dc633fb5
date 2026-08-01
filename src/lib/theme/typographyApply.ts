// Normalizacja typografii w już opublikowanych treściach.
//
// Globalne tokeny (`font_sizes` + odstępy) działają przez zmienne CSS, więc
// każdy wpis dziedziczy je automatycznie - Z JEDNYM WYJĄTKIEM: treści
// zaimportowane (WordPress, wklejenie z Worda) potrafią mieć zaszyte inline
// `font-size` / `line-height`, które nadpisują motyw. Te funkcje są czyste
// (bez I/O), dzięki czemu są testowalne i współdzielone przez server fn oraz
// podgląd "dry-run" w panelu.

/** Właściwości CSS, które musi kontrolować motyw, a nie inline style. */
const TYPO_PROPS = ["font-size", "line-height", "font-family", "letter-spacing"] as const;

const TYPO_JSON_KEYS = new Set([
  "fontSize",
  "font_size",
  "lineHeight",
  "line_height",
  "fontFamily",
  "font_family",
  "letterSpacing",
  "letter_spacing",
]);

const isTypoDeclaration = (declaration: string): boolean => {
  const prop = declaration.split(":")[0]?.trim().toLowerCase() ?? "";
  return TYPO_PROPS.some((p) => prop === p || prop === `-webkit-${p}`);
};

/** Usuwa deklaracje typografii z pojedynczej wartości atrybutu `style`. */
export function stripTypographyDeclarations(styleValue: string): string {
  return styleValue
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.length > 0 && !isTypoDeclaration(d))
    .join("; ");
}

/**
 * Usuwa inline `font-size` / `line-height` / `font-family` / `letter-spacing`
 * z HTML wpisu, zostawiając pozostałe style (kolory, marginesy) nietknięte.
 */
export function stripInlineTypography(html: string): string {
  if (!html) return html;
  return html.replace(
    /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (_match, _quoted: string, dq?: string, sq?: string) => {
      const value = dq ?? sq ?? "";
      const cleaned = stripTypographyDeclarations(value);
      if (!cleaned) return "";
      const quote = dq !== undefined ? '"' : "'";
      return ` style=${quote}${cleaned}${quote}`;
    },
  );
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Rekurencyjnie usuwa klucze typografii (fontSize/lineHeight/...) oraz inline
 * style z drzewa bloków Gutenberga / dokumentu buildera.
 */
export function stripTypographyFromJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripTypographyFromJson);
  if (value && typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, val] of Object.entries(value)) {
      if (TYPO_JSON_KEYS.has(key)) continue;
      if (key === "style" && typeof val === "string") {
        const cleaned = stripTypographyDeclarations(val);
        if (cleaned) out[key] = cleaned;
        continue;
      }
      if (key === "html" && typeof val === "string") {
        out[key] = stripInlineTypography(val);
        continue;
      }
      out[key] = stripTypographyFromJson(val);
    }
    return out;
  }
  return value;
}

export interface TypographyPostInput {
  id: string;
  slug: string;
  title: string;
  content_pl: string | null;
  content_en: string | null;
  blocks_data: JsonValue;
  builder_data: JsonValue;
}

export interface TypographyPostPatch {
  id: string;
  slug: string;
  title: string;
  content_pl?: string | null;
  content_en?: string | null;
  blocks_data?: JsonValue;
  builder_data?: JsonValue;
}

/**
 * Zwraca patch tylko dla wpisów, które faktycznie mają zaszytą typografię.
 * `null` = wpis już dziedziczy motyw i nie wymaga zapisu.
 */
export function buildTypographyPatch(post: TypographyPostInput): TypographyPostPatch | null {
  const patch: TypographyPostPatch = { id: post.id, slug: post.slug, title: post.title };
  let changed = false;

  for (const field of ["content_pl", "content_en"] as const) {
    const original = post[field];
    if (typeof original !== "string" || original.length === 0) continue;
    const next = stripInlineTypography(original);
    if (next !== original) {
      patch[field] = next;
      changed = true;
    }
  }

  for (const field of ["blocks_data", "builder_data"] as const) {
    const original = post[field];
    if (original === null || original === undefined) continue;
    const next = stripTypographyFromJson(original);
    if (JSON.stringify(next) !== JSON.stringify(original)) {
      patch[field] = next;
      changed = true;
    }
  }

  return changed ? patch : null;
}
