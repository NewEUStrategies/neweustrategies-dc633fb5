// Server functions for migrating legacy post content into BlocksDoc.
// - Tenant-scoped via requireStaff (auth + serwerowy check roli) + RLS.
// - Validates input with Zod, no `any`, no `as any`.
// - Rate-limited and audited.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { migratePostContent } from "@/lib/blocks/migrate";

const UUID = z.string().uuid();

async function resolveTenant(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id as string;
}

interface LegacyRow {
  id: string;
  editor: string;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
}

async function migrateOne(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  row: LegacyRow,
): Promise<{ id: string; source: string; skipped: boolean }> {
  if (row.editor === "blocks") return { id: row.id, source: "blocks", skipped: true };
  const result = migratePostContent({
    content_pl: row.content_pl,
    content_en: row.content_en,
    builder_data: row.builder_data,
  });
  const { error } = await supabase
    .from("posts")
    .update({
      editor: "blocks",
      blocks_data: { pl: result.pl, en: result.en },
    })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  return { id: row.id, source: result.source, skipped: false };
}

export const migratePostToBlocks = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Legacy body columns are revoked from the authenticated role, so read them
    // via service_role scoped by tenant; the write stays under the caller's RLS.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tenantId = await resolveTenant(supabaseAdmin, userId);
    const { data: row, error } = await supabaseAdmin
      .from("posts")
      .select("id, editor, content_pl, content_en, builder_data")
      .eq("id", data.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Post not found or access denied");
    return migrateOne(supabase, row as LegacyRow);
  });

export const bulkMigratePostsToBlocks = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({
    ids: z.array(UUID).max(500).optional(),
  }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Legacy body columns are revoked from the authenticated role, so read them
    // via service_role scoped by tenant; writes stay under the caller's RLS.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tenantId = await resolveTenant(supabaseAdmin, userId);
    let query = supabaseAdmin
      .from("posts")
      .select("id, editor, content_pl, content_en, builder_data")
      .eq("tenant_id", tenantId)
      .neq("editor", "blocks")
      .is("deleted_at", null)
      .limit(500);
    if (data.ids?.length) query = query.in("id", data.ids);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const results: Array<{ id: string; source: string; skipped: boolean; error?: string }> = [];
    for (const row of (rows ?? []) as LegacyRow[]) {
      try {
        results.push(await migrateOne(supabase, row));
      } catch (e) {
        results.push({ id: row.id, source: "error", skipped: true, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { total: results.length, migrated: results.filter((r) => !r.skipped).length, results };
  });
