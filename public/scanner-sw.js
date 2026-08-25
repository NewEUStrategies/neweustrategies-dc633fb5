/*
 * Service worker APLIKACJI SKANERA (/scanner).
 *
 * OSOBNY OD `push-sw.js` I W WĘŻSZYM ZASIĘGU. Tamten obsługuje Web Push dla
 * całego serwisu, rejestruje się dopiero po włączeniu powiadomień i nie ma
 * ani jednego przechwycenia `fetch`. Ten działa odwrotnie: rejestruje się od
 * razu przy wejściu na /scanner i istnieje wyłącznie po to, żeby aplikacja
 * bramkowa wstała bez sieci. Dwa workery w różnych zasięgach współistnieją -
 * o tym, który kontroluje stronę, decyduje NAJWĘŻSZY pasujący zasięg.
 *
 * CO CACHUJEMY, A CZEGO NIE. Powłokę: dokument /scanner oraz zasoby statyczne
 * budowania (skrypty, style, czcionki, ikony). NIGDY nie cachujemy wywołań do
 * bazy: odpowiedź RPC bramki opisuje stan sprzed minuty, a minuta przy wejściu
 * na kongres to sto osób. Nieaktualna odpowiedź z cache byłaby gorsza niż jej
 * brak, bo wyglądałaby na prawdziwą.
 *
 * STRATEGIE. Nawigacja: sieć najpierw, cache jako zapas (świeża wersja
 * aplikacji wygrywa zawsze, gdy sieć jest). Zasoby budowania: cache najpierw
 * (mają skrót treści w nazwie, więc nie mogą się zdezaktualizować).
 *
 * WERSJA W NAZWIE CACHE. Podbicie `CACHE` unieważnia całość przy aktywacji -
 * to jedyna droga wyjścia dla urządzenia, które stoi w hali od trzech dni.
 */
const CACHE = "nes-scanner-v1";
const SHELL = ["/scanner", "/scanner/icon-192.png", "/scanner/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // Brak sieci przy instalacji nie może zablokować rejestracji - powłoka
      // dojdzie do cache przy pierwszej udanej nawigacji.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isBuildAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_build/") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/scanner/"))
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Wszystko, co nie jest tą aplikacją, zostawiamy przeglądarce - w tym KAŻDE
  // wywołanie do bazy (inny host) i cały pozostały serwis.
  if (request.mode === "navigate") {
    if (!url.pathname.startsWith("/scanner")) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("/scanner", copy));
          return response;
        })
        .catch(() => caches.match("/scanner").then((cached) => cached || Response.error())),
    );
    return;
  }

  if (!isBuildAsset(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
