import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";

/** Zapisane wyszukiwanie: nazwa nadana przez użytkownika + zserializowane
 *  parametry URL (źródłem prawdy jest URL, params to wygodny snapshot). */
export interface SavedSearch {
  id: string;
  name: string;
  params: Record<string, unknown>;
  created_at: string;
  /** Alert: producent run_saved_search_alerts pilnuje nowych wyników. */
  alert_enabled: boolean;
  /** Kanoniczny link do wyników - href powiadomienia o nowych wynikach. */
  url: string | null;
}

/** Buduje kanoniczny URL /search z snapshotu parametrów (href alertu).
 *  Pomija wartości puste; kolejność stabilna (q pierwsze). */
export function savedSearchHref(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  const entries = Object.entries(params)
    .filter(([, v]) => typeof v === "string" && v !== "")
    .sort(([a], [b]) => (a === "q" ? -1 : b === "q" ? 1 : a.localeCompare(b)));
  for (const [k, v] of entries) qs.set(k, v as string);
  const s = qs.toString();
  return s ? `/search?${s}` : "/search";
}

export function useSavedSearches() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved-searches", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<SavedSearch[]> => {
      const { data, error } = await supabase
        .from("saved_searches")
        .select("id, name, params, created_at, alert_enabled, url")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        params: (r.params as Record<string, unknown>) ?? {},
        created_at: r.created_at as string,
        alert_enabled: (r.alert_enabled as boolean) ?? false,
        url: (r.url as string | null) ?? null,
      }));
    },
  });
}

export function useSaveSearch() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ name, params }: { name: string; params: Record<string, unknown> }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("saved_searches").insert({
        user_id: user.id,
        name: name.trim().slice(0, 120),
        params: params as Json,
        url: savedSearchHref(params),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] }),
  });
}

/** Włącza/wyłącza alert o nowych wynikach. Przy włączaniu uzupełnia też
 *  brakujący url (zapisy sprzed alertów) - href powiadomienia musi wskazywać
 *  wyniki; znak wodny stempluje trigger saved_searches_alert_defaults w DB. */
export function useToggleSavedSearchAlert() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ search, enabled }: { search: SavedSearch; enabled: boolean }) => {
      if (!user) throw new Error("Not authenticated");
      const patch: { alert_enabled: boolean; url?: string } = { alert_enabled: enabled };
      if (enabled && !search.url) patch.url = savedSearchHref(search.params);
      const { error } = await supabase.from("saved_searches").update(patch).eq("id", search.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] }),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("saved_searches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-searches", user?.id] }),
  });
}
