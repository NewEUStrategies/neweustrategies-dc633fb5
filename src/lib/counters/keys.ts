// Klucze React Query dla zmaterializowanych liczników (user/tenant).
// User id jest częścią klucza per-user, żeby zmiana konta nie serwowała
// cudzych badge'ów z cache (ta sama reguła co chatKeys).
export const pendingCounterKeys = {
  all: ["pending-counters"] as const,
  user: (uid: string | undefined) => ["pending-counters", "user", uid ?? "anon"] as const,
  /**
   * PREFIKS gałęzi kolejek staffu - do unieważniania niezależnie od tożsamości.
   * Mapa zdarzeń domenowych (`lib/realtime/eventInvalidationMap`) nie zna ani
   * najemcy, ani konta, a TanStack Query dopasowuje klucze PO PRZEDROSTKU,
   * więc ten klucz trafia we WSZYSTKIE instancje licznika kolejek.
   */
  tenant: () => ["pending-counters", "tenant"] as const,
  /**
   * KONKRETNA instancja licznika kolejek - klucz zapytania, nie prefiks.
   *
   * Najemca jest w kluczu, bo wiersze `tenant_pending_counters` należą do
   * przestrzeni roboczej; konto - bo o tym, CZY wiersze wrócą, decyduje rola
   * wołającego w chwili pobrania (RLS). Bez obu członów cache oddawał licznik
   * zgłoszeń poprzedniej tożsamości bez ani jednego round-tripu (staleTime
   * 15 s) - dokładnie ta reguła, którą klucz użytkownika zapisuje wyżej.
   */
  tenantScoped: (tenantId: string | null | undefined, uid: string | undefined) =>
    ["pending-counters", "tenant", tenantId ?? "none", uid ?? "anon"] as const,
};
