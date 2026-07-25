// Online presence for chat (green dot). One shared realtime presence channel
// per tenant, reference-counted at module level so the header bell, the dock
// and the messages page reuse a single socket subscription.
//
// Privacy: the channel is PRIVATE (Realtime Authorization) - RLS on
// realtime.messages limits both join and track to the caller's own tenant, so
// the per-tenant online roster can no longer be observed or spoofed from
// outside the tenant. Tracking additionally honors the user's
// show_online_status preference (client gate + join-time policy check).
import { useEffect, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNotificationPreferences } from "@/lib/notifications/useNotifications";

let channel: RealtimeChannel | null = null;
let channelKey: string | null = null;
let refCount = 0;
let onlineSnapshot: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();
// Grace period before actually tearing the channel down once refCount hits
// zero. Route/StrictMode remounts release then immediately re-acquire the
// same key; without this delay the channel is destroyed and its snapshot
// wiped to empty (a real "everyone offline" flicker), then rebuilt from
// scratch on remount before the fresh presence sync arrives (another
// flicker back to online). The delay lets a quick remount cancel the
// teardown and keep reusing the live channel/snapshot untouched.
const TEARDOWN_GRACE_MS = 2000;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

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

function acquire(tenantId: string, userId: string, trackSelf: boolean) {
  const key = `${tenantId}:${userId}:${trackSelf ? "on" : "off"}`;
  refCount += 1;
  // A pending teardown from a just-released last consumer: cancel it, the
  // channel (and its snapshot) is still valid and about to be reused.
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  if (channel && channelKey === key) return;
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
    onlineSnapshot = new Set<string>();
  }
  channelKey = key;
  channel = supabase.channel(`chat-presence:${tenantId}`, {
    config: { private: true, presence: { key: userId } },
  });
  channel
    .on("presence", { event: "sync" }, syncFromChannel)
    .on("presence", { event: "join" }, syncFromChannel)
    .on("presence", { event: "leave" }, syncFromChannel)
    .subscribe((status) => {
      // trackSelf=false: obserwujemy, ale nie ogłaszamy własnej obecności
      // (preferencja show_online_status; polityka INSERT i tak by odmówiła).
      if (status === "SUBSCRIBED" && channel && trackSelf) {
        void channel.track({ user_id: userId, online_at: new Date().toISOString() });
      }
    });
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && channel) {
    if (teardownTimer) clearTimeout(teardownTimer);
    teardownTimer = setTimeout(() => {
      teardownTimer = null;
      // A late re-acquire may have happened right before this timer fired.
      if (refCount > 0) return;
      if (channel) void supabase.removeChannel(channel);
      channel = null;
      channelKey = null;
      onlineSnapshot = new Set<string>();
      emit();
    }, TEARDOWN_GRACE_MS);
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
 * shared presence channel; the set is empty for signed-out visitors. Users who
 * turned show_online_status off observe others but are not announced
 * themselves (the flip re-joins the channel, so the join-time policy re-runs).
 */
export function useOnlineUsers(): ReadonlySet<string> {
  const { user, tenantId } = useAuth();
  const prefsQ = useNotificationPreferences();
  const uid = user?.id;
  const showOnline = prefsQ.data?.show_online_status ?? true;
  useEffect(() => {
    if (!uid || !tenantId) return;
    acquire(tenantId, uid, showOnline);
    return release;
  }, [uid, tenantId, showOnline]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
