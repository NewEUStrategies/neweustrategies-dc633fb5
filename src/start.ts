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
 * Baseline security headers for every HTML document. The CSP is the defense-
 * in-depth layer behind output escaping (see safeJsonLd): even if an escape is
 * missed somewhere, no third-party script can load, nothing can frame the
 * site, <base> cannot be hijacked and plugins are dead.
 *
 * Zakres 'unsafe-inline':
 * - script-src trzyma 'unsafe-inline' wyłącznie dla framework'owych snippetów
 *   hydratacji TanStack Start i skryptu inicjalizacji motywu (__root.tsx) -
 *   zainstalowana wersja nie wspiera nonce'ów dla własnych skryptów. JSON-LD
 *   (type="application/ld+json") to bloki danych, nie skrypty wykonywalne -
 *   script-src ich nie dotyczy.
 * - script-src-attr 'none' domyka realny wektor stored-XSS: inline handlery
 *   (onerror=, onclick=) w treści redakcyjnej są martwe niezależnie od
 *   'unsafe-inline' w script-src (React podpina zdarzenia addEventListenerem,
 *   więc 'none' niczego nie psuje).
 * - connect-src jest zawężony do 'self' + origin Supabase (https + realtime
 *   websocket) - beacons (vitals, client-errors) i Stripe (redirect, nie XHR)
 *   idą przez 'self'. Gdy origin Supabase jest nieznany w runtime (brak env
 *   na edge'u), wraca szeroki wariant - lepsza słabsza polityka niż zerwanie
 *   połączenia z bazą.
 * - Google Fonts jest na allowliście stylów/fontów dla podglądu czcionek
 *   w adminie (FontPicker wstrzykuje <link> do fonts.googleapis.com).
 */
function contentSecurityPolicy(): string {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  let supabaseOrigins = "";
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabaseOrigins = `${u.origin} wss://${u.host}`;
    }
  } catch {
    /* malformed env - omit */
  }
  const connectSrc = supabaseOrigins
    ? `connect-src 'self' ${supabaseOrigins}`
    : "connect-src 'self' https: wss:";
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    connectSrc,
    "media-src 'self' https: blob:",
    "frame-src https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const response = await next();
  if (!(response instanceof Response)) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;
  if (!response.headers.has("Content-Security-Policy")) {
    response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );
  return response;
});

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

  // Dynamic imports keep the Supabase service-role client strictly out of the
  // client bundle (module instances are cached after the first request).
  const [{ recordRedirectHit, recordSeo404, resolveRedirect }, { resolveTenantIdForHost }] =
    await Promise.all([
      import("@/lib/server/redirects.server"),
      import("@/lib/server/tenant.server"),
    ]);

  // Rules are tenant-scoped: resolve the tenant owning this host first, so a
  // rule created by one tenant's staff can never capture another tenant's
  // traffic. Unresolvable tenant (empty/unavailable directory) -> no redirect
  // handling, plain pass-through.
  let tenantId: string | null = null;
  try {
    tenantId = await resolveTenantIdForHost(request.headers.get("host"));
  } catch (e) {
    console.warn("[redirects] tenant resolution failed:", e);
  }
  if (!tenantId) return next();

  try {
    let match = await resolveRedirect(tenantId, url.pathname, url.search);
    let target = match?.target ?? "";
    if (!match) {
      const { lang, pathname } = stripLangPrefix(url.pathname);
      if (lang) {
        match = await resolveRedirect(tenantId, pathname, url.search);
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
      recordSeo404(tenantId, url.pathname, url.search, request.headers.get("referer"));
    }
  }
  return response;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    errorMiddleware,
    securityHeadersMiddleware,
    redirectMiddleware,
    legacyLangQueryMiddleware,
  ],
  functionMiddleware: [attachSupabaseAuth],
}));
