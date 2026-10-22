// Ścieżki zarezerwowane przez hosting (server-only, zero zależności).
//
// Hosting Lovable wstrzykuje do KAŻDEGO dokumentu HTML skrypt `/~flock.js`
// (`data-proxy-url="/~api/analytics"`), który po załadowaniu strony wysyła
// beacony `page_hit` i Web Vitals metodą POST na `/~api/analytics`. Hosting
// tej ścieżki nie przechwytuje (pomiar 2026-10-22: 404), więc trafia ona do
// aplikacji: router nie zna `/~api/*`, catch-all renderuje pełną stronę 404
// (218 KB HTML, `ssr;dur=624`, 4 zapytania planu anon, `no-store`), a monitor
// 404 dopisuje wiersz `record_seo_404` planem service-role. Każda odsłona
// czytelnika kosztowała więc dodatkowy pełny render SSR na zimnym izolacie
// i zapis do bazy - dla analityki, która i tak niczego nie odbiera.
//
// Odpowiedź zapada w `src/server.ts` PRZED załadowaniem entry routera:
//   - POST (beacon) -> 204 bez treści: przeglądarka nie loguje błędu,
//   - każda inna metoda -> krótkie 404 text/plain,
// zawsze `no-store`, bez ciasteczek i bez HTML. Nasze własne publiczne
// endpointy żyją pod `/api/*` (bez tyldy) i tej ścieżki nie dotyczą.

/** `/~api` i wszystko pod nim - przestrzeń hostingu, nie aplikacji. */
export function isHostReservedPath(pathname: string): boolean {
  return pathname === "/~api" || pathname.startsWith("/~api/");
}

/** Odpowiedź dla ścieżki hostingu: 204 dla beaconu POST, 404 dla reszty. */
export function hostReservedResponse(request: Request): Response {
  if (request.method === "POST") {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
