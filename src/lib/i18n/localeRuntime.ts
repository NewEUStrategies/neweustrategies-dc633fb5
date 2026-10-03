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
//     so hydration matches), updated synchronously by the language switcher and
//     re-derived from the URL on every client navigation (syncClientLangToUrl).
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { DEFAULT_LANG, isLocalizablePath, stripLangPrefix, type AppLang } from "./localePath";
import { readLangCookieClient, readLangCookieFromHeader } from "./langCookie";

/**
 * The one "which language does this raw (possibly prefixed) path render" rule,
 * shared by the server resolver, the client seed and client re-derivation, so
 * a soft navigation can never land on a different language than SSR of the
 * same URL. A "/<lang>" prefix wins; an unprefixed localizable path is the
 * default-language canonical; only app/system pages fall back to the stored
 * preference - read lazily, because only they need it.
 */
export function langForPath(pathname: string, preferred: () => AppLang | null): AppLang {
  const { lang } = stripLangPrefix(pathname);
  if (lang) return lang;
  if (isLocalizablePath(pathname)) return DEFAULT_LANG;
  return preferred() ?? DEFAULT_LANG;
}

function resolveClientInitial(): AppLang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  return langForPath(window.location.pathname, readLangCookieClient);
}

let clientLocale: AppLang = resolveClientInitial();
/** The address the live ref was last set for (seed, switcher or re-derivation). */
let clientLocalePath: string | null =
  typeof window === "undefined" ? null : window.location.pathname;

/**
 * Update the live client render language. The language switcher calls this
 * synchronously *before* navigating so the router's `output` rewrite prefixes
 * the new href correctly, regardless of i18next's async `changeLanguage`.
 */
export function setClientLang(lang: AppLang): void {
  clientLocale = lang;
  if (typeof window !== "undefined") clientLocalePath = window.location.pathname;
}

/**
 * Re-derive the live client language from a URL the router has just loaded.
 * The module-load seed above runs once; without this, a navigation the switcher
 * did not start (browser back/forward between "/en/x" and "/x") kept the old
 * language, so the page under a Polish canonical URL rendered English copy and
 * every freshly built href got the "/en" prefix. Called from the root
 * `beforeLoad` (via syncI18nToRequest), which - unlike the root loader - runs on
 * every client navigation.
 *
 * Only a NEW address the browser is actually showing counts:
 *   - not another URL: the root `beforeLoad` also runs for intent preloads, and
 *     a <Link> memoizes its location, so right after a switch it still points
 *     at the old language - hovering it must not switch back;
 *   - not the address the language was last set for: an explicit choice on the
 *     current address (switcher, i18next `languageChanged`) wins until the
 *     address changes. A language change that does not move the address (the
 *     consent banner's `changeLanguage`) followed by a same-address reload
 *     (`router.invalidate()`) must not be reverted by re-reading the prefix.
 * TanStack's history writes a push/replace to the address bar in a microtask,
 * AFTER the root `beforeLoad` has run, so at this point a link navigation still
 * looks like "another URL". Its language needs no change (router-built hrefs
 * already carry the live language - the `output` rewrite), but the anchor must
 * move to the new address once it is written: a stale anchor made the next
 * back/forward onto the old address skip re-derivation, so after a language
 * change that did not move the address (consent banner) and
 * one link click, "back" kept the other language under that URL. Hence the
 * re-check one microtask later (FIFO: after the history flush queued before
 * this call); a preload never reaches the address bar and stays ignored. Only
 * a raw `history.push` of an other-language URL would not switch the language
 * (the anchor then stays, so the next load of that address re-derives it);
 * the app makes none. App/system pages keep the live preference.
 *
 * No-op on the server: there this ref is module state shared by every request,
 * and the server resolver never reads it anyway.
 */
export function syncClientLangToUrl(href: string): void {
  if (typeof window === "undefined") return;
  const pathname = new URL(href, window.location.href).pathname;
  if (pathname !== window.location.pathname) {
    queueMicrotask(() => {
      if (
        window.location.pathname === pathname &&
        langForPath(pathname, () => clientLocale) === clientLocale
      ) {
        clientLocalePath = pathname;
      }
    });
    return;
  }
  if (pathname === clientLocalePath) return;
  clientLocalePath = pathname;
  clientLocale = langForPath(pathname, () => clientLocale);
}

/**
 * The language currently being rendered. Isomorphic: per-request on the server
 * (from the request URL), live ref on the client.
 */
export const currentLang = createIsomorphicFn()
  .server((): AppLang => {
    try {
      const req = getRequest();
      return langForPath(new URL(req.url).pathname, () =>
        readLangCookieFromHeader(req.headers.get("cookie")),
      );
    } catch {
      return DEFAULT_LANG;
    }
  })
  .client((): AppLang => clientLocale);
