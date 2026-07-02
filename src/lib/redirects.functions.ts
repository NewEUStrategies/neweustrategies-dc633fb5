// Server functions for the redirect manager (/admin/redirects). Same contract
// as every CMS mutation: requireStaff middleware (auth + staff role, second
// layer beside RLS), Zod validation, audit_log entry, per-user rate limit.
// Path normalization + CSV parsing share the pure core in @/lib/seo/redirects,
// so the admin, the import and the serving middleware agree on semantics.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { recordAudit } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";
import {
  isRedirectStatusCode,
  normalizeSourcePath,
  normalizeTargetPath,
  parseRedirectsCsv,
} from "./seo/redirects";

const UUID = z.string().uuid();

const RedirectFields = z.object({
  source_path: z.string().min(1).max(2048),
  target_path: z.string().max(2048).default("/"),
  status_code: z.number().int(),
  is_enabled: z.boolean().default(true),
  note: z.string().max(500).nullable().optional(),
});

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

async function resolveTenant(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id as string;
}

export const upsertRedirect = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z.object({ id: UUID.optional(), fields: RedirectFields }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("redirect.upsert", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const source = normalizeSourcePath(data.fields.source_path);
      if (!source) throw new Error("Invalid source path");
      if (!isRedirectStatusCode(data.fields.status_code)) throw new Error("Invalid status code");
      // 410 Gone needs no meaningful target; store "/" as a placeholder.
      const target =
        data.fields.status_code === 410
          ? (normalizeTargetPath(data.fields.target_path) ?? "/")
          : normalizeTargetPath(data.fields.target_path);
      if (!target) throw new Error("Invalid target path");
      if (target === source) throw new Error("Redirect cannot point at itself");

      const row = {
        source_path: source,
        target_path: target,
        status_code: data.fields.status_code,
        is_enabled: data.fields.is_enabled,
        note: data.fields.note?.trim() || null,
      };
      if (data.id) {
        const { error } = await supabase.from("redirects").update(row).eq("id", data.id);
        if (error) throw new Error(error.message);
        await recordAudit(supabase, {
          tenantId,
          action: "redirect.update",
          entityType: "redirect",
          entityId: data.id,
          metadata: { source_path: source },
        });
        return { id: data.id };
      }
      const { data: inserted, error } = await supabase
        .from("redirects")
        .upsert({ ...row, source: "manual", created_by: userId }, { onConflict: "source_path" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await recordAudit(supabase, {
        tenantId,
        action: "redirect.create",
        entityType: "redirect",
        entityId: inserted.id as string,
        metadata: { source_path: source },
      });
      return { id: inserted.id as string };
    });
  });

export const toggleRedirects = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z.object({ ids: z.array(UUID).min(1).max(500), is_enabled: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("redirect.toggle", userId, 60, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase
        .from("redirects")
        .update({ is_enabled: data.is_enabled })
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      await recordAudit(supabase, {
        tenantId,
        action: "redirect.update",
        entityType: "redirect",
        entityId: null,
        metadata: { ids: data.ids, is_enabled: data.is_enabled },
      });
      return { ok: true as const };
    });
  });

export const deleteRedirects = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("redirect.delete", userId, 60, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase.from("redirects").delete().in("id", data.ids);
      if (error) throw new Error(error.message);
      await recordAudit(supabase, {
        tenantId,
        action: "redirect.delete",
        entityType: "redirect",
        entityId: null,
        metadata: { count: data.ids.length },
      });
      return { ok: true as const };
    });
  });

/** Bulk import from "source,target,status,note" CSV (WP migration tooling). */
export const importRedirectsCsv = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ csv: z.string().min(1).max(2_000_000) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("redirect.import", userId, 10, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { rows, issues } = parseRedirectsCsv(data.csv);
      if (!rows.length) return { imported: 0, issues };
      const payload = rows.map((row) => ({
        source_path: row.source_path,
        target_path: row.target_path,
        status_code: row.status_code,
        note: row.note,
        source: "csv_import",
        created_by: userId,
        is_enabled: true,
      }));
      // Chunked upsert keeps each statement comfortably sized.
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase
          .from("redirects")
          .upsert(payload.slice(i, i + 500), { onConflict: "source_path" });
        if (error) throw new Error(error.message);
      }
      await recordAudit(supabase, {
        tenantId,
        action: "redirect.import",
        entityType: "redirect",
        entityId: null,
        metadata: { imported: rows.length, issues: issues.length },
      });
      return { imported: rows.length, issues };
    });
  });

/** Dismiss entries from the 404 monitor (also used after "create redirect"). */
export const dismissSeo404 = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z.object({ paths: z.array(z.string().max(500)).min(1).max(500) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("redirect.dismiss404", userId, 60, async () => {
      const { error } = await supabase.from("seo_404_hits").delete().in("path", data.paths);
      if (error) throw new Error(error.message);
      return { ok: true as const };
    });
  });
