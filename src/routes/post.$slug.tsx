// Legacy /post/<slug> URLs. Resolves the post's new canonical URL
// (parent page path + post slug) and redirects permanently (301) so crawlers
// transfer link equity to the canonical address instead of caching a 307.
// The missing-post fallbacks stay temporary (302): the post may reappear
// (trash restore, republish), so /blog must not be cached as its permanent
// destination.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";

/**
 * Rezolucja kanonicznej ścieżki wpisu dla starego formatu linku. Dwa
 * sekwencyjne round-tripy (wpis -> pełna ścieżka rodzica) biegły dotąd na
 * KAŻDE trafienie /post/<slug> - a to ruch zdominowany przez boty i stare
 * indeksy, ten sam slug w kółko. Per-isolate TTL (per tenant host) amortyzuje
 * go do jednej rezolucji na 5 minut; wynik null (wpis zniknął) też jest
 * cache'owany, żeby zdjęte wpisy nie młóciły bazy.
 */
async function resolveLegacyPostPath(slug: string): Promise<string | null> {
  return edgeTtlCache(`public:post-redirect:${slug}`, 5 * 60_000, async () => {
    const { data, error } = await supabase
      .from("posts")
      .select("slug, parent_page_id")
      .eq("slug", slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data?.parent_page_id) return null;
    const { data: pathRow } = await supabase.rpc("page_full_path", {
      _page_id: data.parent_page_id,
    });
    const path = typeof pathRow === "string" ? pathRow : null;
    if (!path) return null;
    return `${path}/${data.slug}`;
  });
}

export const Route = createFileRoute("/post/$slug")({
  loader: async ({ params }) => {
    const splat = await resolveLegacyPostPath(params.slug);
    if (!splat) throw redirect({ to: "/blog", statusCode: 302 });
    throw redirect({
      to: "/$",
      params: { _splat: splat },
      statusCode: 301,
    });
  },
  component: () => null,
});
