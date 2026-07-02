import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  addLangPrefix,
  isLocalizablePath,
  localizedPath,
  normalizeLang,
  stripLangPrefix,
} from "@/lib/i18n/localePath";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n/langCookie";
import { isProtectedPath } from "@/lib/seo/redirects";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Legacy `?lang=` deep links predate URL-path i18n. Redirect them to the
// canonical, path-prefixed URL so link equity consolidates on one URL per
// language and the destination is edge-cacheable. Localizable paths map the
// language into the path ("/post?lang=en" -> "/en/post", a permanent 301); on
// non-localizable app pages the language can only live in the preference cookie,
// so we set it and 302 to the cleaned URL.
const legacyLangQueryMiddleware = createMiddleware().server(async ({ request, next }) => {
  const url = new URL(request.url);
  const lang = normalizeLang(url.searchParams.get("lang"));
  if (!lang) return next();

  url.searchParams.delete("lang");
  const query = url.searchParams.toString();
  const suffix = `${query ? `?${query}` : ""}${url.hash}`;

  if (isLocalizablePath(url.pathname)) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${localizedPath(url.pathname, lang)}${suffix}` },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.pathname}${suffix}`,
      "Set-Cookie": `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`,
    },
  });
});

const GONE_BODY = `<!doctype html><html><head><meta charset="utf-8"><title>410 Gone</title></head><body style="font-family:system-ui;text-align:center;padding:4rem 1rem"><h1>410</h1><p>Ta treść została trwale usunięta. / This content has been permanently removed.</p><p><a href="/">New European Strategies</a></p></body></html>`;

/**
 * Redirect manager + 404 monitor. Runs before routing on every GET/HEAD:
 *   1. matches the raw path (query-aware, so WP shortlinks like "/?p=123"
 *      work), then the language-stripped path with the prefix re-applied to
 *      the target - so "/en/old-post" follows the "/old-post" rule;
 *   2. serves 301/302/307/308 with the chain pre-resolved (one visible hop)
 *      or a cacheable 410 for removed content;
 *   3. on a document 404 it records the path fire-and-forget for the admin
 *      "recent 404s" panel (the WP-migration safety net).
 * DB errors never break the site - matching degrades to a pass-through.
 */
const redirectMiddleware = createMiddleware().server(async ({ request, next }) => {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return next();
  const url = new URL(request.url);
  if (isProtectedPath(url.pathname)) return next();

  // Dynamic import keeps the Supabase service-role client strictly out of the
  // client bundle (module instance is cached after the first request).
  const { recordRedirectHit, recordSeo404, resolveRedirect } =
    await import("@/lib/server/redirects.server");

  try {
    let match = await resolveRedirect(url.pathname, url.search);
    let target = match?.target ?? "";
    if (!match) {
      const { lang, pathname } = stripLangPrefix(url.pathname);
      if (lang) {
        match = await resolveRedirect(pathname, url.search);
        if (match) {
          // Keep the visitor in their language when the target is a same-site path.
          target = /^https?:\/\//i.test(match.target)
            ? match.target
            : addLangPrefix(match.target, lang);
        }
      }
    }
    if (match) {
      recordRedirectHit(match.rule.id);
      if (match.gone) {
        return new Response(GONE_BODY, {
          status: 410,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
      const permanent = match.statusCode === 301 || match.statusCode === 308;
      return new Response(null, {
        status: match.statusCode,
        headers: {
          Location: target,
          "Cache-Control": permanent ? "public, max-age=3600" : "no-cache",
        },
      });
    }
  } catch (e) {
    console.warn("[redirects] middleware match failed:", e);
  }

  const response = await next();
  if (method === "GET" && response instanceof Response && response.status === 404) {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html")) {
      recordSeo404(url.pathname, url.search, request.headers.get("referer"));
    }
  }
  return response;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, redirectMiddleware, legacyLangQueryMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
