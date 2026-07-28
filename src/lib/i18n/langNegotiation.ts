// Server-side language negotiation for the bare homepage.
//
// Historically the "which language should this visitor see" decision ran in a
// client effect (LocalePreferenceRedirect) AFTER hydration: the server always
// rendered PL at "/", React hydrated PL, and only then did the browser bounce
// an EN visitor to "/en". That produced a visible text flicker and, because
// i18next could switch language mid-hydration, a React hydration mismatch.
//
// The rule now lives here, is pure, and is evaluated by a request middleware
// before any rendering happens:
//   * only the bare "/" path participates (deep links always render exactly as
//     addressed, so shared/indexed URLs stay stable),
//   * an explicit preference cookie wins,
//   * otherwise the browser's Accept-Language header decides (Polish -> pl,
//     anything else -> en) and the resolved value is persisted as the cookie,
//   * a decision equal to the default language is a no-op (no redirect), so the
//     bare homepage stays a single shareable edge-cache entry.
import { DEFAULT_LANG, localizedPath, normalizeLang, type AppLang } from "./localePath";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, readLangCookieFromHeader } from "./langCookie";

/**
 * Pick a language from a raw `Accept-Language` header. Product rule: Polish ->
 * "pl", any other stated preference -> "en", no header -> null (undecided).
 */
export function detectLangFromAcceptLanguage(header: string | null | undefined): AppLang | null {
  if (!header) return null;
  const entries = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((e) => e.tag && e.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  if (entries.length === 0) return null;
  for (const { tag } of entries) {
    if (tag === "*") continue;
    const code = tag.toLowerCase().split("-")[0];
    if (code === "pl") return "pl";
    return "en";
  }
  return null;
}

export interface HomepageLangDecision {
  /** Target language for this visitor, or null when nothing is decided. */
  lang: AppLang | null;
  /** Absolute path to redirect to, or null when the current URL already fits. */
  location: string | null;
  /** True when the decision came from Accept-Language and should be persisted. */
  persistCookie: boolean;
}

/**
 * Decide what to do with a request for the bare homepage.
 * `pathname` must already be the canonical (un-prefixed) request path.
 */
export function resolveHomepageLang(
  pathname: string,
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined,
): HomepageLangDecision {
  const none: HomepageLangDecision = { lang: null, location: null, persistCookie: false };
  if (pathname !== "/") return none;

  const stored = readLangCookieFromHeader(cookieHeader);
  if (stored) {
    return {
      lang: stored,
      location: stored === DEFAULT_LANG ? null : localizedPath("/", stored),
      persistCookie: false,
    };
  }

  const detected = detectLangFromAcceptLanguage(acceptLanguage);
  if (!detected) return none;
  return {
    lang: detected,
    location: detected === DEFAULT_LANG ? null : localizedPath("/", detected),
    persistCookie: true,
  };
}

/** Serialized `Set-Cookie` value for the language preference. */
export function langCookieHeaderValue(lang: AppLang, secure: boolean): string {
  const value = normalizeLang(lang) ?? DEFAULT_LANG;
  return `${LANG_COOKIE}=${value}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${
    secure ? "; Secure" : ""
  }`;
}
