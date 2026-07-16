import { createStart, createMiddleware } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { isLocalizablePath, localizedPath, normalizeLang } from "@/lib/i18n/localePath";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n/langCookie";
import { maybeLog404, resolveRedirectForRequest } from "@/lib/seo/redirects.server";

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

/**
 * Baseline security headers: HSTS for every https response plus the document
 * set (CSP / X-Frame-Options / nosniff / referrer / permissions) for HTML. The
 * CSP is the defense-in-depth layer behind output escaping (see safeJsonLd):
 * even if an escape is missed somewhere, no third-party script can load,
 * nothing can frame the site, <base> cannot be hijacked and plugins are dead.
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

const securityHeadersMiddleware = createMiddleware().server(async ({ request, next }) => {
  const response = await next();
  if (!(response instanceof Response)) return response;
  return applySecurityHeaders(request, response);
});

/**
 * Redirect manager (front-half): match GET/HEAD requests against per-tenant
 * rules from `public.redirects` BEFORE the router runs. A hit short-circuits
 * with the configured 301/302/307/308/410 - preserving link equity through
 * WP migrations and letting the admin at /admin/redirects actually do
 * something. Failures are swallowed: the SSR chain must not depend on a DB
 * lookup succeeding for every document.
 */
const redirectMiddleware = createMiddleware().server(async ({ request, next }) => {
  try {
    const hit = await resolveRedirectForRequest(request);
    if (hit) {
      if (hit.status === 410) {
        return new Response("Gone", { status: 410 });
      }
      return new Response(null, {
        status: hit.status,
        headers: { Location: hit.target, "Cache-Control": "no-store" },
      });
    }
  } catch (e) {
    console.warn("[redirects] middleware error:", e);
  }
  return next();
});

/**
 * Redirect manager (back-half): once the router responded, feed 404 HTML
 * responses into the seo_404_hits monitor so /admin/redirects can surface
 * broken links and the operator can create a rule with one click. Runs
 * post-response and never awaits before returning - the log is best-effort.
 */
const seo404Middleware = createMiddleware().server(async ({ request, next }) => {
  const response = await next();
  if (response instanceof Response) {
    // Fire-and-forget: don't hold the response open on the observability write.
    void maybeLog404(request, response).catch(() => undefined);
  }
  return response;
});

/**
 * Add response headers without mutating a framework/fetch-owned Headers object.
 * Responses created by the Worker runtime (redirects and proxied fetches in
 * particular) can use the Web Platform `immutable` header guard. Calling
 * `response.headers.set()` on those responses throws after the route has
 * rendered, which h3 then hides behind its generic HTTPError 500. Rebuilding
 * the Response gives us an owned, mutable header list while preserving the
 * original streaming body, status and existing headers.
 */
export function applySecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  // HSTS pins the whole origin (RFC 6797), so it goes on EVERY https response,
  // not only HTML - the first response the browser sees is the one that counts.
  // Guarded by the actual request protocol (proxy-aware) so a plain-http dev /
  // preview server never pins localhost.
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const scheme = forwardedProto || new URL(request.url).protocol.replace(":", "");
  if (scheme === "https" && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", contentSecurityPolicy());
    }
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "SAMEORIGIN");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const startInstance = createStart(() => ({
  // Middleware order matters:
  //   1. securityHeaders wraps everything so even 301/302/410 responses carry
  //      HSTS on https.
  //   2. seo404Middleware sits above the router so it observes the final
  //      response after the redirect matcher had its chance (matched requests
  //      never reach the router, so a redirected path is not double-counted
  //      as a 404).
  //   3. redirectMiddleware short-circuits WP-legacy paths.
  //   4. legacyLangQueryMiddleware canonicalises `?lang=` before route dispatch.
  //
  // All DB-touching middleware wraps its work in try/catch and swallows
  // failures - the SSR document path stays deterministic even if Supabase is
  // briefly unavailable (the earlier comment about DB lookups in the SSR chain
  // still holds; that risk is why these middleware never throw upward).
  requestMiddleware: [
    securityHeadersMiddleware,
    seo404Middleware,
    redirectMiddleware,
    legacyLangQueryMiddleware,
  ],
  functionMiddleware: [attachSupabaseAuth],
}));
