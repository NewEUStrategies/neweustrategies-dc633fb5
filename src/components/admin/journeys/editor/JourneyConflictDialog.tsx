// Dialog konfliktu szkicu ścieżki (S8, SPEC §6.3 „konflikt -> dialog różnic”).
//
// KIEDY. Sesja edytora (`useJourneyEditorSession`) wykryła, że ścieżkę zapisano
// w innej karcie, a tutaj leżą niezapisane zmiany: autozapis stoi, dopóki
// redaktor nie wybierze wersji. `RevisionDiffDialog` z modułu treści zna tylko
// wpisy i strony (`content_revisions`), więc ścieżka ma własny dialog na tej
// samej logice różnic (`diffLines`/`collapseContext` z `revisionDiff.ts`).
//
// CO POKAZUJEMY. Sekcje, które się różnią (nazwa i kategoria, ustawienia,
// kroki, połączenia) jako linie stabilnego JSON-u (`journeyConflictDiff`):
// „+” = tylko w Twojej wersji, „−” = tylko w wersji z innej karty; niezmienione
// ciągi zwinięte do kontekstu jak w git diff. Kolor nigdy sam - znak i ukryty
// opis dla czytnika przy każdej linii.
//
// DECYZJA. „Zachowaj moje” = zapis szkicu z tokenem wersji serwera (świadome
// nadpisanie), „Weź wersję z innej karty” = odrzucenie lokalnych zmian. Esc
// i przycisk zamknięcia NIE rozstrzygają - konflikt zostaje, a edytor pokazuje
// pasek z powrotem do dialogu (autozapis dalej czeka).
import { useId, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  journeyConflictDiff,
  type JourneyConflictSection,
  type JourneyConflictSectionId,
  type JourneyEditorConflict,
} from "@/lib/admin/journeys/editorSession";
import { collapseContext } from "@/lib/content/revisionDiff";
import { formatDateTime } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-admin-journeys-editor";

export interface JourneyConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Konflikt sesji (`session.conflict`); `null` - dialog zamknięty. */
  conflict: JourneyEditorConflict | null;
  /** „Zachowaj moje” (`session.keepMine`) - `true`, gdy zapis się udał. */
  onKeepMine: () => Promise<boolean>;
  /** „Weź wersję z innej karty” (`session.takeServer`). */
  onTakeServer: () => void;
}

const SECTION_LABEL_KEY: Readonly<Record<JourneyConflictSectionId, string>> = {
  definition: "adminJourneys.editor.conflict.sections.definition",
  settings: "adminJourneys.editor.conflict.sections.settings",
  nodes: "adminJourneys.editor.conflict.sections.nodes",
  edges: "adminJourneys.editor.conflict.sections.edges",
};

/** Liczba linii kontekstu wokół zmian (jak `RevisionDiffDialog`). */
const DIFF_CONTEXT_LINES = 2;

export function JourneyConflictDialog({
  open,
  onOpenChange,
  conflict,
  onKeepMine,
  onTakeServer,
}: JourneyConflictDialogProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [keepFailed, setKeepFailed] = useState(false);
  const server = conflict?.server ?? null;
  const sections = useMemo(
    () => (conflict && server ? journeyConflictDiff(conflict.local, server) : []),
    [conflict, server],
  );

  const changeOpen = (next: boolean) => {
    if (!next) setKeepFailed(false);
    onOpenChange(next);
  };

  const keepMine = async () => {
    setBusy(true);
    setKeepFailed(false);
    try {
      const saved = await onKeepMine();
      if (saved) onOpenChange(false);
      else setKeepFailed(true);
    } catch {
      setKeepFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const takeServer = () => {
    onTakeServer();
    onOpenChange(false);
  };

  const ready = server !== null && !busy;

  return (
    <Dialog open={open && conflict !== null} onOpenChange={changeOpen}>
      <DialogContent
        data-testid="journey-conflict-dialog"
        className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {t("adminJourneys.editor.conflict.title")}
          </DialogTitle>
          <DialogDescription>
            {server
              ? t("adminJourneys.editor.conflict.description", {
                  date: formatDateTime(server.token, i18n.language),
                })
              : t("adminJourneys.editor.conflict.loading")}
          </DialogDescription>
        </DialogHeader>

        {server === null ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {t("adminJourneys.editor.conflict.loading")}
          </p>
        ) : sections.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {t("adminJourneys.editor.conflict.noDifferences")}
          </p>
        ) : (
          <div className="space-y-3">
            <ul
              aria-label={t("adminJourneys.editor.conflict.legend")}
              className="m-0 flex list-none flex-wrap gap-3 p-0 text-xs"
            >
              <li className="rounded-sm bg-emerald-500/10 px-2">
                <span aria-hidden="true">+ </span>
                {t("adminJourneys.editor.conflict.legendMine")}
              </li>
              <li className="rounded-sm bg-destructive/10 px-2">
                <span aria-hidden="true">− </span>
                {t("adminJourneys.editor.conflict.legendServer")}
              </li>
            </ul>
            {sections.map((section) => (
              <ConflictSection
                key={section.id}
                section={section}
                headingId={`${id}-${section.id}`}
              />
            ))}
          </div>
        )}

        {keepFailed ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {t("adminJourneys.editor.conflict.keepFailed")}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!ready}
            aria-describedby={`${id}-take-hint`}
            onClick={takeServer}
          >
            {t("adminJourneys.editor.conflict.takeServer")}
          </Button>
          <Button
            type="button"
            disabled={!ready}
            aria-describedby={`${id}-keep-hint`}
            onClick={() => void keepMine()}
          >
            {busy
              ? t("adminJourneys.editor.conflict.saving")
              : t("adminJourneys.editor.conflict.keepMine")}
          </Button>
        </DialogFooter>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p id={`${id}-keep-hint`} className="m-0">
            {t("adminJourneys.editor.conflict.keepMineHint")}
          </p>
          <p id={`${id}-take-hint`} className="m-0">
            {t("adminJourneys.editor.conflict.takeServerHint")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConflictSection({
  section,
  headingId,
}: {
  section: JourneyConflictSection;
  headingId: string;
}) {
  const { t } = useTranslation();
  const mine = t("adminJourneys.editor.conflict.legendMine");
  const theirs = t("adminJourneys.editor.conflict.legendServer");
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-[6px] border border-border"
    >
      <h3
        id={headingId}
        className="m-0 border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-semibold"
      >
        {t(SECTION_LABEL_KEY[section.id])}
      </h3>
      {/* Przewijany obszar dostaje fokus z klawiatury (WCAG 2.1.1). */}
      <div
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="max-h-72 overflow-auto p-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ol className="m-0 list-none p-0">
          {collapseContext(section.lines, DIFF_CONTEXT_LINES).map((line, index) =>
            "gap" in line ? (
              <li key={index} className="px-2 py-0.5 text-center text-muted-foreground select-none">
                ··· {t("adminJourneys.editor.conflict.unchanged", { count: line.gap })} ···
              </li>
            ) : (
              <li
                key={index}
                className={
                  line.kind === "added"
                    ? "rounded-sm bg-emerald-500/10 px-2 break-all"
                    : line.kind === "removed"
                      ? "rounded-sm bg-destructive/10 px-2 break-all"
                      : "px-2 text-muted-foreground break-all"
                }
              >
                {line.kind === "same" ? null : (
                  <>
                    <span aria-hidden="true">{line.kind === "added" ? "+ " : "− "}</span>
                    <span className="sr-only">{line.kind === "added" ? mine : theirs}: </span>
                  </>
                )}
                {line.text}
              </li>
            ),
          )}
        </ol>
      </div>
    </section>
  );
}
