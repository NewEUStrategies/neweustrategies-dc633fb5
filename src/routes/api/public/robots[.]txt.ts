import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\n\nSitemap: ${origin}/api/public/sitemap.xml\n`;
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
