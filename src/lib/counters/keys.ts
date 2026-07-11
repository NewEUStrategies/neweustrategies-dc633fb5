// Klucze React Query dla zmaterializowanych liczników (user/tenant).
// User id jest częścią klucza per-user, żeby zmiana konta nie serwowała
// cudzych badge'ów z cache (ta sama reguła co chatKeys).
export const pendingCounterKeys = {
  all: ["pending-counters"] as const,
  user: (uid: string | undefined) => ["pending-counters", "user", uid ?? "anon"] as const,
  tenant: () => ["pending-counters", "tenant"] as const,
};
