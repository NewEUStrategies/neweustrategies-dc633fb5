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
// Wpięcie: vite.config.ts -> tanstackStart.server.entry: "server".
import "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { consumeLastCapturedError } from "./lib/error-capture";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
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

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  // clone(): body jest strumieniem, oryginał musimy zwrócić w cało¶ci jesli
  // nie rozpoznamy sygnatury h3.
  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError();
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
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
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
