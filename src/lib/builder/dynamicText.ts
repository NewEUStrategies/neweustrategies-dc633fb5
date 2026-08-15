// Dynamic-text resolver. Users can weave tokens like `{post.title}` or
// `{author.name}` into free-text widget fields (animated heading, headings,
// buttons, CTA, …). At render time the token is replaced with the current
// post/archive context surfaced through `CurrentPostProvider`; inside the
// admin builder canvas the placeholder context supplies realistic previews.
//
// The resolver is intentionally string-in / string-out and *safe*: unknown
// tokens are left untouched so authors can spot typos, and no HTML is
// generated - callers keep full control over presentation.
import type { CurrentPostCtx } from "@/lib/content-model/postContext";

export type DynamicTagLang = "pl" | "en";

export interface DynamicTagDef {
  /** Token as typed by the user - always wrapped in curly braces. */
  token: string;
  /** Short i18n-agnostic English label used inside the admin picker. */
  label: string;
  /** Optional short description surfaced next to the label. */
  description?: string;
}

export const DYNAMIC_TAG_GROUPS: {
  id: "post" | "author" | "taxonomy" | "site";
  labelPl: string;
  labelEn: string;
  tags: DynamicTagDef[];
}[] = [
  {
    id: "post",
    labelPl: "Wpis",
    labelEn: "Post",
    tags: [
      { token: "{post.title}", label: "Tytuł wpisu" },
      { token: "{post.excerpt}", label: "Zajawka" },
      { token: "{post.slug}", label: "Slug" },
      { token: "{post.date}", label: "Data publikacji" },
      { token: "{post.updated}", label: "Data aktualizacji" },
      { token: "{post.reading}", label: "Czas czytania" },
      { token: "{post.views}", label: "Wyświetlenia" },
    ],
  },
  {
    id: "author",
    labelPl: "Autor",
    labelEn: "Author",
    tags: [
      { token: "{author.name}", label: "Imię i nazwisko" },
      { token: "{author.role}", label: "Stanowisko" },
      { token: "{author.company}", label: "Firma / redakcja" },
    ],
  },
  {
    id: "taxonomy",
    labelPl: "Taksonomia",
    labelEn: "Taxonomy",
    tags: [
      { token: "{category.name}", label: "Nazwa kategorii" },
      { token: "{tag.name}", label: "Nazwa tagu" },
      { token: "{archive.label}", label: "Etykieta archiwum" },
    ],
  },
  {
    id: "site",
    labelPl: "Kontekst",
    labelEn: "Context",
    tags: [
      { token: "{date.today}", label: "Dzisiejsza data" },
      { token: "{year}", label: "Bieżący rok" },
    ],
  },
];

export function listDynamicTags(): DynamicTagDef[] {
  return DYNAMIC_TAG_GROUPS.flatMap((g) => g.tags);
}

function fmtDate(iso: string | undefined, lang: DynamicTagLang): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function resolveToken(
  token: string,
  ctx: CurrentPostCtx | null | undefined,
  lang: DynamicTagLang,
): string | null {
  const c = ctx ?? null;
  switch (token) {
    case "post.title":
      return (lang === "en" ? c?.title_en : c?.title_pl) || c?.title_pl || c?.title_en || null;
    case "post.excerpt":
      return (
        (lang === "en" ? c?.excerpt_en : c?.excerpt_pl) || c?.excerpt_pl || c?.excerpt_en || null
      );
    case "post.slug":
      return c?.slug ?? null;
    case "post.date":
      return fmtDate(c?.publishedAt, lang) || null;
    case "post.updated":
      return fmtDate(c?.updatedAt, lang) || null;
    case "post.reading":
      return typeof c?.readingTimeMin === "number"
        ? lang === "en"
          ? `${c.readingTimeMin} min read`
          : `${c.readingTimeMin} min czytania`
        : null;
    case "post.views":
      return typeof c?.viewCount === "number" ? String(c.viewCount) : null;
    case "author.name":
      return c?.author?.name ?? null;
    case "author.role":
      return c?.author?.jobTitle ?? null;
    case "author.company":
      return c?.author?.company ?? null;
    case "category.name":
      return c?.categories?.[0]?.name ?? null;
    case "tag.name":
      return c?.tags?.[0]?.name ?? null;
    case "archive.label":
      return c?.archive?.label ?? null;
    case "date.today":
      return fmtDate(new Date().toISOString(), lang);
    case "year":
      return String(new Date().getFullYear());
    default:
      return null;
  }
}

const TOKEN_RE = /\{([a-zA-Z][a-zA-Z0-9._-]*)\}/g;

/**
 * Replace `{token}` occurrences in a single string. Unknown tokens are left
 * untouched so authors can visibly catch typos; empty resolved values fall
 * back to the raw token as well so a preview never collapses into "".
 */
export function resolveDynamicText(
  input: string | undefined | null,
  ctx: CurrentPostCtx | null | undefined,
  lang: DynamicTagLang,
): string {
  if (!input) return "";
  if (input.indexOf("{") === -1) return input;
  return input.replace(TOKEN_RE, (match, name: string) => {
    const val = resolveToken(name, ctx, lang);
    return val && val.length > 0 ? val : match;
  });
}

/** Convenience for arrays of strings (e.g. rotate words). */
export function resolveDynamicList(
  input: readonly string[] | undefined,
  ctx: CurrentPostCtx | null | undefined,
  lang: DynamicTagLang,
): string[] {
  if (!input || input.length === 0) return [];
  return input.map((s) => resolveDynamicText(s, ctx, lang));
}

/** Detect whether a string uses at least one supported dynamic token. */
export function hasDynamicTokens(input: string | undefined | null): boolean {
  if (!input) return false;
  return TOKEN_RE.test(input);
}
