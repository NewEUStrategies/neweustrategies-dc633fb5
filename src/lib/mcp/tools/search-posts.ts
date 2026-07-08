import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpSupabase } from "@/lib/mcp/supabaseClient";

export default defineTool({
  name: "search_posts",
  title: "Search posts",
  description:
    "Search published posts by keyword across titles and excerpts. Returns slug, title, excerpt, publish date and cover image.",
  inputSchema: {
    query: z.string().trim().min(1).describe("Search phrase."),
    lang: z.enum(["pl", "en"]).default("pl").describe("Language variant to search."),
    limit: z.number().int().min(1).max(50).default(10).describe("Maximum posts to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, lang, limit }) => {
    const sb = await mcpSupabase();
    if (!sb) {
      return { content: [{ type: "text", text: "Backend not configured" }], isError: true };
    }
    const titleCol = lang === "en" ? "title_en" : "title_pl";
    const excerptCol = lang === "en" ? "excerpt_en" : "excerpt_pl";
    // Strip LIKE wildcards and PostgREST .or() metacharacters (comma separates
    // filters, parens group, quotes escape) so the phrase can't inject extra
    // filter conditions into the .or() below.
    const like = `%${query.replace(/[%_,()"\\]/g, "")}%`;
    const { data, error } = await sb
      .from("posts")
      .select(`id, slug, ${titleCol}, ${excerptCol}, cover_image_url, published_at`)
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .or(`${titleCol}.ilike.${like},${excerptCol}.ilike.${like}`)
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const rows = (data ?? []).map((r: Record<string, unknown>) => ({
      slug: r.slug,
      title: r[titleCol],
      excerpt: r[excerptCol],
      cover_image_url: r.cover_image_url,
      published_at: r.published_at,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { results: rows },
    };
  },
});
