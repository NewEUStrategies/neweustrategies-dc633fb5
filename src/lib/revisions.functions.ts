// Server functions for content revision history (posts & pages). Same
// contract as content.functions.ts: requireStaff + Zod + tenant resolution
// server-side + audit + rate limiting. RLS additionally scopes every query
// to the caller's tenant and staff role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import type { Database, Json } from "@/integrations/supabase/types";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";
import { pickRestorableFields, pickRevisionSnapshot } from "./content/revisions";

const UUID = z.string().uuid();
const EntityType = z.enum(["post", "page"]);

export interface RevisionListItem {
  id: string;
  created_at: string;
  author_id: string | null;
  note: string | null;
  title_pl: string | null;
  title_en: string | null;
  status: string | null;
  editor: string | null;
}

async function resolveTenant(supabase: SupabaseClient<Database>, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id;
}

async function guard<T>(
  scope: string,
  userId: string,
  max: number,
  action: () => Promise<T>,
): Promise<T> {
  if (!(await rateLimit({ scope, subjectId: userId, max }))) {
    throw new Error("Rate limit exceeded - please slow down");
  }
  return action();
}

/**
 * Lightweight revision list: JSON-path projections instead of full snapshots,
 * so a 50-entry history costs kilobytes, not megabytes of builder JSON.
 */
export const listRevisions = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        entityType: EntityType,
        entityId: UUID,
        limit: z.number().int().min(1).max(100).default(50),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("revision.list", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { data: rows, error } = await supabase
        .from("content_revisions")
        .select(
          "id, created_at, author_id, note, " +
            "title_pl:snapshot->>title_pl, title_en:snapshot->>title_en, " +
            "status:snapshot->>status, editor:snapshot->>editor",
        )
        .eq("tenant_id", tenantId)
        .eq("entity_type", data.entityType)
        .eq("entity_id", data.entityId)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (error) throw new Error(error.message);
      // JSON-path aliases (snapshot->>field) are beyond the supabase-js query
      // parser, so the runtime shape is asserted here instead of inferred.
      return (rows ?? []) as unknown as RevisionListItem[];
    });
  });

/**
 * Restore a revision's content onto the live row. Non-destructive:
 * the current state is snapshotted first (note "pre_restore"), and the
 * workflow status is deliberately left untouched - restoring old content
 * must never silently (un)publish a post.
 */
export const restoreRevision = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("revision.restore", userId, 30, async () => {
      const tenantId = await resolveTenant(supabase, userId);

      const { data: revision, error: revErr } = await supabase
        .from("content_revisions")
        .select("id, entity_type, entity_id, snapshot, created_at")
        .eq("tenant_id", tenantId)
        .eq("id", data.id)
        .maybeSingle();
      if (revErr) throw new Error(revErr.message);
      if (!revision) throw new Error("Revision not found or access denied");

      const isPage = revision.entity_type === "page";
      const { data: current, error: curErr } = isPage
        ? await supabase
            .from("pages")
            .select("*")
            .eq("id", revision.entity_id)
            .is("deleted_at", null)
            .maybeSingle()
        : await supabase
            .from("posts")
            .select("*")
            .eq("id", revision.entity_id)
            .is("deleted_at", null)
            .maybeSingle();
      if (curErr) throw new Error(curErr.message);
      if (!current) throw new Error("Content not found or access denied");

      // Safety snapshot of the live state before overwriting it.
      const { error: backupErr } = await supabase.from("content_revisions").insert({
        tenant_id: tenantId,
        entity_type: revision.entity_type,
        entity_id: revision.entity_id,
        author_id: userId,
        snapshot: pickRevisionSnapshot(current) as Json,
        note: "pre_restore",
      });
      if (backupErr) throw new Error(backupErr.message);

      const snapshot = (revision.snapshot ?? {}) as Record<string, unknown>;
      const fields = pickRestorableFields(snapshot);
      if (!Object.keys(fields).length) throw new Error("Revision snapshot is empty");
      const { error: updErr } = isPage
        ? await supabase
            .from("pages")
            .update(fields as Database["public"]["Tables"]["pages"]["Update"])
            .eq("id", revision.entity_id)
        : await supabase
            .from("posts")
            .update(fields as Database["public"]["Tables"]["posts"]["Update"])
            .eq("id", revision.entity_id);
      if (updErr) throw new Error(updErr.message);

      await recordAudit(supabase, {
        tenantId,
        action: "revision.restore",
        entityType: revision.entity_type,
        entityId: revision.entity_id,
        metadata: { revision_id: revision.id, revision_created_at: revision.created_at },
      });
      return { ok: true as const, entityId: revision.entity_id };
    });
  });
