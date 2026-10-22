// PRAWDZIWY ZASIĘG ŻĄDANIA TanStack Start DLA TESTÓW - następca usuniętego
// `requestHandler` z `@tanstack/react-start/server`.
//
// PO CO. Testy potoku dokumentu potrzebują realnego zasięgu żądania: loader
// woła `getRequest()` (AsyncLocalStorage zdarzenia Start), a kanały per
// `Request` (`lib/http/responseHeaders.ts`) są kluczowane dokładnie tym
// obiektem. Do Start 1.169 dawał to `requestHandler` (zdarzenie h3 + scalenie
// jego nagłówków w `toResponse()`); w 1.169 tej funkcji już nie ma, a jej rolę
// w buildzie pełni wirtualne entry `createServerEntry({ fetch:
// createStartHandler(...) })`.
//
// CO TU JEST PRAWDZIWE. `createServerEntry` z publicznego API frameworka:
// zasięg żądania (`event.request === request`, więc `getRequest()` zwraca obiekt
// podany do `fetch`), walidacja adresu (zepsute `%` -> 400) i `catch`, który
// zamienia rzut w JSON-owe 500 Start - ten sam kształt, który rozpoznaje
// normalizator w `src/server.ts`. Zwrócona odpowiedź przechodzi przez
// `handleStartError(response)`: w zasięgu żądania to dokładnie
// `finalizeResponse` - nałożenie stanu pomocników odpowiedzi (`setCookie`,
// `setResponseHeader`, `setResponseStatus`), które w buildzie robi
// `createStartHandler` na wyjściu z potoku.
//
// CZEGO TU NIE MA - ŚWIADOMIE. `Cache-Control` i `Link` tras nie żyją w stanie
// pomocników (powód: `routeCacheDirectives` w `responseHeaders.ts`), więc ta
// funkcja ich NIE nakłada. Robi to granica odpowiedzi w `src/server.ts`
// (`fetchWithFrameworkPreloads`) - test, który modeluje drut, owija wynik tej
// funkcji w `fetchWithFrameworkPreloads(handler, request)`, tak jak produkcja.
// Brakuje też uzgadniania stanu pomocników na KAŻDEJ granicy middleware
// (`reconcileResponse` w `createStartHandler`) - testy, które go potrzebują,
// muszą przejść przez prawdziwe `createStartHandler`.
//
// W fabrykach `vi.mock` importuj dynamicznie (`await import("@/test/startRequestScope")`):
// moduł sam importuje `@tanstack/react-start/server`, nie atrapowane
// `@/lib/ssr/serverEntry` (entry handlera ładowane leniwie przez src/server.ts).
import type { Register } from "@tanstack/react-router";
import { createServerEntry, handleStartError } from "@tanstack/react-start/server";
import type { RequestHandler, RequestOptions } from "@tanstack/react-start/server";

/** Render pojedynczego testu, wołany WEWNĄTRZ zasięgu żądania Start. */
export type ScopedRender = (
  request: Request,
  options?: RequestOptions<Register>,
) => Response | Promise<Response>;

/**
 * `handler.fetch` wirtualnego entry odwzorowany na publicznym API Start: zasięg
 * żądania + nałożenie stanu pomocników na zwróconą odpowiedź; rzut -> JSON-owe
 * 500 frameworka.
 */
export function startRequestScope(render: ScopedRender): RequestHandler<Register> {
  return createServerEntry<Register>({
    fetch: async (request, options) => handleStartError(await render(request, options)),
  }).fetch;
}
