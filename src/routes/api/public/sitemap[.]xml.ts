// Public sitemap.xml - lists published posts and pages.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        const [{ data: posts }, { data: pages }] = await Promise.all([
          supabaseAdmin.from("posts").select("slug, updated_at, published_at").eq("status", "published").is("deleted_at", null),
          supabaseAdmin.from("pages").select("slug, updated_at, published_at").eq("status", "published").is("deleted_at", null),
        ]);

        const urls: { loc: string; lastmod?: string }[] = [
          { loc: `${origin}/` },
          { loc: `${origin}/blog` },
        ];
        for (const p of posts ?? []) {
          urls.push({ loc: `${origin}/post/${encodeURIComponent(p.slug)}`, lastmod: p.updated_at ?? p.published_at ?? undefined });
        }
        for (const p of pages ?? []) {
          urls.push({ loc: `${origin}/p/${encodeURIComponent(p.slug)}`, lastmod: p.updated_at ?? p.published_at ?? undefined });
        }

        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ""}</url>`).join("\n") +
          `\n</urlset>\n`;

        return new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=600, s-maxage=3600",
          },
        });
      },
    },
  },
});
