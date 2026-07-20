// RSS 2.0 programu: /programs/$slug/rss.xml (+ /en/... dla wersji EN).
import { createFileRoute } from "@tanstack/react-router";
import { taxonomyFeedResponse } from "@/lib/seo/taxonomyFeed.server";

export const Route = createFileRoute("/programs/$slug/rss.xml")({
  server: {
    handlers: {
      GET: async ({ params }) => taxonomyFeedResponse("program", params.slug),
    },
  },
});
