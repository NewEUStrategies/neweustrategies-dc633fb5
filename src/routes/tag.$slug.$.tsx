// Splat redirect for legacy hierarchical tag URLs like `/tag/foo/bar`
// -> `/tag/bar`. Tag slugs are unique, so the last segment resolves the
// correct archive. Empty splats defer to `/tag/$slug`.
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tag/$slug/$")({
  loader: ({ params }) => {
    const rest = (params as { _splat?: string })._splat ?? "";
    const segments = rest.split("/").filter(Boolean);
    if (segments.length === 0) throw notFound();
    const last = segments[segments.length - 1];
    if (last === params.slug) throw notFound();
    throw redirect({ to: "/tag/$slug", params: { slug: last }, replace: true });
  },
});
