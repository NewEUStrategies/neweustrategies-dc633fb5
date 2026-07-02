// ONE profile round-trip for the whole header.
//
// Both the account menu (avatar + display name) and the greeting engine
// (first name -> vocative) need the signed-in user's profile row. Before this
// hook each fetched it separately (two identical round-trips racing after
// hydration, greetings even via a raw awaited chain). Sharing a single React
// Query entry - under the SAME key the profile editor already invalidates -
// collapses that to one fetch, and every consumer re-renders together.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HeaderProfile {
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export function useHeaderProfile(userId: string | null | undefined) {
  return useQuery({
    // Key kept verbatim from the previous inline query: useProfileEditor and
    // profile.account invalidate ["header-profile", user.id] after edits.
    queryKey: ["header-profile", userId ?? undefined],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async (): Promise<HeaderProfile | null> => {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, display_name, avatar_url")
        .eq("id", userId!)
        .maybeSingle<HeaderProfile>();
      return data ?? null;
    },
  });
}
