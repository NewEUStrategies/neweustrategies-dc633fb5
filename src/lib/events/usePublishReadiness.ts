import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { READINESS_CHECK_KEYS, type ReadinessCheckKey } from "@/lib/events/publishReadiness";

// Nested below the agenda root so all agenda mutations invalidate the policy.
export const publicationReadinessKey = (eventId: string) =>
  ["event-agenda", eventId, "publication-readiness"] as const;

export function usePublishReadiness(eventId: string) {
  return useQuery({
    queryKey: publicationReadinessKey(eventId),
    queryFn: async (): Promise<ReadinessCheckKey[]> => {
      const { data, error } = await supabase.rpc("admin_event_publish_readiness", {
        p_event_id: eventId,
      });
      if (error) throw error;
      // An absent or newer, unknown response must never become a green light.
      if (!Array.isArray(data)) throw new Error("invalid_readiness_response");
      return data.map((key) => {
        const known = READINESS_CHECK_KEYS.find((candidate) => candidate === key);
        if (!known) throw new Error("invalid_readiness_response");
        return known;
      });
    },
    enabled: eventId !== "",
    staleTime: 0,
    retry: false,
  });
}
