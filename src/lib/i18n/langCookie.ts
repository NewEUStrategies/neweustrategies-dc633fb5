// Language-preference cookie helpers, shared by the i18n resolver and the
// locale runtime. Since the language now lives in the URL path, this cookie is
// only a *preference* (used to render app/system pages in the user's language
// and to drive the homepage preference redirect) - it never makes a content
// render non-shareable.
import { normalizeLang, type AppLang } from "./localePath";

export const LANG_COOKIE = "lovable_lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 rok

/** Parse the language cookie out of a raw `Cookie:` header. Pure + testable. */
export function readLangCookieFromHeader(header: string | null | undefined): AppLang | null {
  if (!header) return null;
  const escaped = LANG_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = header.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? normalizeLang(decodeURIComponent(match[1])) : null;
}

/** Read the language preference from `document.cookie` (client only). */
export function readLangCookieClient(): AppLang | null {
  if (typeof document === "undefined") return null;
  const escaped = LANG_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? normalizeLang(decodeURIComponent(match[1])) : null;
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
