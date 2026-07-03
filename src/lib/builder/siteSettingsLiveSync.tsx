// Realtime sync for the global chrome (Header / Menu / Footer / AlertBar /
// CopyrightBar / Trending ticker / Theme tokens).
//
// All of these read from the shared `site_settings` bulk query (and a few
// also from `builder_templates`). Editors need live invalidation so /admin
// edits show up without a hard reload - so the postgres_changes listeners are
// STAFF-ONLY. Anonymous readers must not each hold a Realtime websocket (three
// more listeners per visitor would exhaust the connection quota and every
// settings write would trigger a site-wide refetch storm); they get freshness
// from staleTime + the cross-tab local event below.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
  const { isStaff } = useAuth();

  // Cross-tab hint - no network cost, works for same-browser preview tabs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLocal = () => invalidate(qc);
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => window.removeEventListener(LOCAL_EVENT, onLocal);
  }, [qc]);

  useEffect(() => {
    if (!isStaff) return;
    const channel = supabase
      .channel("site-settings-live-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings" }, () =>
        invalidate(qc),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "builder_templates" }, () =>
        invalidate(qc),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "site_design_tokens" }, () =>
        invalidate(qc),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, isStaff]);

  return null;
}

/** Optimistic local hint - fired by admin saves so the same tab refreshes instantly. */
export function emitSiteSettingsInvalidate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
  }
}
