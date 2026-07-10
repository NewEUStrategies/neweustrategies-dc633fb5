// Online presence for chat (green dot). One shared realtime presence channel
// per tenant, reference-counted at module level so the header bell, the dock
// and the messages page reuse a single socket subscription.
import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

let channel: RealtimeChannel | null = null;
let channelKey: string | null = null;
let refCount = 0;
let onlineSnapshot: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

const EMPTY: ReadonlySet<string> = new Set<string>();

function emit() {
  for (const listener of listeners) listener();
}

function syncFromChannel() {
  if (!channel) return;
  const state = channel.presenceState<{ user_id: string }>();
  const next = new Set<string>();
  for (const key of Object.keys(state)) {
    for (const meta of state[key] ?? []) {
      if (meta.user_id) next.add(meta.user_id);
    }
  }
  // Presence join/leave events fire often (tab switches, reconnects). Only
  // publish a new snapshot when membership actually changed - otherwise every
  // chat surface (all open windows, the bell, the directory) re-renders for
  // nothing.
  if (next.size === onlineSnapshot.size) {
    let same = true;
    for (const id of next) {
      if (!onlineSnapshot.has(id)) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  onlineSnapshot = next;
  emit();
}

function acquire(tenantId: string, userId: string) {
  const key = `${tenantId}:${userId}`;
  refCount += 1;
  if (channel && channelKey === key) return;
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  channelKey = key;
  channel = supabase.channel(`chat-presence:${tenantId}`, {
    config: { presence: { key: userId } },
  });
  channel
    .on("presence", { event: "sync" }, syncFromChannel)
    .on("presence", { event: "join" }, syncFromChannel)
    .on("presence", { event: "leave" }, syncFromChannel)
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && channel) {
        void channel.track({ user_id: userId, online_at: new Date().toISOString() });
      }
    });
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && channel) {
    void supabase.removeChannel(channel);
    channel = null;
    channelKey = null;
    onlineSnapshot = new Set<string>();
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ReadonlySet<string> {
  return onlineSnapshot;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

/**
 * Ids of users currently online in the caller's tenant. Subscribing mounts the
 * shared presence channel; the set is empty for signed-out visitors.
 */
export function useOnlineUsers(): ReadonlySet<string> {
  const { user, tenantId } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid || !tenantId) return;
    acquire(tenantId, uid);
    return release;
  }, [uid, tenantId]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
