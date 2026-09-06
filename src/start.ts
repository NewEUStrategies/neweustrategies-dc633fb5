import { createStart, createMiddleware, createCsrfMiddleware } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { gpcMiddleware } from "@/lib/consent/gpc.server";
import { isLocalizablePath, localizedPath, normalizeLang } from "@/lib/i18n/localePath";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n/langCookie";
import { langCookieHeaderValue, resolveHomepageLang } from "@/lib/i18n/langNegotiation";
import { maybeLog404, resolveRedirectForRequest } from "@/lib/seo/redirects.server";
import { documentCacheMiddleware } from "@/lib/http/documentCache.server";
import { isPreviewHost } from "@/lib/http/host";
import { tenantAssertionMiddleware } from "@/lib/http/tenantAssertionCookie.server";
import { planDefaultCacheControl } from "@/lib/http/defaultCacheControl";
import { readRouteCacheDirective } from "@/lib/http/responseHeaders";
import { runAfterResponse } from "@/lib/http/waitUntil.server";
import { renderErrorPage } from "@/lib/error-page";
import { getMiddlewareResponse, withMiddlewareResponse } from "@/lib/http/middlewareResult";

/**
 * Ostatnia linia obrony przed dispatchem routera: łapie synchronowe i
 * asynchronowe rzuty w middleware/loaderach, przepuszcza wyjątki niosące
 * `statusCode`/Response (redirecty, 401/302 rzucane celowo przez framework),
 * a resztę zamienia na przyjazną stronę 500 (bez wycieku stacka do usera;
 * pełny błąd trafia do Server Logs). Nie ingeruje w normalne odpowiedzi.
 */
/**
 * Trasy platformowe (`/platform/*` - webhooki e-mail, kolejka, preview szablonów)
 * uwierzytelniają się same (podpis webhooka / klucz API), więc muszą omijać
 * redirecty SEO i kanonizację języka - inaczej dostawca dostaje 301/302 zamiast 200.
 *
 * `/lovable/email/*` to aliasy zgodności na czas przepięcia adresów u dostawcy
 * (PR #168 przeniósł te powierzchnie na `/platform/*`) - muszą omijać dokładnie
 * to samo, inaczej stary adres oddawałby redirect zamiast przekazać żądanie.
 */
