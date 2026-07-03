// Global invalidation + realtime sync for widget content references.
// Mount once near the app root; for STAFF sessions it subscribes to
// posts/pages/categories/tags changes and invalidates every cached widget
// query that may depend on them.
//
// Anonymous / regular readers deliberately get NO realtime websocket: with a
// public audience every visitor would hold an open Realtime connection with
// six postgres_changes listeners, exhausting the connection quota, and every
// content save would fan out into a refetch storm across all open tabs.
// Readers get freshness from staleTime + SSR; live invalidation is an
// editorial (staff) concern.

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { WIDGET_LIVE_QUERY_PREFIXES } from "./contentRefs";

function isWidgetQueryKey(key: QueryKey): boolean {
  const first = Array.isArray(key) ? key[0] : key;
  return typeof first === "string" && WIDGET_LIVE_QUERY_PREFIXES.has(first);
}

export function invalidateWidgetCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    predicate: (q) => isWidgetQueryKey(q.queryKey),
  });
}

/** Mount once at the app root - staff-only DB listeners + cross-tab events. */
export function WidgetLiveSync() {
  const queryClient = useQueryClient();
  const { isStaff } = useAuth();

  // The local cross-tab hint is cheap (no network) and useful for everyone -
  // e.g. a preview tab refreshing after a same-browser admin save.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLocal = () => invalidateWidgetCaches(queryClient);
    window.addEventListener("widget-cache:invalidate", onLocal);
    return () => window.removeEventListener("widget-cache:invalidate", onLocal);
  }, [queryClient]);

  useEffect(() => {
    if (!isStaff) return;
    const channel = supabase
      .channel("widget-live-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () =>
        invalidateWidgetCaches(queryClient),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "pages" }, () =>
        invalidateWidgetCaches(queryClient),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, () =>
        invalidateWidgetCaches(queryClient),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "tags" }, () =>
        invalidateWidgetCaches(queryClient),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "builder_global_widgets" },
        () => invalidateWidgetCaches(queryClient),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "builder_popups" }, () =>
        invalidateWidgetCaches(queryClient),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, isStaff]);

  return null;
}

/** Fire-and-forget local hint after a mutation; reaches every open tab via realtime too. */
export function emitWidgetCacheInvalidate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("widget-cache:invalidate"));
  }
}
