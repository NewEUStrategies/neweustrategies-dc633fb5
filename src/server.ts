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
import { fetchWithFrameworkPreloads } from "./lib/http/frameworkPreloads.server";
import {
  applyDeferredDocumentStore,
  revalidationHeader,
  setDocumentRevalidator,
} from "./lib/http/documentCache.server";
import { LANG_COOKIE } from "./lib/i18n/langCookie";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

/**
 * Kontrakt bundlowanego handlera bierzemy WPROST z frameworka, zamiast
 * przepisywać go strukturalnie u siebie. `RequestHandler<Register>` to
 * `(request: Request, opts?: RequestOptions<Register>)`
 * (@tanstack/start-server-core/src/request-handler.ts:79-88), a `RequestOptions`
 * ma dokładnie cztery pola: `context` | `inlineCss` | `onEarlyHints` |
 * `responseLinkHeader` (tamże :60-68).
 *
 * Dlaczego typ frameworka, a nie własny: drugi argument nie może się już
 * rozjechać z kontraktem. Gdy ktoś zadeklaruje `server.requestContext`
 * w `Register`, `opts` przestanie być opcjonalne i `tsc` wskaże OBA wywołania
 * `handler.fetch` w tym pliku - zamiast pozwolić im dalej wołać handler bez
 * kontekstu, którego framework od tej chwili wymaga.
 */
type ServerEntry = { fetch: RequestHandler<Register> };

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
  if (request.signal.aborted) return true;
  // Transport wrappers can form cycles in `cause`; never recurse indefinitely
  // while deciding how to handle the original SSR failure.
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const err = current as { code?: string; name?: string; message?: string; cause?: unknown };
    const text = `${err.code ?? ""} ${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
    if (text.includes("econnreset") || text.includes("aborted") || text.includes("abort"))
      return true;
    current = err.cause;
  }
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

// Nitro's runtime arguments are not RequestOptions. Only our request-scoped
// collector is passed in slot 2. It merges manifest modulepreloads AFTER h3's
// header merge, before the deferred L1/L2 write, preserving font/image/locale
// hints from loaders. Inline CSS stays disabled: the split public stylesheet
// remains cacheable between routes instead of being copied into each document.

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
async function revalidateDocument(request: Request): Promise<boolean> {
  const synthetic = new Request(request.url, {
    method: "GET",
    headers: revalidationHeaders(request),
    redirect: "manual",
  });
  const handler = await getServerEntry();
  const rendered = await fetchWithFrameworkPreloads(handler.fetch, synthetic);
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
  async fetch(request: Request): Promise<Response> {
    try {
      const handler = await getServerEntry();
      const response = await fetchWithFrameworkPreloads(handler.fetch, request);
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
