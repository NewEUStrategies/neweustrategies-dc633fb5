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
 *
 * v2 (tryb offline, 20260926150000):
 *   * nawigację cachujemy WYŁĄCZNIE przy odpowiedzi `ok` - strona błędu 5xx
 *     nie może zostać powłoką na cały dzień bez sieci;
 *   * wiadomość `{type: "precache", urls}` rozgrzewa cache zasobami, które
 *     strona już pobrała, ZANIM worker ją przejął (pierwsza wizyta) - tylko
 *     z tego samego źródła i tylko powłoka oraz zasoby budowania;
 *   * odpowiedź `{type: "precache-done", cached, total}` na porcie kanału
 *     mówi stronie, czy powłoka jest gotowa do pracy bez sieci.
 */
const CACHE = "nes-scanner-v2";
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

function isPrecacheUrl(raw) {
  let url;
  try {
    url = new URL(raw, self.location.origin);
  } catch (error) {
    return false;
  }
  return (url.origin === self.location.origin && url.pathname === "/scanner") || isBuildAsset(url);
}

function precacheOne(cache, url) {
  return cache.match(url).then((hit) => {
    if (hit) return true;
    return fetch(url)
      .then((response) => {
        if (!response.ok || response.type !== "basic") return false;
        return cache.put(url, response).then(() => true);
      })
      .catch(() => false);
  });
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "precache" || !Array.isArray(data.urls)) return;
  const port = event.ports && event.ports[0];
  const urls = data.urls.filter((url) => typeof url === "string" && isPrecacheUrl(url));
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(urls.map((url) => precacheOne(cache, url))))
      .then((results) => {
        const cached = results.filter(Boolean).length;
        if (port) port.postMessage({ type: "precache-done", cached, total: urls.length });
      }),
  );
});

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
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/scanner", copy));
          }
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
