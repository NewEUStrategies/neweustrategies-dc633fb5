// Shared actor-profile lookup for notifications (bell + center).
// Extracts the conversation actor id from a notification href and resolves
// avatar + display name via my_connections / my_connection_requests RPCs.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { notificationActorId } from "./notificationLink";
import type { NotificationRow } from "./useNotifications";

export interface NotificationActorProfile {
  connection_id: string;
  avatar_url: string | null;
  display_name: string;
}

export function useNotificationActorProfiles(
  items: NotificationRow[],
  enabled: boolean,
): Map<string, NotificationActorProfile> {
  const actorIds = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((item) => notificationActorId(item.href))
            .filter((id): id is string => id !== null),
        ),
      ).sort(),
    [items],
  );

  const q = useQuery({
    queryKey: ["notifications", "actor-profiles", actorIds],
    enabled: enabled && actorIds.length > 0,
    queryFn: async (): Promise<NotificationActorProfile[]> => {
      const [connections, received, sent] = await Promise.all([
        supabase.rpc("my_connections", { p_limit: 100, p_offset: 0, p_query: "" }),
        supabase.rpc("my_connection_requests", { p_direction: "in", p_limit: 100, p_offset: 0 }),
        supabase.rpc("my_connection_requests", { p_direction: "out", p_limit: 100, p_offset: 0 }),
      ]);
      const error = connections.error ?? received.error ?? sent.error;
      if (error) throw error;
      const relevantIds = new Set(actorIds);
      return [...(connections.data ?? []), ...(received.data ?? []), ...(sent.data ?? [])]
        .filter((profile) => relevantIds.has(profile.connection_id))
        .map((profile) => ({
          connection_id: profile.connection_id,
          avatar_url: profile.avatar_url || null,
          display_name: profile.display_name,
        }));
    },
    staleTime: 5 * 60_000,
  });

  return useMemo(
    () => new Map((q.data ?? []).map((profile) => [profile.connection_id, profile])),
    [q.data],
  );
}
