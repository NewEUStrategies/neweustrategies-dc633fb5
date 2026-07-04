// Notifications data layer - list + unread count + mutations + realtime.
// Multi-tenant: RLS in DB filters by auth.uid() AND current_tenant_id(),
// so a compromised client cannot see other tenants' rows even by guessing IDs.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
type NotificationKind = "system" | "comment" | "follow" | "subscription" | "content" | "security";

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
// bandwidth optimization.
export function useNotificationsRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    // Unique channel name per mount - reusing the same name returns the
    // already-subscribed instance (StrictMode double-mount, remounts), which
    // rejects new `.on()` callbacks with
    // "cannot add postgres_changes callbacks ... after subscribe()".
    const channelName = `notifications:${user.id}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["notifications"] });
          void qc.invalidateQueries({ queryKey: countKey(user.id) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, qc]);
}
