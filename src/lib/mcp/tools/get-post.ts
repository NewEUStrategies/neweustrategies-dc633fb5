import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export default defineTool({
  name: "get_post",
  title: "Get post by slug",
  description: "Fetch a single published post by its slug, including body content.",
  inputSchema: {
    slug: z.string().trim().min(1).describe("Post slug."),
    lang: z.enum(["pl", "en"]).default("pl").describe("Language variant."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slug, lang }) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      return { content: [{ type: "text", text: "Backend not configured" }], isError: true };
    }
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const t = lang === "en" ? "en" : "pl";
    const { data, error } = await sb
      .from("posts")
      .select(
        `id, slug, title_${t}, excerpt_${t}, body_${t}, cover_image_url, published_at, post_format`,
      )
      .eq("slug", slug)
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!data) {
      return { content: [{ type: "text", text: `No published post with slug "${slug}"` }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { post: data },
    };
  },
});
