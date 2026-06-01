// Robots policy: allow public crawlers, block admin/auth/api surfaces.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        const host = req.headers.get("host") ?? "";
        const origin = host ? `${proto}://${host}` : "";
        const body = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /admin",
          "Disallow: /admin/",
          "Disallow: /login",
          "Disallow: /api/",
          "",
          origin ? `Sitemap: ${origin}/sitemap.xml` : "",
        ]
          .filter((line) => line !== undefined)
          .join("\n");
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
