// History of site_settings changes for a given key (e.g. "theme_options").
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SiteSettingsRevision = {
  id: string;
  key: string;
  value: unknown;
  changed_by: string | null;
  changed_at: string;
  operation: string;
  note: string | null;
  author_name: string | null;
  author_avatar: string | null;
};

type ProfileRow = { id: string; display_name: string | null; avatar_url: string | null };

export function useSiteSettingsRevisions(key: string, limit = 50) {
  return useQuery({
    queryKey: ["site_settings_revisions", key, limit],
    queryFn: async (): Promise<SiteSettingsRevision[]> => {
      const { data, error } = await supabase
        .from("site_settings_revisions")
        .select("id, key, value, changed_by, changed_at, operation, note")
        .eq("key", key)
        .order("changed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = data ?? [];
      const authorIds = Array.from(
        new Set(rows.map((r) => r.changed_by).filter((v): v is string => Boolean(v))),
      );
      let authors: Record<string, ProfileRow> = {};
      if (authorIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", authorIds);
        for (const p of (profs ?? []) as ProfileRow[]) authors[p.id] = p;
      }
      return rows.map((r) => ({
        id: r.id,
        key: r.key,
        value: r.value,
        changed_by: r.changed_by,
        changed_at: r.changed_at,
        operation: r.operation,
        note: r.note,
        author_name: r.changed_by ? authors[r.changed_by]?.display_name ?? null : null,
        author_avatar: r.changed_by ? authors[r.changed_by]?.avatar_url ?? null : null,
      }));
    },
  });
}
