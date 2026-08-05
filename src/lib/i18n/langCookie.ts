// Language-preference cookie helpers, shared by the i18n resolver and the
// locale runtime. Since the language now lives in the URL path, this cookie is
// only a *preference* (used to render app/system pages in the user's language
// and to drive the homepage preference redirect) - it never makes a content
// render non-shareable.
import { normalizeLang, type AppLang } from "./localePath";

export const LANG_COOKIE = "nes_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 rok

/**
 * Poprzednia nazwa cookie preferencji języka. Czytamy ją nadal, bo cookie żyje
 * rok: bez odczytu zapasowego każdy wracający czytelnik straciłby wybrany język
 * i dostałby przekierowanie na wersję z Accept-Language. Zapis idzie WYŁĄCZNIE
 * pod nową nazwą, więc stara wygasa sama.
 */
const LEGACY_LANG_COOKIES = ["lovable_lang"] as const;

function cookiePattern(name: string, separator: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|${separator})${escaped}=([^;]*)`);
}

function readLangFrom(source: string, separator: string): AppLang | null {
  for (const name of [LANG_COOKIE, ...LEGACY_LANG_COOKIES]) {
    const match = source.match(cookiePattern(name, separator));
    const lang = match ? normalizeLang(decodeURIComponent(match[1])) : null;
    if (lang) return lang;
  }
  return null;
}

/** Parse the language cookie out of a raw `Cookie:` header. Pure + testable. */
export function readLangCookieFromHeader(header: string | null | undefined): AppLang | null {
  if (!header) return null;
  return readLangFrom(header, ";\\s*");
}

/** Read the language preference from `document.cookie` (client only). */
export function readLangCookieClient(): AppLang | null {
  if (typeof document === "undefined") return null;
  return readLangFrom(document.cookie, "; ");
}

/** Persist the language preference to `document.cookie` (client only). */
export function writeLangCookieClient(lang: AppLang): void {
  if (typeof document === "undefined") return;
  // Mark Secure on https so the cookie is never sent over a plaintext downgrade.
  // (It is a non-sensitive preference and is written from JS, so HttpOnly is not
  // possible - Secure is the applicable hardening.)
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LANG_COOKIE}=${encodeURIComponent(lang)}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * Detect the visitor's preferred language from the browser (client only).
 * Rule per product spec: Polish -> "pl", anything else -> "en".
 * Returns null when navigator is unavailable (SSR).
 */
export function detectBrowserLang(): AppLang | null {
  if (typeof navigator === "undefined") return null;
  const candidates: string[] = [];
  const langs = (navigator as Navigator & { languages?: readonly string[] }).languages;
  if (langs && langs.length > 0) candidates.push(...langs);
  if (navigator.language) candidates.push(navigator.language);
  for (const raw of candidates) {
    const code = (raw ?? "").toLowerCase().split("-")[0];
    if (code === "pl") return "pl";
  }
  // Any non-Polish browser preference -> English.
  return candidates.length > 0 ? "en" : null;
}

/**
 * Resolve the initial language preference for a fresh visitor: prefer an
 * explicit cookie, otherwise auto-detect from the browser. Persists the
 * detected value so subsequent visits are stable and the SSR homepage redirect
 * can honor it.
 */
export function resolveOrPersistPreferredLang(): AppLang | null {
  const stored = readLangCookieClient();
  if (stored) return stored;
  const detected = detectBrowserLang();
  if (detected) writeLangCookieClient(detected);
  return detected;
}
