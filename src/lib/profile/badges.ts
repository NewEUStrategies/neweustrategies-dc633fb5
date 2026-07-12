// Odznaki profilowe (profile_badges): warstwa danych + katalog etykiet.
// Odczyt publiczny w obrębie tenantu (RLS); nadawanie/odbieranie tylko admin.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProfileBadgeKind = "verified" | "expert" | "contributor" | "staff";

export const BADGE_ORDER: ProfileBadgeKind[] = ["verified", "expert", "staff", "contributor"];

export const BADGE_LABELS: Record<ProfileBadgeKind, { pl: string; en: string }> = {
  verified: { pl: "Zweryfikowany", en: "Verified" },
  expert: { pl: "Ekspert", en: "Expert" },
  contributor: { pl: "Autor gościnny", en: "Contributor" },
  staff: { pl: "Redakcja", en: "Staff" },
};

export function badgeLabel(badge: ProfileBadgeKind, lang: string): string {
  const def = BADGE_LABELS[badge];
  return lang === "en" ? def.en : def.pl;
}

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
    const list = map.get(row.user_id) ?? [];
    list.push(row.badge as ProfileBadgeKind);
    map.set(row.user_id, list);
  }
  for (const [key, list] of map) {
    map.set(
      key,
      BADGE_ORDER.filter((b) => list.includes(b)),
    );
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
      const map = await fetchBadgesForUsers([userId!]);
      return map.get(userId!) ?? [];
    },
    staleTime: 60_000,
  });
}

/** Admin: nadaj odznakę (trigger w DB powiadamia użytkownika). */
export async function grantBadge(userId: string, badge: ProfileBadgeKind, tenantId: string) {
  const { error } = await supabase
    .from("profile_badges")
    .insert({ user_id: userId, badge, tenant_id: tenantId });
  if (error) throw error;
}

export async function revokeBadge(userId: string, badge: ProfileBadgeKind) {
  const { error } = await supabase
    .from("profile_badges")
    .delete()
    .eq("user_id", userId)
    .eq("badge", badge);
  if (error) throw error;
}
