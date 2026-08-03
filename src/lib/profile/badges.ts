// Odznaki profilowe (profile_badges): publiczna warstwa danych.
// Odczyt jest ograniczony przez RLS do aktywnego tenantu. Mutacje admina żyją
// w lib/admin/badges i przechodzą przez RPC wyprowadzające tenant z sesji.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  BADGE_ORDER,
  badgeLabel,
  isProfileBadgeKind,
  normalizeProfileBadges,
  PROFILE_BADGE_CATALOG,
  PROFILE_BADGE_KINDS,
  type ProfileBadgeKind,
} from "./badgeCatalog";

export {
  BADGE_ORDER,
  badgeLabel,
  isProfileBadgeKind,
  normalizeProfileBadges,
  PROFILE_BADGE_CATALOG,
  PROFILE_BADGE_KINDS,
  type ProfileBadgeKind,
};

/** Odznaki dla partii użytkowników (np. strona katalogu /people) jednym zapytaniem. */
export async function fetchBadgesForUsers(
  userIds: string[],
): Promise<Map<string, ProfileBadgeKind[]>> {
  const map = new Map<string, ProfileBadgeKind[]>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from("profile_badges")
    .select("user_id, badge")
    .in("user_id", userIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!isProfileBadgeKind(row.badge)) continue;
    const list = map.get(row.user_id) ?? [];
    list.push(row.badge);
    map.set(row.user_id, list);
  }
  for (const [key, list] of map) {
    map.set(key, normalizeProfileBadges(list));
  }
  return map;
}

export function useBadgesForUsers(
  userIds: string[],
): UseQueryResult<Map<string, ProfileBadgeKind[]>> {
  // Klucz stabilizowany posortowaną listą - kolejność wyników wyszukiwarki
  // nie powinna unieważniać cache.
  const key = [...userIds].sort().join(",");
  return useQuery({
    queryKey: ["profile-badges", key],
    enabled: userIds.length > 0,
    queryFn: () => fetchBadgesForUsers(userIds),
    staleTime: 60_000,
  });
}

export function useUserBadges(userId: string | undefined): UseQueryResult<ProfileBadgeKind[]> {
  return useQuery({
    queryKey: ["profile-badges", "single", userId ?? "none"],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return [];
      const map = await fetchBadgesForUsers([userId]);
      return map.get(userId) ?? [];
    },
    staleTime: 60_000,
  });
}
