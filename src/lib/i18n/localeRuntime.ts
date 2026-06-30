// Runtime resolution of "which language is this request/app currently
// rendering". This is the single value the router's `output` rewrite reads to
// decide whether to add the "/en" path prefix to an href, and the same value
// i18n and the SEO head builders resolve against - so links, canonical, hreflang
// and the rendered copy never disagree.
//
//   - Server: derived per request from the actual request URL (path prefix), so
//     it is race-free across concurrent SSR requests and a content render's
//     language is fully determined by its (cache-keyed) URL. App/system pages
//     with no prefix fall back to the preference cookie.
//   - Client: a live ref, seeded from the URL on load (mirroring the server rule
//     so hydration matches) and updated synchronously by the language switcher.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { DEFAULT_LANG, isLocalizablePath, stripLangPrefix, type AppLang } from "./localePath";
import { readLangCookieClient, readLangCookieFromHeader } from "./langCookie";

function resolveClientInitial(): AppLang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  const pathname = window.location.pathname;
  const { lang } = stripLangPrefix(pathname);
  if (lang) return lang;
  // An unprefixed localizable path is the default-language canonical; only
  // app/system pages fall back to the stored preference.
  if (isLocalizablePath(pathname)) return DEFAULT_LANG;
  return readLangCookieClient() ?? DEFAULT_LANG;
}

let clientLocale: AppLang = resolveClientInitial();

/** Live client-side render language. */
export function getClientLang(): AppLang {
  return clientLocale;
}

/**
 * Update the live client render language. The language switcher calls this
 * synchronously *before* navigating so the router's `output` rewrite prefixes
 * the new href correctly, regardless of i18next's async `changeLanguage`.
 */
export function setClientLang(lang: AppLang): void {
  clientLocale = lang;
}

/**
 * The language currently being rendered. Isomorphic: per-request on the server
 * (from the request URL), live ref on the client.
 */
export const currentLang = createIsomorphicFn()
  .server((): AppLang => {
    try {
      const req = getRequest();
      const pathname = new URL(req.url).pathname;
      const { lang } = stripLangPrefix(pathname);
      if (lang) return lang;
      if (isLocalizablePath(pathname)) return DEFAULT_LANG;
      return readLangCookieFromHeader(req.headers.get("cookie")) ?? DEFAULT_LANG;
    } catch {
      return DEFAULT_LANG;
    }
  })
  .client((): AppLang => clientLocale);
