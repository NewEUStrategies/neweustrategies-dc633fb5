// Napisy „Mapy systemu" Diagnostyki - czyste funkcje nad `HUB_SYNC_MANIFEST`
// (bez komponentów: szybkie odświeżanie działa tylko dla plików eksportujących
// same komponenty, a test sprawdza je bez renderu).
import type { HubOwner } from "@/lib/revenue/syncManifest";

/**
 * Nazwa pisarza do tabeli: `ścieżka#eksport` → eksport (to nazwa, którą admin
 * znajdzie w module), plik bez eksportu → nazwa pliku, funkcja SQL → nazwa.
 */
export function writerLabel(ref: string): string {
  const hash = ref.indexOf("#");
  if (hash >= 0) return ref.slice(hash + 1);
  const slash = ref.lastIndexOf("/");
  return slash >= 0 ? ref.slice(slash + 1) : ref;
}

/**
 * Adres ekranu-właściciela z parametrami kontraktu (`?tab=…`). Parametr trasy
 * bez wartości zostaje jako `$nazwa` - mapa pokazuje wtedy SZABLON (np. reguła
 * dostępu edytuje się na stronie każdego wpisu), a nie zmyślony adres.
 */
export function ownerAddress(owner: HubOwner): string {
  const path = owner.to.replace(
    /\$([A-Za-z_]\w*)/g,
    (whole, name: string) => owner.params?.[name] ?? whole,
  );
  const query = new URLSearchParams(Object.entries(owner.search ?? {})).toString();
  return query === "" ? path : `${path}?${query}`;
}
