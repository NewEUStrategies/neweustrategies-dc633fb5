// Legacy /post/<slug> URLs. Resolves the post's new canonical URL
// (parent page path + post slug) and redirects with 301 semantics.
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
    if (error || !data?.parent_page_id) throw redirect({ to: "/blog" });
    const { data: pathRow } = await supabase
      .rpc("page_full_path", { _page_id: data.parent_page_id });
    const path = typeof pathRow === "string" ? pathRow : null;
    if (!path) throw redirect({ to: "/blog" });
    throw redirect({ to: "/$", params: { _splat: `${path}/${data.slug}` } });
  },
  component: () => null,
});
