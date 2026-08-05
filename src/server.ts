// Awaryjny wrapper SSR entry (skill: tanstack-ssr-error-handling).
//
// Rola:
//   1. Lazy import bundlowanego handlera TanStack Start - błąd inicjalizacji
//      modułu można wtedy złapać przez try/catch (zamiast wywrócić cały
//      izolat Workera przy imporcie).
//   2. Try/catch wokół fetch dla rzuconych błędów - łapie wyjątki, które
//      wyszły PRZED dispatchem routera (middleware, request setup).
//   3. Normalizacja odpowiedzi 500 zamienionej przez h3 na generyczne
//      `{"unhandled":true,"message":"HTTPError"}`: gdy złapiemy taki
//      kształt, konsumujemy ostatni globalThis-error (patrz error-capture)
//      i renderujemy przyjazną stronę zamiast surowego JSON-a.
//
//   4. Strażnik strumienia DOKUMENTU (lib/http/documentStreamGuard.server):
//      każda odpowiedź text/html ma zagwarantowane domknięcie body. Bez tego
//      wisząca serializacja seroval trzyma strumień otwarty do wewnętrznego
//      limitu frameworka (60 s) i ubija go błędem - każda strona "odpowiada"
//      po ~61 s, a monitory (Paddle) raportują serwis jako offline.
//
// Wpięcie: vite.config.ts -> tanstackStart.server.entry: "server".
import "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { consumeLastCapturedError } from "./lib/error-capture";
import { guardDocumentResponse } from "./lib/http/documentStreamGuard.server";
import { applyDeferredDocumentStore } from "./lib/http/documentCache.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Klient rozłączył się w trakcie SSR (nawigacja/refresh) - to NIE jest błąd
// aplikacji: nie logujemy i nie renderujemy strony błędu.
function isClientAbort(request: Request, error?: unknown): boolean {
  if (request.signal?.aborted) return true;
  const err = error as { code?: string; name?: string; message?: string; cause?: unknown } | undefined;
  if (!err) return false;
  const text = `${err.code ?? ""} ${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (text.includes("econnreset") || text.includes("aborted") || text.includes("abort")) return true;
  if (err.cause && err.cause !== error) return isClientAbort(request, err.cause);
  return false;
}

async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  // clone(): body jest strumieniem, oryginał musimy zwrócić w cało¶ci jesli
  // nie rozpoznamy sygnatury h3.
  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError();
  if (isClientAbort(request, captured)) {
    return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
  }

  // Raw Error (nie .message) - Server Logs potrzebują .stack.
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));

  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(request, response);
      // Odroczony zapis NES Edge Cache: tee strumienia dokumentu MUSI się
      // wydarzyć dopiero tutaj, ZA egzekutorem middleware TanStack Start -
      // tee w środku łańcucha łamie tożsamość body koperty SSR i egzekutor
      // wołał serverSsr.cleanup() w trakcie streamowania (incydent ~61 s,
      // patrz documentCache.server.ts).
      const stored = applyDeferredDocumentStore(normalized);
      // Dokumenty HTML wychodzą wyłącznie przez strażnika strumienia - body
      // ZAWSZE się kończy, niezależnie od stanu serializacji frameworka.
      return guardDocumentResponse(request, stored);
    } catch (error) {
      if (isClientAbort(request, error)) {
        return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
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
  },
};

