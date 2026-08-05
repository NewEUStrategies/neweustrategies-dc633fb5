// Transport poświadczenia hosta do przeglądarki (SSR) - middleware.
//
// Decyzja („czy i jakie cookie wysłać") żyje w czystym module obok,
// `lib/http/tenantAssertionCookie.ts` - ten sam rozdział co
// `lib/consent/gpc.ts` / `gpc.server.ts`. Tutaj zostaje wyłącznie wpięcie
// w potok żądania.
//
// KOLEJNOŚĆ MIDDLEWARE JEST CZĘŚCIĄ ROZWIĄZANIA. `tenantAssertionMiddleware`
// MUSI siedzieć POWYŻEJ `documentCacheMiddleware` w `src/start.ts` - ta sama
// doktryna co `gpcMiddleware`. Odpowiedź wraca z wnętrza na zewnątrz, więc
// `Set-Cookie` dokleja się PO odtworzeniu wpisu z cache'a i nigdy nie wchodzi
// do zapisanego dokumentu (cudze cookie w cache'owanym dokumencie to dokładnie
// ta klasa błędu, którą ta kolejność wyklucza).
//
// Treść dokumentu nie zależy od poświadczenia, więc `Vary` NIE rośnie i NES
// Edge Cache trzyma nadal jeden wpis na ścieżkę.
import { createMiddleware } from "@tanstack/react-start";

import { getMiddlewareResponse, withMiddlewareResponse } from "@/lib/http/middlewareResult";
import {
  carriesTenantAssertionCookie,
  planTenantAssertionCookie,
} from "@/lib/http/tenantAssertionCookie";

/** Czy odpowiedź jest dokumentem HTML (jedyny nośnik, który ma sens cookiem). */
function isHtmlDocument(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/html");
}

export const tenantAssertionMiddleware = createMiddleware().server(async ({ request, next }) => {
  const result = await next();
  const response = getMiddlewareResponse(result);
  if (!response || !isHtmlDocument(response)) return result;
  if (!carriesTenantAssertionCookie(request)) return result;

  let assertion: string | null = null;
  try {
    // Hop przez *.server.ts: podpisywanie żyje w `src/lib/server/**`, którego
    // import-protection Vite nie wpuszcza do grafu klienta nawet dynamicznie.
    const mod = await import("@/lib/http/requestHost.server");
    assertion = await mod.assertionForRequest(request);
  } catch {
    // Brak klucza / brak kontekstu żądania - dokument wychodzi bez cookie,
    // a plan anon idzie szczeblem ASSERTED. Nigdy nie psujemy dokumentu.
    return result;
  }

  const cookie = planTenantAssertionCookie(request, assertion);
  if (!cookie) return result;

  // Nowa Response: nagłówki odpowiedzi routera bywają immutable (patrz
  // applySecurityHeaders), a strumieniowane body przenosimy bez zmian.
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return withMiddlewareResponse(
    result,
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
});
