/* Service worker platformy - wyłącznie Web Push (bez cache/offline: strategie
   cache SSR żyją na edge'u, a zasięg SW celowo minimalny, żeby nie ingerować
   w nawigacje). Payload przygotowuje trigger notifications_enqueue_push
   (title/body/href/icon/tag), wysyła tick serwera przez VAPID. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "New European Strategies";
  const options = {
    body: payload.body || undefined,
    icon: payload.icon || "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || undefined,
    renotify: false,
    data: { href: payload.href || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Reuse istniejącej karty aplikacji, jeśli jest.
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && client.url !== href) {
            return client.navigate(href).catch(() => undefined);
          }
          return undefined;
        }
      }
      return self.clients.openWindow(href);
    }),
  );
});
