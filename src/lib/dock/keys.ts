// Klucze zapytań przestrzeni roboczej doku. Trzymane osobno, żeby panel,
// licznik przy ikonie i unieważnianie po mutacji patrzyły na TEN SAM klucz.
export const DOCK_QUERY_ROOT = "dock" as const;

export const dockKeys = {
  notes: (userId: string | undefined) => [DOCK_QUERY_ROOT, "notes", userId ?? "anon"] as const,
  todos: (userId: string | undefined) => [DOCK_QUERY_ROOT, "todos", userId ?? "anon"] as const,
  readLater: (userId: string | undefined) =>
    [DOCK_QUERY_ROOT, "read-later", userId ?? "anon"] as const,
  saved: (userId: string | undefined) => [DOCK_QUERY_ROOT, "saved", userId ?? "anon"] as const,
  calendar: (userId: string | undefined) =>
    [DOCK_QUERY_ROOT, "calendar", userId ?? "anon"] as const,
};
