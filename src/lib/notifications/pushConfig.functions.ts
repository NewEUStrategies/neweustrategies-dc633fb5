// Konfiguracja Web Push dla klienta. Klucz publiczny VAPID jest z definicji
// jawny (trafia do PushManager.subscribe), ale trzymamy go w sekretach serwera
// zamiast w zmiennej build-time - dzięki temu rotacja klucza nie wymaga
// przebudowy frontendu, a serwer i klient zawsze widzą tę samą parę.
import { createServerFn } from "@tanstack/react-start";

export const getPushPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || null;
  return { publicKey: publicKey && publicKey.length > 0 ? publicKey : null };
});
