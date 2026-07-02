// Single source of truth for the LANGUAGE <-> URL-PATH mapping.
//
// Pure and framework-free on purpose: the router rewrite (src/router.tsx), the
// i18n resolver (src/lib/i18n.ts), the SEO builders (src/lib/seo/*) and the
// language switcher all consume these helpers, so the prefix rule lives in one
// fully unit-testable place and can never drift between layers.
//
// Strategy - "default unprefixed, secondary prefixed":
//   - PL (default) is served at the bare path:      /, /post/foo, /blog
//   - EN (and any future language) is path-addressed: /en, /en/post/foo
//
// Because the language is now encoded in the URL the CDN keys on, every SSR
// render is shareable: an EN visitor of a PL-default site warms the edge under
// /en/* instead of forcing a cookie-personalized, no-store render. The bare
// path always renders the default language, so it stays a single cache entry
// and can never be poisoned by a per-visitor language cookie.

export type AppLang = "pl" | "en";

/** Every language the public site renders, default first. */
export const SUPPORTED_LANGS: readonly AppLang[] = ["pl", "en"];

/** The language served at the un-prefixed path. */
export const DEFAULT_LANG: AppLang = "pl";

/** Languages that carry an explicit "/<lang>" path prefix (every non-default). */
export const PREFIXED_LANGS: readonly AppLang[] = SUPPORTED_LANGS.filter((l) => l !== DEFAULT_LANG);

/** Narrowing guard for untyped values (query params, cookies, headers). */
export function isAppLang(value: unknown): value is AppLang {
  return value === "pl" || value === "en";
}

/**
 * Normalize a raw language token ("en-US", "PL", "en") to an AppLang, or null
 * when it is not a supported language. Centralized so cookie / header / query
 * parsing agree on the same rule.
 */
export function normalizeLang(value: string | null | undefined): AppLang | null {
  const code = (value ?? "").toLowerCase().split("-")[0];
  return isAppLang(code) ? code : null;
}

/** Matches a leading non-default language segment: /en, /en/, /en/rest. */
const PREFIX_RE = new RegExp(`^/(${PREFIXED_LANGS.join("|")})(?=/|$)`, "i");

// App / system surfaces that are NEVER language-prefixed. They are either
// personalized (already no-store) or non-content endpoints, so their language
// follows the user's stored preference, not the URL path. Keeping them prefix-
// free also avoids duplicate URLs for routes that must not be edge-cached.
const NON_LOCALIZED_PREFIXES: readonly string[] = [
  "/admin",
  "/api",
  "/profile",
  "/checkout",
  "/login",
  "/reading-list",
  "/newsletter",
];
// Note: /rss.xml is deliberately NOT here - the feed is language-addressed
// like content ("/rss.xml" = PL, "/en/rss.xml" = EN).
const NON_LOCALIZED_EXACT: ReadonlySet<string> = new Set([
  "/sitemap.xml",
  "/robots.txt",
  "/news-sitemap.xml",
  "/llms.txt",
]);

function ensureLeadingSlash(pathname: string): string {
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

/**
 * Whether a (canonical, un-prefixed) path participates in URL-path i18n. False
 * for admin/api/auth/system surfaces - those never receive a "/<lang>" prefix.
 */
export function isLocalizablePath(pathname: string): boolean {
  const p = ensureLeadingSlash(pathname);
  if (NON_LOCALIZED_EXACT.has(p)) return false;
  return !NON_LOCALIZED_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

/**
 * Split a raw (possibly prefixed) pathname into its language and the canonical
 * un-prefixed pathname the route tree matches.
 *
 *   "/en/post/foo" -> { lang: "en", pathname: "/post/foo" }
 *   "/en"          -> { lang: "en", pathname: "/" }
 *   "/post/foo"    -> { lang: null, pathname: "/post/foo" }
 */
export function stripLangPrefix(pathname: string): { lang: AppLang | null; pathname: string } {
  const p = ensureLeadingSlash(pathname);
  const match = PREFIX_RE.exec(p);
  if (!match) return { lang: null, pathname: p };
  const rest = p.slice(match[0].length);
  return { lang: normalizeLang(match[1]), pathname: ensureLeadingSlash(rest || "/") };
}

/**
 * Add the "/<lang>" prefix for a non-default language on a localizable path.
 * Returns the path unchanged for the default language, for non-localizable
 * surfaces, or when it is already prefixed (never double-prefixes).
 *
 *   ("/post/foo", "en") -> "/en/post/foo"
 *   ("/",         "en") -> "/en"
 *   ("/post/foo", "pl") -> "/post/foo"
 *   ("/admin",    "en") -> "/admin"
 */
export function addLangPrefix(pathname: string, lang: AppLang): string {
  const p = ensureLeadingSlash(pathname);
  if (lang === DEFAULT_LANG) return p;
  if (!isLocalizablePath(p)) return p;
  if (stripLangPrefix(p).lang) return p;
  return p === "/" ? `/${lang}` : `/${lang}${p}`;
}

/**
 * Canonical public path for a given language, regardless of the input's current
 * prefix. Idempotent, so it is safe to use both for switching languages and for
 * building the per-language SEO alternates.
 *
 *   ("/en/post/foo", "pl") -> "/post/foo"
 *   ("/post/foo",    "en") -> "/en/post/foo"
 */
export function localizedPath(pathname: string, lang: AppLang): string {
  return addLangPrefix(stripLangPrefix(pathname).pathname, lang);
}
