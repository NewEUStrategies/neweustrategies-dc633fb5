// Notifications data layer - list + unread count + mutations + realtime.
// Multi-tenant: RLS in DB filters by auth.uid() AND current_tenant_id(),
// so a compromised client cannot see other tenants' rows even by guessing IDs.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import type { Database } from "@/integrations/supabase/types";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type NotificationKind =
  | "system"
  | "comment"
  | "follow"
  | "subscription"
  | "content"
  | "security"
  | "message";

/** Who may START a new conversation with the user (existing threads live on). */
export type AllowMessagesFrom = "everyone" | "existing" | "nobody";

export interface NotificationPreferences {
  enabled_message: boolean;
  enabled_comment: boolean;
  enabled_follow: boolean;
  enabled_subscription: boolean;
  enabled_content: boolean;
  enabled_system: boolean;
  enabled_security: boolean;
  auto_mark_on_open: boolean;
  group_by_conversation: boolean;
  /**
   * Chat privacy (enforced server-side, not just in the UI):
   * - read_receipts_enabled: reciprocal - turning it off hides your read state
   *   from peers AND their read state from you (RLS on participants),
   * - typing_indicators_enabled: stop broadcasting "typing..." pings,
   * - show_online_status: stop announcing yourself on the presence channel,
   * - allow_messages_from: 'nobody' also mutes incoming sends in existing
   *   threads (DB trigger), 'existing' only blocks NEW conversations.
   */
  read_receipts_enabled: boolean;
  typing_indicators_enabled: boolean;
  show_online_status: boolean;
  allow_messages_from: AllowMessagesFrom;
  /**
   * Kanały doręczeń (poza in-app):
   * - push_enabled: web push na tym i innych urządzeniach użytkownika
   *   (subskrypcje per przeglądarka w push_subscriptions),
   * - email_digest: zbiorczy e-mail z nieprzeczytanymi powiadomieniami.
   */
  push_enabled: boolean;
  email_digest: EmailDigestFrequency;
}

export type EmailDigestFrequency = "off" | "daily" | "weekly";

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled_message: true,
  enabled_comment: true,
  enabled_follow: true,
  enabled_subscription: true,
  enabled_content: true,
  enabled_system: true,
  enabled_security: true,
  auto_mark_on_open: true,
  group_by_conversation: true,
  read_receipts_enabled: true,
  typing_indicators_enabled: true,
  show_online_status: true,
  allow_messages_from: "everyone",
  push_enabled: false,
  email_digest: "off",
};

const prefsKey = (uid: string | undefined) =>
  ["notifications", "preferences", uid ?? "anon"] as const;

const listKey = (uid: string | undefined, filter: NotificationsFilter) =>
  ["notifications", uid ?? "anon", filter] as const;
const countKey = (uid: string | undefined) =>
  ["notifications", "unread-count", uid ?? "anon"] as const;

export interface NotificationsFilter {
  onlyUnread?: boolean;
  kind?: NotificationKind | null;
  limit?: number;
}

export function useNotifications(
  filter: NotificationsFilter = {},
): UseQueryResult<NotificationRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: listKey(user?.id, filter),
    enabled: !!user,
    queryFn: async (): Promise<NotificationRow[]> => {
      let q = supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(filter.limit ?? 50);
      if (filter.onlyUnread) q = q.is("read_at", null);
      if (filter.kind) q = q.eq("kind", filter.kind);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 15_000,
  });
}

export function useUnreadCount(): UseQueryResult<number> {
  const { user } = useAuth();
  return useQuery({
    queryKey: countKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<number> => {
      // Zmaterializowany licznik (user_pending_counters, utrzymywany
      // triggerami) zamiast COUNT(*) po notifications przy każdym odświeżeniu
      // badge'a. Fallback do COUNT, gdy wiersz licznika jeszcze nie istnieje
      // (konto sprzed seedu liczników).
      const { data: counter, error: counterError } = await supabase
        .from("user_pending_counters")
        .select("value")
        .eq("counter_key", "notifications_unread")
        .maybeSingle();
      if (!counterError && counter) return counter.value;
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 15_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

/**
 * Batch-mark a list of notification ids as read. Ignores ids that already
 * had read_at. Used by group-level "mark whole conversation" quick actions.
 */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

/** Batch-mark a list of notification ids as unread. */
export function useMarkNotificationsUnread() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { data, error } = await supabase.rpc("mark_notifications_unread", { p_ids: ids });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

// Realtime subscription - scoped per user_id via a filter to avoid a fan-out
// firehose across tenants. RLS still enforces isolation; the filter is a
// bandwidth optimization. Kanał współdzielony przez tableChannelHub: dzwonek,
// centrum notyfikacji i /messages używają JEDNEJ subskrypcji websocketowej.
export function useNotificationsRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return subscribeToTable({ table: "notifications", filter: `user_id=eq.${uid}` }, () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(uid) });
    });
  }, [uid, qc]);
}

/** Toggle a single notification back to unread (RPC checks auth.uid()). */
export function useMarkNotificationUnread() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("mark_notification_unread", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: countKey(user?.id) });
    },
  });
}

/** Per-user notification preferences (upserted on first save). */
export function useNotificationPreferences(): UseQueryResult<NotificationPreferences> {
  const { user } = useAuth();
  return useQuery({
    queryKey: prefsKey(user?.id),
    enabled: !!user,
    queryFn: async (): Promise<NotificationPreferences> => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select(
          "enabled_message, enabled_comment, enabled_follow, enabled_subscription, enabled_content, enabled_system, enabled_security, auto_mark_on_open, group_by_conversation, read_receipts_enabled, typing_indicators_enabled, show_online_status, allow_messages_from, push_enabled, email_digest",
        )
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...((data ?? {}) as Partial<NotificationPreferences>),
      };
    },
    staleTime: 60_000,
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationPreferences>) => {
      if (!user) throw new Error("Not authenticated");
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!profile?.tenant_id) throw new Error("Profile tenant not found");
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          tenant_id: profile.tenant_id,
          ...patch,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: prefsKey(user?.id) });
    },
  });
}

/**
 * Subscribe to realtime changes on this user's notification_preferences row.
 * Ensures widgets (bell, center, chat) reflect toggles made in another tab or
 * from another device within the same session, without a manual refresh.
 */
export function useNotificationPreferencesRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return subscribeToTable(
      { table: "notification_preferences", filter: `user_id=eq.${uid}` },
      () => {
        void qc.invalidateQueries({ queryKey: prefsKey(uid) });
      },
    );
  }, [uid, qc]);
}
