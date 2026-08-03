// RSS 2.0 trackera legislacyjnego UE: /tracker/rss.xml (+ /en/... dla EN).
// Statyczny segment wygrywa z dynamicznym `/tracker/$slug`, więc "rss.xml"
// nigdy nie trafi do trasy dossier. Cała mechanika (tenant fail-closed,
// rss_enabled, język z prefiksu, cache) siedzi w `lib/tracker/feed.server.ts`.
import { createFileRoute } from "@tanstack/react-router";
import { trackerFeedResponse } from "@/lib/tracker/feed.server";

export const Route = createFileRoute("/tracker/rss.xml")({
  server: {
    handlers: {
      GET: async () => trackerFeedResponse(),
    },
  },
});
