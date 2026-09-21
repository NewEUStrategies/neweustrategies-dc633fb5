// Server-only audit logging helper. Inserts as the authenticated user so RLS
// "audit_log staff insert tenant" passes (tenant_id = current_tenant_id(),
// actor_id = auth.uid()). Failures are logged but never thrown - audit must
// not break the primary action.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  purgeDocumentCacheForCurrentHost,
  purgeDocumentPathsForCurrentHost,
} from "../http/documentCache.server";

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
//
// ZAKRES purge'a wybiera wołający przez `documentPaths` (patrz `recordAudit`):
// bez niego purge jest PEŁNY (bump wersji L2 całego hosta - każda kolonia
// traci wszystkie dokumenty, audyt CWV 2026-09-20 F12), z nim - SELEKTYWNY,
// tylko podane ścieżki. Strony, ustawienia, menu i motyw zmieniają chrome
// każdego dokumentu, więc zostają przy pełnym bumpie; wpis zmienia znany,
// skończony zbiór dokumentów (`postDocumentPaths` w lib/http/documentCache.ts).
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
    actorId?: string | null;
    /**
     * Publiczne ścieżki dokumentów, które ta mutacja zmienia (bez prefiksu
     * języka - warianty `/en` dokłada purge). PODANE => purge selektywny
     * wyłącznie tych ścieżek zamiast bumpu wersji całego hosta; wołający
     * ręczy, że lista jest kompletna (przy zmianie sluga/rodzica: stary
     * I nowy adres). Niepodane => pełny purge jak dotąd - poprawność ważniejsza
     * niż hit-rate, więc brak wiedzy o zależnościach = pełny bump.
     */
    documentPaths?: readonly string[];
  },
): Promise<void> {
  if (DOCUMENT_PURGE_ACTIONS.test(params.action)) {
    // Best-effort, bez await: purge nie może opóźnić ani zepsuć mutacji.
    const purge = params.documentPaths
      ? purgeDocumentPathsForCurrentHost(params.documentPaths)
      : purgeDocumentCacheForCurrentHost();
    void purge.catch(() => undefined);
  }
  try {
    // RLS "audit_log staff insert tenant" wymaga actor_id = auth.uid().
    // Jeśli wywołujący nie podał explicit actorId, pobieramy z bieżącej sesji;
    // brak sesji → pomijamy insert (audyt jest best-effort, nie może zablokować
    // mutacji ani wybuchać na anon serverFn).
    let actorId = params.actorId ?? null;
    if (!actorId) {
      const { data: userRes } = await supabase.auth.getUser();
      actorId = userRes.user?.id ?? null;
    }
    if (!actorId) {
      console.warn(`[audit] skipped (${params.action}): no auth session`);
      return;
    }
    const { error } = await supabase.from("audit_log").insert({
      tenant_id: params.tenantId,
      actor_id: actorId,
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
