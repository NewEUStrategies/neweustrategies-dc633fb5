// Server-only audit logging helper. Inserts as the authenticated user so RLS
// "audit_log staff insert tenant" passes (tenant_id = current_tenant_id(),
// actor_id = auth.uid()). Failures are logged but never thrown - audit must
// not break the primary action.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditAction =
  | "media.upload"
  | "media.delete"
  | "post.create"
  | "post.update"
  | "post.delete"
  | "post.publish"
  | "post.schedule"
  | "post.review.submit"
  | "page.create"
  | "page.update"
  | "page.delete"
  | "page.publish"
  | "revision.restore"
  | "category.create"
  | "category.update"
  | "category.delete"
  | "tag.create"
  | "tag.delete"
  | "role.grant"
  | "role.revoke"
  | "wp_import.cancel"
  | "redirect.create"
  | "redirect.update"
  | "redirect.delete"
  | "redirect.import";

export async function recordAudit(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      tenant_id: params.tenantId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? {},
      ip: params.ip ?? null,
    });
    if (error) console.warn("[audit] insert failed:", error.message);
  } catch (e) {
    console.warn("[audit] threw:", e);
  }
}
