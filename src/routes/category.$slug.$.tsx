// Splat redirect for legacy hierarchical category URLs like
// `/category/region/afryka` -> `/category/afryka`. Category slugs are globally
// unique (categories.slug), so the last segment always resolves to the correct
// archive. Preserves ?page and ?sort search params.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/category/$slug/$")({
  loader: ({ params }) => {
    const rest = (params as { _splat?: string })._splat ?? "";
    const segments = rest.split("/").filter(Boolean);
    const last = segments.length > 0 ? segments[segments.length - 1] : params.slug;
    throw redirect({ to: "/category/$slug", params: { slug: last }, replace: true });
  },
});
