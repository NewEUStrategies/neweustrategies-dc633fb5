// RSS 2.0 kategorii: /category/$slug/rss.xml (+ /en/... dla wersji EN).
// Cała mechanika w taxonomyFeed.server - patrz komentarz tam.
import { createFileRoute } from "@tanstack/react-router";
import { taxonomyFeedResponse } from "@/lib/seo/taxonomyFeed.server";

export const Route = createFileRoute("/category/$slug/rss.xml")({
  server: {
    handlers: {
      GET: async ({ params }) => taxonomyFeedResponse("category", params.slug),
    },
  },
});
