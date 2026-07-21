// Server-only audit logging helper. Inserts as the authenticated user so RLS
// "audit_log staff insert tenant" passes (tenant_id = current_tenant_id(),
// actor_id = auth.uid()). Failures are logged but never thrown - audit must
// not break the primary action.
import type { SupabaseClient } from "@supabase/supabase-js";

import { purgeDocumentCacheForCurrentHost } from "../http/documentCache.server";

export type AuditAction =
  | "media.upload"
  | "media.delete"
  | "post.create"
  | "post.update"
  | "post.delete"
  | "post.duplicate"
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
  | "redirect.import"
  | "media.update"
  | "media.bulk_move"
  | "media.bulk_delete"
  | "media.duplicate"
  | "media.folder_create"
  | "media.folder_rename"
  | "media.folder_delete";

// Mutacje tych agregatów zmieniają publiczne dokumenty HTML (treść, archiwa,
// routing), więc audyt jest też JEDYNYM punktem unieważnienia NES Edge Cache:
// każdy handler treści woła recordAudit, a przyszłe mutacje dziedziczą purge
// automatycznie zamiast pamiętać o osobnym wywołaniu.
const DOCUMENT_PURGE_ACTIONS = /^(post|page|category|tag|redirect|revision)\./;

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
  if (DOCUMENT_PURGE_ACTIONS.test(params.action)) {
    // Best-effort, bez await: purge nie może opóźnić ani zepsuć mutacji.
    void purgeDocumentCacheForCurrentHost().catch(() => undefined);
  }
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
