// Legacy /post/<slug> URLs. Resolves the post's new canonical URL
// (parent page path + post slug) and redirects permanently (301) so crawlers
// transfer link equity to the canonical address instead of caching a 307.
// The missing-post fallbacks stay temporary (302): the post may reappear
// (trash restore, republish), so /blog must not be cached as its permanent
// destination.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/post/$slug")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("posts")
      .select("slug, parent_page_id")
      .eq("slug", params.slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data?.parent_page_id) throw redirect({ to: "/blog", statusCode: 302 });
    const { data: pathRow } = await supabase.rpc("page_full_path", {
      _page_id: data.parent_page_id,
    });
    const path = typeof pathRow === "string" ? pathRow : null;
    if (!path) throw redirect({ to: "/blog", statusCode: 302 });
    throw redirect({
      to: "/$",
      params: { _splat: `${path}/${data.slug}` },
      statusCode: 301,
    });
  },
  component: () => null,
});
