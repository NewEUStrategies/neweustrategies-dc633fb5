// Dynamic robots.txt.
// - On canonical brand hosts: allow indexing + advertise the canonical sitemap.
// - On legacy Lovable preview / worker hosts: fully disallow, so search
//   engines drop cached *.lovable.app / <uuid>.lovableproject.com URLs.
// - On unknown hosts: safe default of full disallow.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { requestPublicHost } from "@/lib/http/requestHost";

const CANONICAL_ORIGIN = "https://neweuropeanstrategies.com";
const CANONICAL_HOSTS = new Set(["neweuropeanstrategies.com", "www.neweuropeanstrategies.com"]);

function isLegacyPublicHost(host: string): boolean {
  if (!host) return false;
  return (
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host.endsWith(".pages.dev") ||
    host.endsWith(".workers.dev")
  );
}

function isEditorOrLocal(host: string): boolean {
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".lovable.dev")) return true;
  if (host.startsWith("id-preview--")) return true;
  return false;
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const host = requestPublicHost(req) ?? "";

        const body = CANONICAL_HOSTS.has(host)
          ? [
              "User-agent: *",
              "Allow: /",
              "Disallow: /admin/",
              "Disallow: /api/",
              "Disallow: /auth/",
              "",
              `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
              "",
            ].join("\n")
          : isEditorOrLocal(host) || isLegacyPublicHost(host)
            ? [
                "# Legacy / preview host - not the canonical domain.",
                "User-agent: *",
                "Disallow: /",
                "",
              ].join("\n")
            : ["User-agent: *", "Disallow: /", ""].join("\n");

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "X-Robots-Tag": CANONICAL_HOSTS.has(host) ? "all" : "noindex, nofollow",
          },
        });
      },
    },
  },
});
