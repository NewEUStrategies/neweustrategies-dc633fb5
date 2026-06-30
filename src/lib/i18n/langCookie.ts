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
  document.cookie = `${LANG_COOKIE}=${encodeURIComponent(lang)}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`;
}
