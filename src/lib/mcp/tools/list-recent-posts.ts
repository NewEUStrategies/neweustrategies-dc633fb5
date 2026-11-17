import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import {
  langInput,
  limitInput,
  postSummaryOutput,
  publishedPosts,
  queryFailed,
  resolveTenantId,
  toPostSummaryJson,
} from "@/lib/mcp/posts";
import { supabaseForCaller } from "@/lib/mcp/supabase";

export default defineTool({
  name: "list_recent_posts",
  title: "List recent posts",
  description: "List the most recently published New European Strategies articles, newest first.",
  inputSchema: {
    lang: langInput,
    limit: limitInput,
  },
  outputSchema: { results: z.array(postSummaryOutput) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lang, limit }, ctx) => {
    const sb = await supabaseForCaller(ctx);
    const tenantId = await resolveTenantId(sb);
    const { data, error } = await publishedPosts(sb, tenantId)
      .order("published_at", { ascending: false })
      .limit(limit);
    if (error) throw queryFailed("list_recent_posts", error);
    const results = (data ?? []).map((row) => toPostSummaryJson(row, lang));
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      structuredContent: { results },
    };
  },
});
