// Splat redirect for legacy hierarchical tag URLs like
// `/tag/foo/bar` -> `/tag/bar`. Tag slugs are unique, so the last segment
// resolves the correct archive. Preserves ?page and ?sort search params.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/tag/$slug/$")({
  loader: ({ params }) => {
    const rest = (params as { _splat?: string })._splat ?? "";
    const segments = rest.split("/").filter(Boolean);
    const last = segments.length > 0 ? segments[segments.length - 1] : params.slug;
    throw redirect({ to: "/tag/$slug", params: { slug: last }, replace: true });
  },
});
