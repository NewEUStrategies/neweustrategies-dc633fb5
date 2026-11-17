import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import {
  langInput,
  pickLocalized,
  postSummaryOutput,
  publishedPosts,
  queryFailed,
  resolveTenantId,
  toPostSummaryJson,
} from "@/lib/mcp/posts";
import { supabaseForCaller } from "@/lib/mcp/supabase";

/** Górna granica sluga - dłuższy nie istnieje w bazie, a limit chroni zapytanie. */
const SLUG_MAX_LENGTH = 200;

export default defineTool({
  name: "get_post",
  title: "Get post by slug",
  description:
    "Fetch one published New European Strategies article by its slug, including the full body when the signed-in account has access to it.",
  inputSchema: {
    slug: z.string().trim().min(1).max(SLUG_MAX_LENGTH).describe("Post slug."),
    lang: langInput,
  },
  outputSchema: {
    post: postSummaryOutput
      .extend({
        body: z.string().nullable(),
        body_available: z.boolean(),
      })
      .nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slug, lang }, ctx) => {
    const sb = await supabaseForCaller(ctx);
    const tenantId = await resolveTenantId(sb);
    const { data: row, error } = await publishedPosts(sb, tenantId).eq("slug", slug).maybeSingle();
    if (error) throw queryFailed("get_post", error);
    // „Nie ma takiego wpisu" to poprawna odpowiedź, nie awaria - bez `isError`,
    // żeby model nie ponawiał wywołania.
    if (!row) {
      return {
        content: [{ type: "text", text: `No published post with slug "${slug}".` }],
        structuredContent: { post: null },
      };
    }

    // Ciało wyłącznie przez bramkowane RPC (SECURITY DEFINER): przelicza
    // najemcę, publikację i dostęp WOŁAJĄCEGO. Pusty wynik = brak dostępu
    // (wpis płatny) - metadane zostają, ciało nie.
    const { data: bodyRows, error: bodyError } = await sb.rpc("get_entity_content", {
      _entity_type: "post",
      _entity_id: row.id,
    });
    if (bodyError) throw queryFailed("get_post body", bodyError);
    const bodyRow = bodyRows?.[0];
    const body = bodyRow ? pickLocalized(bodyRow.content_pl, bodyRow.content_en, lang) : null;

    const post = { ...toPostSummaryJson(row, lang), body, body_available: body !== null };
    return {
      content: [{ type: "text", text: JSON.stringify(post, null, 2) }],
      structuredContent: { post },
    };
  },
});