function isInternalPlatformPath(pathname: string): boolean {
  return (
    pathname.startsWith("/platform/") ||
    pathname.startsWith("/lovable/email/") ||
    pathname === "/email/unsubscribe"
  );
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Rzuty niosące własną Response/statusCode to intencjonalne short-circuity
    // (np. redirect, notFound) - nie przykrywajmy ich stroną błędu.
    if (error instanceof Response) throw error;
    if (
      error &&
      typeof error === "object" &&
      (typeof (error as { statusCode?: unknown }).statusCode === "number" ||
        typeof (error as { status?: unknown }).status === "number")
    ) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
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
  if (isInternalPlatformPath(url.pathname)) return next();
  // W panelu admina `?lang=pl|en` to stan aplikacji, nie legacy deep-link SEO:
  // lista wpisów przekazuje nim język edytorowi (validateSearch w
  // admin.posts.$slug). Kanonizacja 302 zjadała parametr przy twardym
  // przeładowaniu edytora i przypinała PUBLICZNE cookie językowe czytelnika
  // językiem panelu. Admin jest noindex/no-store, więc nie ma tu nic do
  // kanonizowania.
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) return next();
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
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const secure = proto === "https" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.pathname}${suffix}`,
      "Set-Cookie": `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${secure}`,
    },
  });
});

/**
 * Language preference for the BARE homepage, decided on the server before any
 * rendering (dawniej: efekt kliencki po hydracji -> migotanie tekstu i
 * hydration mismatch). Cookie wygrywa, w przeciwnym razie decyduje
 * Accept-Language i wynik jest utrwalany. Decyzja równa językowi domyślnemu to
 * no-op, więc "/" pozostaje jednym, współdzielonym wpisem cache. Sam redirect
 * jest `no-store` + `Vary`, żeby nigdy nie trafił do cache brzegowego.
 */
const homepageLangMiddleware = createMiddleware().server(async ({ request, next }) => {
  if (request.method !== "GET" && request.method !== "HEAD") return next();
  const url = new URL(request.url);
  if (url.pathname !== "/") return next();
  if (!(request.headers.get("accept") ?? "").includes("text/html")) return next();

  const decision = resolveHomepageLang(
    url.pathname,
    request.headers.get("cookie"),
    request.headers.get("accept-language"),
  );
  if (!decision.lang) return next();

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    url.protocol.replace(":", "");
  const headers = new Headers();
  if (decision.persistCookie) {
    headers.append("Set-Cookie", langCookieHeaderValue(decision.lang, proto === "https"));
  }

  if (!decision.location) {
    // Zostajemy na "/" - tylko utrwalamy wykrytą preferencję na kolejne wizyty.
    if (!decision.persistCookie) return next();
    const result = await next();
    const response = getMiddlewareResponse(result);
    if (!response) return result;
    const merged = new Headers(response.headers);
    for (const cookie of headers.getSetCookie()) merged.append("Set-Cookie", cookie);
    merged.append("Vary", "Accept-Language");
    return withMiddlewareResponse(
      result,
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
      }),
    );
  }

  headers.set("Location", `${decision.location}${url.search}`);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Cookie, Accept-Language");
  return new Response(null, { status: 302, headers });
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
/**
 * Hosty edytora/podglądu osadzają aplikację w iframe z innego originu.
 * `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` blokują takie
 * osadzenie (pusty podgląd), a narzędzia podglądu potrzebują też `eval`.
 * Rozluźnienie dotyczy WYŁĄCZNIE domen podglądu - produkcyjny origin
 * (neweuropeanstrategies.com) zostaje przy pełnej polityce.
 *
 * Rozpoznanie podglądu ma JEDNĄ definicję dla całej aplikacji: `isPreviewHost()`
 * z `lib/http/host.ts` (lokalny dev + domeny hostingu + `PREVIEW_HOST_SUFFIXES`
 * z env). Wcześniej siedział tu drugi, niezależny regex z wpisanymi na sztywno
 * domenami dostawcy - dwie listy allowlisty CSP, które mogły się rozjechać.
 */
function isPreviewRequest(request: Request): boolean {
  try {
    return isPreviewHost(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function contentSecurityPolicy(request?: Request): string {
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
  const preview = request ? isPreviewRequest(request) : false;
  const connectSrc = supabaseOrigins
    ? `connect-src 'self' ${supabaseOrigins}${preview ? " https: wss:" : ""}`
    : "connect-src 'self' https: wss:";
  return [
    "default-src 'self'",
    // Stripe.js MUSI pochodzić z js.stripe.com (wymóg PCI - Stripe nie
    // wspiera self-hostingu tego skryptu). Bez tego wpisu CSP blokuje
    // ładowanie SDK i checkout nie startuje.
    `script-src 'self' 'unsafe-inline' https://js.stripe.com${preview ? " 'unsafe-eval'" : ""}`,
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
    preview ? "frame-ancestors 'self' https:" : "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const securityHeadersMiddleware = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  const response = getMiddlewareResponse(result);
  if (!response) return result;
  return withMiddlewareResponse(result, applySecurityHeaders(request, response));
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
  if (isInternalPlatformPath(new URL(request.url).pathname)) return next();
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
  const result = await next();
  const response = getMiddlewareResponse(result);
  if (response) {
    // Fire-and-forget, ale pod ctx.waitUntil: na Workers praca "za odpowiedzią"
    // bez waitUntil bywa ubijana wraz z domknięciem żądania, więc log ginął.
    runAfterResponse(maybeLog404(request, response).catch(() => undefined));
  }
  return result;
});

/**
 * Domyślny Cache-Control publicznych dokumentów (polityka:
 * `lib/http/defaultCacheControl.ts`). Siedzi NAJBLIŻEJ routera - poniżej
 * documentCacheMiddleware - żeby NES Edge Cache widział już wzbogaconą
 * odpowiedź i mógł ją zapisać. Trasa, która ustawiła własny nagłówek
 * (degradacja home -> no-store, preview, personalized), zawsze wygrywa.
 *
 * Intencja trasy dociera tu DRUGIM kanałem (`readRouteCacheDirective`), nie
 * nagłówkiem odpowiedzi: `setResponseHeader` z loadera pisze na nagłówkach
 * ZDARZENIA h3, a te scalają się z odpowiedzią dopiero w `toResponse()` na
 * granicy requestHandlera - czyli ZA tym middleware I ZA
 * `documentCacheMiddleware`. Do 2026-09-01 skutkiem był pełny rozjazd:
 * czytelnik dostawał `private, no-store`, a do L1/L2 wchodziło domyślne
 * `s-maxage=900, stale-while-revalidate=86400` - pusta powłoka zamarzała na
 * brzegu na 24 h. Dowód mechanizmu i pełny opis: `responseHeaders.ts`
 * (`routeCacheDirectives`).
 */
