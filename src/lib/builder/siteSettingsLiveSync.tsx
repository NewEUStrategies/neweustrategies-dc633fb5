// Realtime sync for the global chrome (Header / Menu / Footer / AlertBar /
// CopyrightBar / Trending ticker / Theme tokens).
//
// All of these read from the shared `site_settings` bulk query (and a few
// also from `builder_templates`). Without realtime, editors in /admin had to
// hard-reload to see changes on the public site - and visitors saw stale
// chrome for up to `staleTime` (10 min). This component subscribes to the
// relevant tables once at the app root and invalidates the cache on every
// change, so menu / footer edits show up live across every open tab.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const LOCAL_EVENT = "site-settings:invalidate";

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: siteSettingsQueryOptions.queryKey });
  // Per-key admin queries (useSettings("header"/"footer"/...)) live under
  // ["site_settings", key] - refresh them too so the editor mirrors DB state.
  void qc.invalidateQueries({
    predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "site_settings",
  });
  // Templates can be referenced by header / footer / page builder docs.
  void qc.invalidateQueries({
    predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "builder_templates",
  });
}

/** Mount once at the app root. */
export function SiteSettingsLiveSync() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("site-settings-live-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings" },
        () => invalidate(qc),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "builder_templates" },
        () => invalidate(qc),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_design_tokens" },
        () => invalidate(qc),
      )
      .subscribe();

    const onLocal = () => invalidate(qc);
    if (typeof window !== "undefined") {
      window.addEventListener(LOCAL_EVENT, onLocal);
    }

    return () => {
      void supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener(LOCAL_EVENT, onLocal);
      }
    };
  }, [qc]);

  return null;
}

/** Optimistic local hint - fired by admin saves so the same tab refreshes instantly. */
export function emitSiteSettingsInvalidate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
  }
}
