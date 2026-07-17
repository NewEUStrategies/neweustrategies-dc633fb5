// Klucze React Query dla sieci kontaktów. User id jest częścią każdego klucza,
// żeby zmiana konta nie serwowała cudzej sieci z cache (reguła jak w chatKeys).
export const networkKeys = {
  all: ["network"] as const,
  statuses: (uid: string | undefined, userIds: ReadonlyArray<string>) =>
    ["network", "statuses", uid ?? "anon", [...userIds].sort().join(",")] as const,
  connections: (uid: string | undefined, query: string) =>
    ["network", "connections", uid ?? "anon", query] as const,
  requests: (uid: string | undefined, direction: "in" | "out") =>
    ["network", "requests", uid ?? "anon", direction] as const,
  counts: (uid: string | undefined) => ["network", "counts", uid ?? "anon"] as const,
  suggestions: (uid: string | undefined) => ["network", "suggestions", uid ?? "anon"] as const,
};