const defaultCacheControlMiddleware = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  const response = getMiddlewareResponse(result);
  if (!response) return result;
  const defaultPolicy = planDefaultCacheControl(request, response, readRouteCacheDirective());
  if (!defaultPolicy) return result;
  // Nowa Response: nagłówki odpowiedzi routera mogą być immutable (patrz
  // applySecurityHeaders) - przebudowa daje własną, mutowalną listę nagłówków
  // bez naruszania strumieniowanego body.
  const headers = new Headers(response.headers);
  headers.set("cache-control", defaultPolicy);
  return withMiddlewareResponse(
    result,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
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
  // nosniff belongs on EVERY response (JSON APIs, beacons, assets - not only
  // HTML): it stops a browser from MIME-sniffing a response into a type the
  // server never intended, a classic exfil/execution vector on API payloads.
  headers.set("X-Content-Type-Options", "nosniff");
  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    const preview = isPreviewRequest(request);
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", contentSecurityPolicy(request));
    }
    // X-Frame-Options nie zna allowlisty - w podglądzie zdejmujemy je i
    // polegamy na frame-ancestors z CSP.
    if (preview) headers.delete("X-Frame-Options");
    else headers.set("X-Frame-Options", "SAMEORIGIN");

    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    // Permissions-Policy: deny powerful features by default and opt OUT of the
    // Topics API (browsing-topics=()) so the browser never derives/attaches
    // ad-topics for this origin - a privacy default, not just a feature gate.
    //
    // `payment` musi być delegowane do ramek operatora płatności: Embedded
    // Checkout renderuje formularz w iframe z js.stripe.com, a Link / Apple Pay
    // / Google Pay wołają Payment Request API WEWNĄTRZ tej ramki. Przy
    // `payment=(self)` przeglądarka odrzucała je z "payment is not allowed in
    // this document" i portfele znikały z checkoutu.
    headers.set(
      "Permissions-Policy",
      [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        'payment=(self "https://js.stripe.com" "https://checkout.stripe.com" "https://m.stripe.network" "https://b.stripecdn.com" "https://hooks.stripe.com" "https://pay.google.com")',
        "browsing-topics=()",
      ].join(", "),
    );
    // COOP severs window.opener from cross-origin openers (tabnabbing) and
    // closes the cross-window XS-Leak surface by isolating this document's
    // browsing-context group.
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// CSRF middleware dla wywołań serverFn: TanStack Start ostrzega, że bez
// niego endpointy RPC są narażone na cross-site requesty. Filter zawęża
// walidację do serverFn - dokumenty SSR i /api/public/* przechodzą bez
// zmian. Domyślnie akceptujemy same-origin (Sec-Fetch-Site + Origin).
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

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
  //   5. documentCacheMiddleware (NES Edge Cache) sits right above the router
  //      (behind it only the default-cache-control decorator), so redirects and
  //      language canonicalisation always run first, and a memory HIT replays
  //      only the router's own render while the outer middleware (security
  //      headers, 404 log) re-decorates every response, cached or not.
  //   6. gpcMiddleware siedzi POWYŻEJ documentCacheMiddleware: odbija
  //      `Sec-GPC` w cookie transportowym i dokłada `Vary: Sec-GPC` PO
  //      odtworzeniu wpisu z cache'a, więc `Set-Cookie` nigdy nie wchodzi do
  //      zapisanego dokumentu (patrz lib/consent/gpc.server.ts).
  //   7. tenantAssertionMiddleware - ta sama doktryna i z tego samego powodu:
  //      podaje przeglądarce poświadczenie hosta w cookie transportowym PO
  //      odtworzeniu wpisu z cache'a, więc poświadczenie jednego hosta nie ma
  //      jak wejść do dokumentu zapisanego dla innego
  //      (patrz lib/http/tenantAssertionCookie.server.ts).
  //   8. defaultCacheControlMiddleware is INNERMOST: dokłada domyślny
  //      Cache-Control publicznym dokumentom ZANIM odpowiedź wróci do
  //      documentCacheMiddleware - dzięki temu polityka zapisu NES Edge Cache
  //      (public + s-maxage) obejmuje także trasy bez własnego nagłówka.
  //
  // All DB-touching middleware wraps its work in try/catch and swallows
  // failures - the SSR document path stays deterministic even if Supabase is
  // briefly unavailable (the earlier comment about DB lookups in the SSR chain
  // still holds; that risk is why these middleware never throw upward).
  requestMiddleware: [
    // errorMiddleware NAJZEWNĘTRZNIEJ (uruchamiane pierwsze, kończone ostatnie),
    // żeby złapać rzuty z każdego kolejnego middleware i z routera. Rzuty z
    // Response/statusCode są przepuszczane - redirecty i notFound działają dalej.
    errorMiddleware,
    securityHeadersMiddleware,
    // CSRF: chroni endpointy serverFn (RPC same-origin) przed cross-site
    // wywołaniami. Zawężone do handlerType === 'serverFn' - klasyczne
    // dokumenty (SSR) i publiczne API pod /api/public/* (webhooki, cron)
    // muszą przyjmować requesty spoza origin.
    csrfMiddleware,
    seo404Middleware,
    redirectMiddleware,
    legacyLangQueryMiddleware,
    homepageLangMiddleware,
    gpcMiddleware,
    tenantAssertionMiddleware,
    documentCacheMiddleware,
    defaultCacheControlMiddleware,
  ],
  functionMiddleware: [attachSupabaseAuth],
}));
