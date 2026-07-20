// Dialog wizualnego porównania rewizji: pola skalarne jako przed → po,
// treść jako liniowy diff (zielone dodane / czerwone usunięte, kontekst
// zwijany jak w git diff). Dane przez getRevisionSnapshots; logika
// porównania w lib/content/revisionDiff (czysta, testowana jednostkowo).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getRevisionSnapshots } from "@/lib/revisions.functions";
import { collapseContext, diffRevisionSnapshots, type FieldDiff } from "@/lib/content/revisionDiff";

export interface RevisionDiffRequest {
  entityType: "post" | "page";
  entityId: string;
  /** Porównywane strony: rewizja(-e) i/lub stan bieżący. */
  ids: string[];
  withCurrent: boolean;
  /** Etykiety stron porównania (daty rewizji / "bieżąca wersja"). */
  beforeLabel: string;
  afterLabel: string;
}

function FieldDiffView({ diff }: { diff: FieldDiff }) {
  const { t } = useTranslation();
  const label = t(`adminPostPanes.revisionDiff.fields.${diff.labelKey}`, {
    defaultValue: diff.field,
  });
  return (
    <section className="rounded-md border border-border overflow-hidden">
      <header className="px-3 py-1.5 bg-muted/40 border-b border-border">
        <h4 className="text-xs font-semibold">{label}</h4>
      </header>
      {diff.kind === "scalar" ? (
        <div className="p-3 text-xs space-y-1">
          {diff.before ? (
            <p className="rounded bg-destructive/10 px-2 py-1 line-through decoration-destructive/60 break-words">
              {diff.before}
            </p>
          ) : (
            <p className="text-muted-foreground italic">
              {t("adminPostPanes.revisionDiff.emptyValue", { defaultValue: "(puste)" })}
            </p>
          )}
          {diff.after ? (
            <p className="rounded bg-emerald-500/10 px-2 py-1 break-words">{diff.after}</p>
          ) : (
            <p className="text-muted-foreground italic">
              {t("adminPostPanes.revisionDiff.emptyValue", { defaultValue: "(puste)" })}
            </p>
          )}
        </div>
      ) : (
        <div className="p-2 text-xs font-mono leading-relaxed max-h-72 overflow-auto">
          {collapseContext(diff.lines ?? []).map((line, i) =>
            "gap" in line ? (
              <p key={i} className="px-2 py-0.5 text-center text-muted-foreground select-none">
                ···{" "}
                {t("adminPostPanes.revisionDiff.unchanged", {
                  defaultValue: "{{count}} linii bez zmian",
                  count: line.gap,
                })}{" "}
                ···
              </p>
            ) : (
              <p
                key={i}
                className={
                  line.kind === "added"
                    ? "rounded-sm bg-emerald-500/10 px-2"
                    : line.kind === "removed"
                      ? "rounded-sm bg-destructive/10 px-2 line-through decoration-destructive/40"
                      : "px-2 text-muted-foreground"
                }
              >
                {line.text}
              </p>
            ),
          )}
        </div>
      )}
    </section>
  );
}

export function RevisionDiffDialog({
  request,
  onClose,
}: {
  request: RevisionDiffRequest | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const snapshots$ = useServerFn(getRevisionSnapshots);

  const q = useQuery({
    enabled: !!request,
    queryKey: [
      "revision-diff",
      request?.entityType,
      request?.entityId,
      request?.ids.join(","),
      request?.withCurrent,
    ],
    queryFn: async () => {
      if (!request) return null;
      const res = await snapshots$({
        data: {
          entityType: request.entityType,
          entityId: request.entityId,
          ids: request.ids,
          withCurrent: request.withCurrent,
        },
      });
      // Strona "przed" to starsza rewizja; "po" to nowsza rewizja albo
      // stan bieżący (getRevisionSnapshots zwraca rewizje rosnąco po dacie).
      const sides = res.revisions.map((r) => (r.snapshot ?? {}) as Record<string, unknown>);
      if (request.withCurrent && res.current) {
        sides.push(res.current as Record<string, unknown>);
      }
      if (sides.length < 2) throw new Error("Not enough snapshots to compare");
      return diffRevisionSnapshots(sides[0], sides[sides.length - 1]);
    },
  });

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("adminPostPanes.revisionDiff.title", { defaultValue: "Porównanie rewizji" })}
          </DialogTitle>
          <DialogDescription>
            {request
              ? t("adminPostPanes.revisionDiff.subtitle", {
                  defaultValue: "{{before}} → {{after}}",
                  before: request.beforeLabel,
                  after: request.afterLabel,
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {q.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("adminPostPanes.revisionDiff.loading", { defaultValue: "Porównuję rewizje..." })}
            </p>
          ) : q.isError ? (
            <p className="text-sm text-destructive">
              {t("adminPostPanes.revisionDiff.error", {
                defaultValue: "Nie udało się porównać rewizji.",
              })}
            </p>
          ) : q.data && q.data.length > 0 ? (
            q.data.map((diff) => <FieldDiffView key={diff.field} diff={diff} />)
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("adminPostPanes.revisionDiff.noChanges", {
                defaultValue: "Brak różnic między porównywanymi wersjami.",
              })}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
