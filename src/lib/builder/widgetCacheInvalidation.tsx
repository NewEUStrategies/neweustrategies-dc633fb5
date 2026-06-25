// Global invalidation + realtime sync for widget content references.
// Mount once near the app root; subscribes to posts/pages/categories/tags
// changes and invalidates every cached widget query that may depend on them.

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WIDGET_LIVE_QUERY_PREFIXES } from "./contentRefs";

function isWidgetQueryKey(key: QueryKey): boolean {
  const first = Array.isArray(key) ? key[0] : key;
  return typeof first === "string" && WIDGET_LIVE_QUERY_PREFIXES.has(first);
}

export function invalidateWidgetCaches(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({
    predicate: (q) => isWidgetQueryKey(q.queryKey),
  });
}

/** Mount once at the app root - listens to DB changes + cross-tab events. */
export function WidgetLiveSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("widget-live-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts" },
        () => invalidateWidgetCaches(queryClient),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pages" },
        () => invalidateWidgetCaches(queryClient),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        () => invalidateWidgetCaches(queryClient),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tags" },
        () => invalidateWidgetCaches(queryClient),
      )
      .subscribe();

    const onLocal = () => invalidateWidgetCaches(queryClient);
    if (typeof window !== "undefined") {
      window.addEventListener("widget-cache:invalidate", onLocal);
    }

    return () => {
      void supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("widget-cache:invalidate", onLocal);
      }
    };
  }, [queryClient]);

  return null;
}

/** Fire-and-forget local hint after a mutation; reaches every open tab via realtime too. */
export function emitWidgetCacheInvalidate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("widget-cache:invalidate"));
  }
}
