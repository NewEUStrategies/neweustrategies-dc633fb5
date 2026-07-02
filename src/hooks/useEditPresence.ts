// Realtime edit presence: who else is editing this entity right now?
// Built on Supabase Realtime presence channels (same transport the live blog
// uses) - a soft awareness layer that prevents two editors from silently
// overwriting each other. SSR-safe: subscribes only in useEffect.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PresencePeer {
  userId: string;
  name: string;
  sinceIso: string;
}

interface PresencePayload {
  user_id: string;
  name: string;
  since: string;
}

function displayNameOf(meta: Record<string, unknown>, email: string | null): string {
  const candidates = [meta.display_name, meta.full_name, meta.first_name, email];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "?";
}

/**
 * Track presence on `entityType:entityId` and return the OTHER editors
 * (self excluded), oldest first. Empty array while disconnected or alone.
 */
export function useEditPresence(
  entityType: "post" | "page",
  entityId: string | null | undefined,
): PresencePeer[] {
  const { user, tenantId } = useAuth();
  const [peers, setPeers] = useState<PresencePeer[]>([]);

  const userId = user?.id ?? null;
  const userName = user ? displayNameOf(user.user_metadata ?? {}, user.email ?? null) : null;

  useEffect(() => {
    if (!entityId || !tenantId || !userId || !userName) {
      setPeers([]);
      return;
    }
    const channel = supabase.channel(`presence:${tenantId}:${entityType}:${entityId}`, {
      config: { presence: { key: userId } },
    });

    const sync = () => {
      const state = channel.presenceState<PresencePayload>();
      const others: PresencePeer[] = [];
      for (const [key, metas] of Object.entries(state)) {
        if (key === userId || !metas.length) continue;
        const meta = metas[0];
        others.push({
          userId: meta.user_id ?? key,
          name: meta.name || "?",
          sinceIso: meta.since ?? new Date().toISOString(),
        });
      }
      others.sort((a, b) => a.sinceIso.localeCompare(b.sinceIso));
      setPeers(others);
    };

    channel.on("presence", { event: "sync" }, sync).subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.track({
          user_id: userId,
          name: userName,
          since: new Date().toISOString(),
        } satisfies PresencePayload);
      }
    });

    return () => {
      setPeers([]);
      void supabase.removeChannel(channel);
    };
  }, [entityType, entityId, tenantId, userId, userName]);

  return peers;
}
