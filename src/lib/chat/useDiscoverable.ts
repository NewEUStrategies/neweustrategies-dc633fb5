// Own-profile discoverability (opt-in for the internal people directory).
// Reads/writes profiles.discoverable for the signed-in user only (RLS-scoped).
// The i18n bundle is registered HERE (not in route files): route-level
// side-effect imports land in the eager entry graph, while this module lives
// inside the code-split page components that actually render the strings.
import "@/lib/i18n-chat";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const key = (uid: string | undefined) => ["chat", "discoverable", uid ?? "anon"] as const;

export function useDiscoverable(): UseQueryResult<boolean> {
  const { user } = useAuth();
  return useQuery({
    queryKey: key(user?.id),
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("discoverable")
        .eq("id", user?.id ?? "")
        .maybeSingle();
      if (error) throw error;
      return data?.discoverable ?? false;
    },
  });
}

export function useSetDiscoverable() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (next: boolean) => {
      if (!user) throw new Error("auth required");
      const { error } = await supabase
        .from("profiles")
        .update({ discoverable: next })
        .eq("id", user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(key(user?.id), next);
      // The directory itself may now include/exclude the caller.
      void qc.invalidateQueries({ queryKey: ["chat", "people"] });
    },
  });
}

// Zgoda eksperta na przyjmowanie "Zapytań do eksperta" (profiles.expert_requests_enabled).
// Steruje widocznością przycisku na WŁASNYM profilu (obok globalnego przełącznika
// admina). Kolumna z migracji 20260724130000 - `as never` do czasu regeneracji types.ts.
const expertRequestsKey = (uid: string | undefined) =>
  ["profile", "expert-requests-enabled", uid ?? "anon"] as const;

export function useExpertRequestsEnabled(): UseQueryResult<boolean> {
  const { user } = useAuth();
  return useQuery({
    queryKey: expertRequestsKey(user?.id),
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("expert_requests_enabled" as never)
        .eq("id", user?.id ?? "")
        .maybeSingle();
      if (error) throw error;
      // Domyślnie true (kolumna NOT NULL DEFAULT true); brak wiersza -> true.
      return (
        (data as { expert_requests_enabled?: boolean } | null)?.expert_requests_enabled ?? true
      );
    },
  });
}

export function useSetExpertRequestsEnabled() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (next: boolean) => {
      if (!user) throw new Error("auth required");
      const { error } = await supabase
        .from("profiles")
        .update({ expert_requests_enabled: next } as never)
        .eq("id", user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(expertRequestsKey(user?.id), next);
    },
  });
}
