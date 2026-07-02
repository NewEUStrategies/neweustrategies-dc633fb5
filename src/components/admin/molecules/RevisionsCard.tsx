import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Clock, Undo2 } from "@/lib/lucide-shim";
import { listRevisions, restoreRevision } from "@/lib/revisions.functions";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { StatusBadge } from "@/components/admin/atoms/StatusBadge";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";
import { useAuth } from "@/hooks/useAuth";

interface RevisionsCardProps {
  entityType: "post" | "page";
  entityId: string | null | undefined;
  /** Called after a successful restore so the host editor can refetch. */
  onRestored: () => void;
}

const VISIBLE_LIMIT = 30;

/**
 * Molecule: revision history for a post/page. Lists bounded, lightweight
 * snapshots (title/status/editor projections) and restores content
 * non-destructively - the live state is snapshotted before every restore
 * and the workflow status is never changed by a restore.
 */
export function RevisionsCard({ entityType, entityId, onRestored }: RevisionsCardProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language ?? "pl";
  const { tenantId } = useAuth();
  const list$ = useServerFn(listRevisions);
  const restore$ = useServerFn(restoreRevision);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const authorsQ = useTenantAuthors(tenantId);
  const authorMap = new Map((authorsQ.data ?? []).map((a) => [a.id, a]));

  const {
    data: revisions,
    isLoading,
    refetch,
  } = useQuery({
    enabled: !!entityId,
    queryKey: ["content-revisions", entityType, entityId],
    queryFn: () => list$({ data: { entityType, entityId: entityId!, limit: VISIBLE_LIMIT } }),
  });

  if (!entityId) return null;

  const noteLabel = (note: string | null): string | null => {
    if (note === "autosave")
      return t("admin.revisions.note.autosave", { defaultValue: "autozapis" });
    if (note === "pre_restore")
      return t("admin.revisions.note.preRestore", { defaultValue: "kopia przed przywróceniem" });
    return note;
  };

  const restore = (revisionId: string, createdAt: string) => {
    setConfirmState({
      title: t("admin.revisions.confirmTitle", { defaultValue: "Przywrócić tę rewizję?" }),
      description: t("admin.revisions.confirmDescription", {
        defaultValue:
          "Treść z {{date}} zastąpi bieżącą wersję. Obecny stan zostanie zapisany jako kopia, a status publikacji się nie zmieni.",
        date: new Date(createdAt).toLocaleString(lang),
      }),
      confirmLabel: t("admin.revisions.confirmAction", { defaultValue: "Przywróć" }),
      onConfirm: async () => {
        setBusyId(revisionId);
        try {
          await restore$({ data: { id: revisionId } });
          toast.success(t("admin.revisions.restored", { defaultValue: "Przywrócono rewizję" }));
          await refetch();
          onRestored();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : String(e));
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-semibold inline-flex items-center gap-2">
        <Clock className="w-4 h-4" />
        {t("admin.revisions.title", { defaultValue: "Rewizje" })}
        {revisions?.length ? (
          <span className="text-[10px] font-normal text-muted-foreground">
            ({revisions.length})
          </span>
        ) : null}
      </h3>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">...</p>
      ) : !revisions?.length ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.revisions.empty", {
            defaultValue: "Brak rewizji - powstaną przy kolejnych zapisach.",
          })}
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-64 overflow-auto pr-1">
          {revisions.map((r) => {
            const author = r.author_id ? authorMap.get(r.author_id) : undefined;
            const note = noteLabel(r.note);
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="tabular-nums text-[11px]">
                      {new Date(r.created_at).toLocaleString(lang)}
                    </span>
                    {r.status ? (
                      <StatusBadge status={r.status} label={t(`admin.status.${r.status}`)} />
                    ) : null}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {authorLabel(author)}
                    {note ? ` · ${note}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 shrink-0"
                  disabled={busyId !== null}
                  title={t("admin.revisions.restore", { defaultValue: "Przywróć tę wersję" })}
                  onClick={() => restore(r.id, r.created_at)}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        state={confirmState}
        onOpenChange={(o) => {
          if (!o) setConfirmState(null);
        }}
      />
    </div>
  );
}
