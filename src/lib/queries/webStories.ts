// Public read-only Web Stories queries.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safeParsePages, type WebStory } from "@/lib/web-stories/types";
import type { Database } from "@/integrations/supabase/types";

type Row = Database["public"]["Tables"]["web_stories"]["Row"];

const FIELDS =
  "id,tenant_id,slug,title_pl,title_en,description_pl,description_en,cover_url,pages,status,published_at,author_id,created_at,updated_at";

function hydrate(r: Row): WebStory {
  return {
    ...r,
    status: r.status as WebStory["status"],
    pages: safeParsePages(r.pages),
  };
}

export const latestWebStoriesQueryOptions = (limit = 8) =>
  queryOptions({
    queryKey: ["web-stories", "latest", limit] as const,
    queryFn: async (): Promise<WebStory[]> => {
      const { data, error } = await supabase
        .from("web_stories")
        .select(FIELDS)
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(1, Math.min(limit, 50)));
      if (error) throw error;
      return ((data ?? []) as Row[]).map(hydrate);
    },
    staleTime: 60_000,
  });

export const webStoryBySlugQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["web-stories", "slug", slug] as const,
    queryFn: async (): Promise<WebStory | null> => {
      const { data, error } = await supabase
        .from("web_stories")
        .select(FIELDS)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      return data ? hydrate(data as Row) : null;
    },
    staleTime: 60_000,
    enabled: !!slug,
  });
