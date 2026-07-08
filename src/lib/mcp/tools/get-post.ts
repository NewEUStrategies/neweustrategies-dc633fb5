import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { mcpSupabase } from "@/lib/mcp/supabaseClient";

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
    const sb = await mcpSupabase();
    if (!sb) {
      return { content: [{ type: "text", text: "Backend not configured" }], isError: true };
    }
    const t = lang === "en" ? "en" : "pl";
    // Metadata columns only - the posts body columns are revoked from anon.
    const { data: meta, error } = await sb
      .from("posts")
      .select(`id, slug, title_${t}, excerpt_${t}, cover_image_url, published_at, post_format`)
      .eq("slug", slug)
      .not("published_at", "is", null)
      .lte("published_at", new Date().toISOString())
      .maybeSingle();
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    if (!meta) {
      return { content: [{ type: "text", text: `No published post with slug "${slug}"` }] };
    }

    // Body is served only through the gated SECURITY DEFINER RPC (re-checks
    // tenant + published + access); it returns a null body for premium/gated
    // posts, which is the correct result for an anonymous MCP caller.
    const row = meta as Record<string, unknown>;
    const { data: bodyRows } = await sb.rpc("get_entity_content", {
      _entity_type: "post",
      _entity_id: row.id as string,
    });
    const body = Array.isArray(bodyRows)
      ? (bodyRows[0] as { content_pl: string | null; content_en: string | null } | undefined)
      : null;
    const content = body
      ? t === "en"
        ? (body.content_en ?? body.content_pl ?? null)
        : (body.content_pl ?? body.content_en ?? null)
      : null;

    const post = {
      slug: row.slug,
      title: row[`title_${t}`],
      excerpt: row[`excerpt_${t}`],
      cover_image_url: row.cover_image_url,
      published_at: row.published_at,
      post_format: row.post_format,
      body: content,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(post, null, 2) }],
      structuredContent: { post },
    };
  },
});
