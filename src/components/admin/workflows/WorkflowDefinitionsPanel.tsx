// Lista przepisów tenanta: wyzwalacz, warunek, sekwencja akcji, statystyki
// przebiegów z okna oraz akcje (toggle, edycja, usunięcie). Karty zamiast
// tabeli - przepis ma zbyt bogaty opis na jeden wiersz, a karty składają się
// naturalnie w gridzie na każdej szerokości.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-workflows";
import { AlertTriangle, Pencil, PlusCircle, ScrollText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  conditionToPairs,
  type WorkflowDefinitionRow,
  type WorkflowRunStats,
} from "@/lib/admin/workflows";
import { DateTimeText, EventTypeChip, StepChips } from "./atoms";

interface WorkflowDefinitionsPanelProps {
  definitions: WorkflowDefinitionRow[];
  stats: Map<string, WorkflowRunStats>;
  loading: boolean;
  onCreate: () => void;
  onEdit: (row: WorkflowDefinitionRow) => void;
  onDelete: (row: WorkflowDefinitionRow) => void;
  onToggle: (row: WorkflowDefinitionRow, enabled: boolean) => void;
  onShowRuns: (row: WorkflowDefinitionRow) => void;
}

export function WorkflowDefinitionsPanel({
  definitions,
  stats,
  loading,
  onCreate,
  onEdit,
  onDelete,
  onToggle,
  onShowRuns,
}: WorkflowDefinitionsPanelProps) {
  const { t } = useTranslation();

  if (!loading && definitions.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <ScrollText className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="max-w-md text-sm text-muted-foreground">
            {t("adminWorkflows.definitions.empty")}
          </p>
          <Button onClick={onCreate}>
            <PlusCircle className="mr-2 h-4 w-4" aria-hidden />
            {t("adminWorkflows.definitions.newRecipe")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {definitions.map((row) => {
        const rowStats = stats.get(row.id);
        const conditionPairs = conditionToPairs(row.condition);
        return (
          <Card key={row.id} className={row.enabled ? "" : "opacity-70"}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="truncate text-base" title={row.name}>
                    {row.name}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="font-normal">
                      {row.template_key
                        ? t("adminWorkflows.definitions.fromTemplate")
                        : t("adminWorkflows.definitions.custom")}
                    </Badge>
                    {rowStats && rowStats.failed > 0 && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-destructive/30 bg-destructive/10 font-normal text-destructive"
                      >
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {t("adminWorkflows.definitions.failures")}: {rowStats.failed}
                      </Badge>
                    )}
                  </div>
                </div>
                <Switch
                  checked={row.enabled}
                  onCheckedChange={(enabled) => onToggle(row, enabled)}
                  aria-label={
                    row.enabled
                      ? t("adminWorkflows.common.enabled")
                      : t("adminWorkflows.common.disabled")
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("adminWorkflows.definitions.trigger")}
                  </dt>
                  <dd>
                    <EventTypeChip type={row.trigger_event_type} />
                  </dd>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("adminWorkflows.definitions.condition")}
                  </dt>
                  <dd className="flex flex-wrap gap-1">
                    {conditionPairs.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("adminWorkflows.definitions.conditionNone")}
                      </span>
                    ) : (
                      conditionPairs.map((pair) => (
                        <code
                          key={pair.key}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                        >
                          {pair.key} = {pair.value}
                        </code>
                      ))
                    )}
                  </dd>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("adminWorkflows.definitions.steps")}
                  </dt>
                  <dd>
                    <StepChips steps={row.steps} />
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span>
                  {t("adminWorkflows.definitions.runs30")}:{" "}
                  <strong className="tabular-nums text-foreground">{rowStats?.total ?? 0}</strong>
                  {" · "}
                  {t("adminWorkflows.definitions.lastRun")}:{" "}
                  <DateTimeText iso={rowStats?.lastRunAt ?? null} />
                </span>
                <span className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => onShowRuns(row)}
                  >
                    {t("adminWorkflows.definitions.showRuns")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEdit(row)}
                    aria-label={t("adminWorkflows.definitions.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label={t("adminWorkflows.definitions.delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("adminWorkflows.definitions.deleteConfirmTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("adminWorkflows.definitions.deleteConfirmBody", { name: row.name })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {t("adminWorkflows.definitions.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => onDelete(row)}
                        >
                          {t("adminWorkflows.definitions.deleteConfirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
