// ONE profile round-trip for every chrome surface that shows WHO IS SIGNED IN.
//
// Both the account menu (avatar + display name) and the greeting engine
// (first name -> vocative) need the signed-in user's profile row. Before this
// hook each fetched it separately (two identical round-trips racing after
// hydration, greetings even via a raw awaited chain). Sharing a single React
// Query entry - under the SAME key the profile editor already invalidates -
// collapses that to one fetch, and every consumer re-renders together.
//
// THE NAME SAYS "HEADER", THE USE IS WIDER - and that is deliberate, not drift.
// The event home page shows the viewer's own profile card in its left column
// (`EventViewerProfile`, mirroring screenshot 38), which needs the same row plus
// `job_title` and `current_company`. Adding a second hook for those two columns
// would re-create exactly the defect this file was written to remove: two
// identical round-trips for one row, ageing in two caches. Renaming the hook
// touches six call sites for no behavioural gain, so the name stays and this
// paragraph carries the truth.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HeaderProfile {
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  /** Stanowisko - opcjonalne w bazie, więc `null` znaczy „nie podano”. */
  job_title: string | null;
  /** Organizacja - `profiles.current_company`, napis, nie odnośnik do CRM. */
  current_company: string | null;
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
        // Literał, nie `[...].join(", ")`: PostgREST wyprowadza typ wiersza
        // z LITERAŁU selekcji. Nigdy `*` - `profiles` ma kolumnowe granty
        // i kolumny PII bez grantu.
        .select("first_name, last_name, display_name, avatar_url, job_title, current_company")
        .eq("id", userId!)
        .maybeSingle<HeaderProfile>();
      return data ?? null;
    },
  });
}
