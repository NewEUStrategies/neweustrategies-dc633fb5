// RSS 2.0 tagu: /tag/$slug/rss.xml (+ /en/... dla wersji EN).
import { createFileRoute } from "@tanstack/react-router";
import { taxonomyFeedResponse } from "@/lib/seo/taxonomyFeed.server";

export const Route = createFileRoute("/tag/$slug/rss.xml")({
  server: {
    handlers: {
      GET: async ({ params }) => taxonomyFeedResponse("tag", params.slug),
    },
  },
});
