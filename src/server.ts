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
//      po ~61 s, a monitory (np. operatora płatności) raportują serwis jako offline.
//
// Wpięcie: vite.config.ts -> tanstackStart.server.entry: "server".
import "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { consumeLastCapturedError } from "./lib/error-capture";
import { guardDocumentResponse } from "./lib/http/documentStreamGuard.server";
import {
  applyDeferredDocumentStore,
  revalidationHeader,
  setDocumentRevalidator,
} from "./lib/http/documentCache.server";
import { runAfterResponse } from "./lib/http/waitUntil.server";
import { LANG_COOKIE } from "./lib/i18n/langCookie";

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
  const err = error as
    { code?: string; name?: string; message?: string; cause?: unknown } | undefined;
  if (!err) return false;
  const text = `${err.code ?? ""} ${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (text.includes("econnreset") || text.includes("aborted") || text.includes("abort"))
    return true;
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

/**
 * Odświeżanie wpisów NES Edge Cache ZA odpowiedzią (stale-while-revalidate).
 *
 * Dlaczego tutaj, a nie w middleware: rewalidacja musi przejść PEŁNY potok
 * (router → normalizacja 500 → odroczony zapis), a `documentCache.server.ts`
 * zna tylko swoje middleware. Zwrócenie z middleware innej odpowiedzi niż ta,
 * którą zwrócił render, złamałoby tożsamość body koperty SSR i uruchomiło
 * `serverSsr.cleanup()` w trakcie streamowania - dokładnie mechanizm incydentu
 * ~61 s. Dlatego odświeżenie to OSOBNY, pełnoprawny przebieg potoku na
 * syntetycznym żądaniu: własny cykl życia renderu, tożsamość body nienaruszona.
 */

/**
 * `env` workera jest stałe w obrębie deploymentu, więc ostatnio widziane
 * wystarcza przebiegowi w tle. `ctx` NIE jest - należy do konkretnego żądania
 * i po jego domknięciu `waitUntil` rzuca. Przebieg w tle dostaje więc własny
 * kontekst, którego `waitUntil` deleguje do modułowego `runAfterResponse`
 * (`cloudflare:workers`), ważnego niezależnie od cyklu życia pojedynczego ctx.
 */
let lastEnv: unknown;

const REVALIDATION_CTX = {
  waitUntil(promise: Promise<unknown>): void {
    runAfterResponse(Promise.resolve(promise));
  },
  passThroughOnException(): void {},
};

/**
 * Nagłówki syntetycznego żądania odświeżenia. Świadomie WĄSKA lista:
 *   - `host` / `x-forwarded-host` / `x-forwarded-proto` - bez nich render
 *     trafiłby w innego tenanta (klucz cache jest prefiksowany hostem),
 *   - `accept` / `accept-language` - odtwarzają negocjację języka, żeby
 *     odświeżenie nie skończyło się redirectem zamiast dokumentem,
 *   - ciasteczko JĘZYKA (i tylko ono) - z tego samego powodu.
 * `authorization` i ciasteczka sesji `sb-*` są WYKLUCZONE z definicji:
 * dokument w cache'u jest anonimową skorupą i taki musi pozostać.
 */
function revalidationHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of [
    "host",
    "x-forwarded-host",
    "x-forwarded-proto",
    "accept",
    "accept-language",
    "user-agent",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const lang = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANG_COOKIE}=`));
  if (lang) headers.set("cookie", lang);
  const [markerName, markerValue] = revalidationHeader();
  headers.set(markerName, markerValue);
  return headers;
}

async function revalidateDocument(request: Request): Promise<boolean> {
  const synthetic = new Request(request.url, {
    method: "GET",
    headers: revalidationHeaders(request),
    redirect: "manual",
  });
  const handler = await getServerEntry();
  const rendered = await handler.fetch(synthetic, lastEnv, REVALIDATION_CTX);
  const normalized = await normalizeCatastrophicSsrResponse(synthetic, rendered);

  let storeWork: Promise<boolean> | null = null;
  const finalized = applyDeferredDocumentStore(normalized, (work) => {
    storeWork = work;
  });
  // Kolektor zapisu czyta jedną gałąź tee - druga (ta "dla klienta") musi
  // zostać skonsumowana, inaczej strumień renderu nigdy nie dojdzie do końca.
  // Strażnik strumienia jest tu zbędny: nikt na tę odpowiedź nie czeka, a
  // wiszący render zamknie się własnym budżetem albo poleci w catch wołającego.
  await finalized.arrayBuffer().catch(() => undefined);

  const pending = storeWork as Promise<boolean> | null;
  // Brak rejestracji zapisu = render nie dał dokumentu nadającego się do
  // cache'owania (redirect, 404, `no-store`). Wpis zostaje STALE i kolejne
  // żądanie spróbuje ponownie - nigdy nie nadpisujemy go czymś gorszym.
  if (!pending) return false;
  return await pending;
}

setDocumentRevalidator(revalidateDocument);

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    lastEnv = env;
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
