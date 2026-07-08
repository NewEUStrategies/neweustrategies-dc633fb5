import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpSupabase } from "@/lib/mcp/supabaseClient";

export default defineTool({
  name: "list_recent_posts",
  title: "List recent posts",
  description: "List the most recently published posts.",
  inputSchema: {
    lang: z.enum(["pl", "en"]).default("pl").describe("Language variant."),
    limit: z.number().int().min(1).max(50).default(10).describe("Maximum posts to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lang, limit }) => {
    const sb = await mcpSupabase();
    if (!sb) {
      return { content: [{ type: "text", text: "Backend not configured" }], isError: true };
    }
    const t = lang === "en" ? "en" : "pl";
    const { data, error } = await sb
      .from("posts")
      .select(`slug, title_${t}, excerpt_${t}, cover_image_url, published_at`)
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { results: data ?? [] },
    };
  },
});
