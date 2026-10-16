// Wersja bieżącego deploya. Klient odpytuje ten endpoint co kilka minut
// (patrz src/lib/cacheBusting.ts) i - jeśli identyfikator się zmienił -
// wymusza odświeżenie zasobów po najbliższej nawigacji SPA. Dzięki temu
// po aktualizacji preview lub published użytkownik nie zostaje ze starym
// bundlem, który odwołuje się do usuniętych chunków (klasyczne "puste
// białe okno" po deployu).
//
// ŹRÓDŁA IDENTYFIKATORA, w tej kolejności:
//   1. `LOVABLE_BUILD_ID` w env runtime (jak dotąd - gdy platforma go poda),
//   2. stała buildu `__NES_BUILD_ID__` z `define` Vite (`vite.config.ts`
//      i `vite.smoke.config.ts`): ta sama dla wszystkich izolatów jednego
//      deployu i inna w każdym buildzie - dokładnie to, o co pyta klient,
//   3. `rt-<czas pierwszego żądania>` - raz na izolat, gdy nie ma żadnego
//      z powyższych (kod uruchomiony poza buildem Vite, np. vitest).
//
// NIGDY W ZASIĘGU MODUŁU. Dawniej fallback `rt-${Date.now()}` liczył się przy
// ładowaniu modułu, czyli w zakresie globalnym workerd, gdzie zegar stoi na 0:
// produkcja oddawała stałe `rt-0` w każdym deployu i klient nigdy nie widział
// nowej wersji (ten sam mechanizm opisuje nonce rewalidacji
// w `src/lib/http/documentCache.server.ts`). Teraz wszystko liczy się przy
// pierwszym żądaniu. `no-store` gwarantuje, że żaden pośrednik (edge/browsera)
// nie zamrozi odpowiedzi.
import { createFileRoute } from "@tanstack/react-router";

/**
 * Identyfikator buildu wstrzykiwany przez `define` Vite (ten sam blok w obu
 * presetach - parytet pilnuje `viteChunkParity.test.ts`). Poza buildem nie
 * istnieje, stąd odczyt przez `typeof`. Deklaracja w module, jak
 * w `documentCacheL2.server.ts`.
 */
declare const __NES_BUILD_ID__: string | undefined;

/** Wyliczony identyfikator izolatu; undefined = jeszcze nie było żądania. */
let buildId: string | undefined;

/** Stała buildu albo pusty napis, gdy jej nie ma. */
function bundledBuildId(): string {
  try {
    // Bramka SSR jak w `l2BuildId()`: plik trasy jest też w drzewie tras
    // klienta, a stała jest inna w każdym buildzie. Dziś kompilator tras i tak
    // wycina z klienta `server` razem z tym pomocnikiem; bramka trzyma literał
    // stałej poza chunkami klienta (i ich hashami) także wtedy, gdy ktoś
    // sięgnie po pomocnika spoza `server` - w kliencie warunek to `false`.
    if (import.meta.env.SSR && typeof __NES_BUILD_ID__ === "string") return __NES_BUILD_ID__;
  } catch {
    // Bez podstawienia `import.meta.env` bywa w runtime nieczytelne - jak brak stałej.
  }
  return "";
}

/** Identyfikator deploya: memo raz na izolat, liczony w zakresie żądania. */
function currentBuildId(): string {
  buildId ??=
    (typeof process !== "undefined" && process.env && process.env.LOVABLE_BUILD_ID) ||
    bundledBuildId() ||
    `rt-${Date.now().toString(36)}`;
  return buildId;
}

export const Route = createFileRoute("/api/public/version")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ v: currentBuildId() }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store, max-age=0",
          },
        }),
    },
  },
});
