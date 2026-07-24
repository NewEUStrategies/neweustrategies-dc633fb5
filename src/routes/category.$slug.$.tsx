// Splat redirect for legacy hierarchical category URLs like
// `/category/region/afryka` -> `/category/afryka`. Category slugs are globally
// unique (categories.slug), so the last segment always resolves to the correct
// archive. When the splat is empty this route must defer to `/category/$slug`
// (TanStack matches empty splats), so we only redirect when there is at least
// one extra segment beyond `$slug`.
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/category/$slug/$")({
  loader: ({ params }) => {
    const rest = (params as { _splat?: string })._splat ?? "";
    const segments = rest.split("/").filter(Boolean);
    if (segments.length === 0) throw notFound();
    const last = segments[segments.length - 1];
    if (last === params.slug) throw notFound();
    throw redirect({ to: "/category/$slug", params: { slug: last }, replace: true });
  },
});
