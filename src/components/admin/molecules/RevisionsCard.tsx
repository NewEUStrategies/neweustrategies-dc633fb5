import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { GitCompareArrows } from "lucide-react";
import { toastError } from "@/lib/toastError";
import { Button } from "@/components/ui/button";
import { Clock, Undo2 } from "@/lib/lucide-shim";
import { listRevisions, restoreRevision } from "@/lib/revisions.functions";
import { ConfirmDialog, type ConfirmState } from "@/components/admin/ConfirmDialog";
import { StatusBadge } from "@/components/admin/atoms/StatusBadge";
import { useTenantAuthors, authorLabel } from "@/components/admin/hooks/useTenantAuthors";
import { useAuth } from "@/hooks/useAuth";
import {
  RevisionDiffDialog,
  type RevisionDiffRequest,
} from "@/components/admin/molecules/RevisionDiffDialog";

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
  // Diff: pierwszy klik w "porównaj" uzbraja rewizję (bazę porównania),
  // drugi klik na INNEJ rewizji porównuje obie; klik na tej samej - z bieżącą
  // wersją. Wzorzec dwóch kliknięć zamiast checkboxów: zero dodatkowego UI.
  const [diffArmedId, setDiffArmedId] = useState<string | null>(null);
  const [diffRequest, setDiffRequest] = useState<RevisionDiffRequest | null>(null);

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

  const fmt = (iso: string) => new Date(iso).toLocaleString(lang);
  const currentLabel = t("adminPostPanes.revisionDiff.current", {
    defaultValue: "bieżąca wersja",
  });

  const diffWithCurrent = (revisionId: string, createdAt: string) => {
    setDiffArmedId(null);
    setDiffRequest({
      entityType,
      entityId: entityId!,
      ids: [revisionId],
      withCurrent: true,
      beforeLabel: fmt(createdAt),
      afterLabel: currentLabel,
    });
  };

  const compare = (revisionId: string, createdAt: string) => {
    if (!diffArmedId) {
      // Pierwszy klik uzbraja bazę porównania; pasek nad listą prowadzi dalej.
      setDiffArmedId(revisionId);
      return;
    }
    if (diffArmedId === revisionId) {
      setDiffArmedId(null);
      return;
    }
    const armed = (revisions ?? []).find((r) => r.id === diffArmedId);
    setDiffArmedId(null);
    if (!armed) return;
    // Starsza rewizja jest stroną "przed" (serwer i tak zwraca rosnąco).
    const [a, b] =
      new Date(armed.created_at).getTime() <= new Date(createdAt).getTime()
        ? [armed, { id: revisionId, created_at: createdAt }]
        : [{ id: revisionId, created_at: createdAt }, armed];
    setDiffRequest({
      entityType,
      entityId: entityId!,
      ids: [a.id, b.id],
      withCurrent: false,
      beforeLabel: fmt(a.created_at),
      afterLabel: fmt(b.created_at),
    });
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
          toastError(e, "generic");
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

      {diffArmedId && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-brand/30 bg-brand/5 px-2 py-1.5 text-[11px]">
          <span className="min-w-0 flex-1">
            {t("adminPostPanes.revisionDiff.armedHint", {
              defaultValue:
                "Baza porównania: {{date}}. Kliknij ikonę porównania przy innej rewizji albo porównaj z bieżącą wersją.",
              date: fmt(
                (revisions ?? []).find((r) => r.id === diffArmedId)?.created_at ??
                  new Date().toISOString(),
              ),
            })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              const armed = (revisions ?? []).find((r) => r.id === diffArmedId);
              if (armed) diffWithCurrent(armed.id, armed.created_at);
            }}
          >
            {t("adminPostPanes.revisionDiff.withCurrent", {
              defaultValue: "Porównaj z bieżącą",
            })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setDiffArmedId(null)}
          >
            {t("adminPostPanes.revisionDiff.cancel", { defaultValue: "Anuluj" })}
          </Button>
        </div>
      )}

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
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    size="sm"
                    variant={diffArmedId === r.id ? "secondary" : "ghost"}
                    className="h-7 px-2"
                    disabled={busyId !== null}
                    aria-pressed={diffArmedId === r.id}
                    title={
                      diffArmedId && diffArmedId !== r.id
                        ? t("adminPostPanes.revisionDiff.compareWithArmed", {
                            defaultValue: "Porównaj z zaznaczoną rewizją",
                          })
                        : t("adminPostPanes.revisionDiff.compare", {
                            defaultValue: "Porównaj tę rewizję",
                          })
                    }
                    onClick={() => compare(r.id, r.created_at)}
                  >
                    <GitCompareArrows className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={busyId !== null}
                    title={t("admin.revisions.restore", { defaultValue: "Przywróć tę wersję" })}
                    onClick={() => restore(r.id, r.created_at)}
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
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
      <RevisionDiffDialog request={diffRequest} onClose={() => setDiffRequest(null)} />
    </div>
  );
}
