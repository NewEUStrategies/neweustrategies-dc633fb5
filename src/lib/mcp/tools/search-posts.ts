import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import {
  MCP_MAX_QUERY_LENGTH,
  langInput,
  limitInput,
  postSummaryOutput,
  publishedPosts,
  queryFailed,
  resolveTenantId,
  toIlikePattern,
  toPostSummaryJson,
} from "@/lib/mcp/posts";
import { supabaseForCaller } from "@/lib/mcp/supabase";

export default defineTool({
  name: "search_posts",
  title: "Search posts",
  description:
    "Search published New European Strategies articles by keyword in titles and excerpts of the chosen language. Returns slug, title, excerpt, publish date, format and cover image.",
  inputSchema: {
    query: z.string().trim().min(1).max(MCP_MAX_QUERY_LENGTH).describe("Search phrase."),
    lang: langInput,
    limit: limitInput,
  },
  outputSchema: { results: z.array(postSummaryOutput) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, lang, limit }, ctx) => {
    const pattern = toIlikePattern(query);
    // Fraza z samych metaznaków nie jest wyszukiwaniem - pusty wynik zamiast
    // `%%`, które dopasowałoby każdy wpis.
    if (!pattern) {
      return {
        content: [{ type: "text", text: "[]" }],
        structuredContent: { results: [] },
      };
    }
    const sb = await supabaseForCaller(ctx);
    const tenantId = await resolveTenantId(sb);
    const filter =
      lang === "en"
        ? `title_en.ilike.${pattern},excerpt_en.ilike.${pattern}`
        : `title_pl.ilike.${pattern},excerpt_pl.ilike.${pattern}`;
    const { data, error } = await publishedPosts(sb, tenantId)
      .or(filter)
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) throw queryFailed("search_posts", error);
    const results = (data ?? []).map((row) => toPostSummaryJson(row, lang));
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      structuredContent: { results },
    };
  },
});
