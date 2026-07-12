// Presence per encja, cross-module: kto teraz ogląda/edytuje ten obiekt?
// Uogólnienie useEditPresence (posty/strony) na dowolny typ encji - ta sama
// przestrzeń nazw kanałów `presence:<tenant>:<typ>:<id>`, więc istniejące
// bannery postów/stron działają bez zmian. Miękka świadomość, nie CRDT.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PresenceEntityType = "post" | "page" | "crm_lead" | "conversation" | "media";

export interface EntityPresencePeer {
  userId: string;
  name: string;
  sinceIso: string;
}

interface EntityPresencePayload {
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
 * Zgłasza obecność na `entityType:entityId` i zwraca POZOSTAŁYCH obecnych
 * (bez self), od najdłużej obecnego. Pusta lista offline / w pojedynkę.
 */
export function useEntityPresence(
  entityType: PresenceEntityType,
  entityId: string | null | undefined,
): EntityPresencePeer[] {
  const { user, tenantId } = useAuth();
  const [peers, setPeers] = useState<EntityPresencePeer[]>([]);

  const userId = user?.id ?? null;
  const userName = user ? displayNameOf(user.user_metadata ?? {}, user.email ?? null) : null;

  useEffect(() => {
    if (!entityId || !tenantId || !userId || !userName) {
      setPeers([]);
      return;
    }
    // private:true - Realtime Authorization ogranicza topic do tenanta
    // wołającego (dotąd publiczny topic ujawniał nazwiska edytorów każdemu,
    // kto odgadł `presence:<tenant>:<typ>:<id>`).
    const channel = supabase.channel(`presence:${tenantId}:${entityType}:${entityId}`, {
      config: { private: true, presence: { key: userId } },
    });

    const sync = () => {
      const state = channel.presenceState<EntityPresencePayload>();
      const others: EntityPresencePeer[] = [];
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
        } satisfies EntityPresencePayload);
      }
    });

    return () => {
      setPeers([]);
      void supabase.removeChannel(channel);
    };
  }, [entityType, entityId, tenantId, userId, userName]);

  return peers;
}
