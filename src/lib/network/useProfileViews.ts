// Profile Views ("Kto oglądał Twój profil") - warstwa danych na bazie RPC:
//   - record_profile_view(p_profile) - zapisuje obejrzenie z debouncingiem po
//     stronie bazy (jedno zdarzenie / godzinę / para viewer-profile).
//   - my_profile_viewers(p_limit) - lista viewerów uwzględniająca tryb
//     prywatności viewera (public/anonymous/private) - w bazie.
//   - profile_view_stats() - liczniki (7/30/90 dni).
// Tryb widoczności (profile_view_mode) trzymamy w kolumnie profiles - dostęp
// do zapisu i tak podlega RLS „tylko ja mogę zmienić swój profil".
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ProfileViewMode = "public" | "anonymous" | "private";

export interface ProfileViewer {
  viewer_id: string;
  viewer_mode: ProfileViewMode;
  display_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  viewed_at: string;
}

export interface ProfileViewStats {
  last_7: number;
  last_30: number;
  last_90: number;
}

const keys = {
  viewers: (userId: string, limit: number) =>
    ["network", "profile-viewers", userId, limit] as const,
  stats: (userId: string) => ["network", "profile-view-stats", userId] as const,
  mode: (userId: string) => ["network", "profile-view-mode", userId] as const,
};

/**
 * Rejestruje obejrzenie profilu innej osoby. Wywołuj raz w efekcie na
 * `/author/$slug` po zamontowaniu; RPC debounce'uje w bazie, więc bezpieczne
 * jest ponowne wywoływanie przy zmianie zakładek/nawigacji.
 */
export function useRecordProfileView(): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase.rpc("record_profile_view", {
        p_profile: profileId,
      });
      if (error) throw error;
    },
  });
}

/** Lista widzów bieżącego użytkownika (max `limit`). */
export function useMyProfileViewers(
  limit = 20,
): UseQueryResult<ReadonlyArray<ProfileViewer>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.viewers(user?.id ?? "none", limit),
    enabled: Boolean(user?.id),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyArray<ProfileViewer>> => {
      const { data, error } = await supabase.rpc("my_profile_viewers", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ReadonlyArray<ProfileViewer>;
    },
  });
}

/** Liczniki obejrzeń profilu (7/30/90 dni). */
export function useMyProfileViewStats(): UseQueryResult<ProfileViewStats | null> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.stats(user?.id ?? "none"),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<ProfileViewStats | null> => {
      const { data, error } = await supabase.rpc("profile_view_stats");
      if (error) throw error;
      const row = (data ?? [])[0] as ProfileViewStats | undefined;
      return row
        ? {
            last_7: Number(row.last_7 ?? 0),
            last_30: Number(row.last_30 ?? 0),
            last_90: Number(row.last_90 ?? 0),
          }
        : null;
    },
  });
}

/** Tryb widoczności bieżącego użytkownika (pobierany z profiles). */
export function useMyProfileViewMode(): UseQueryResult<ProfileViewMode> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.mode(user?.id ?? "none"),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<ProfileViewMode> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("profile_view_mode")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      const raw = (data?.profile_view_mode ?? "public") as string;
      return raw === "anonymous" || raw === "private" ? raw : "public";
    },
  });
}

/** Zmienia tryb widoczności viewer'a (public/anonymous/private). */
export function useUpdateProfileViewMode(): UseMutationResult<
  void,
  Error,
  ProfileViewMode
> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (mode: ProfileViewMode) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({ profile_view_mode: mode })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      if (user?.id) {
        void qc.invalidateQueries({ queryKey: keys.mode(user.id) });
      }
    },
  });
}
