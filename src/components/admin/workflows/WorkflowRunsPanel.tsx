// Historia przebiegów silnika: filtrowana tabela (przepis + status) z linkiem
// „Ślad" przenoszącym do zakładki korelacji, gdy przebieg ma correlation_id.
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-workflows";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, RefreshCw, Route as RouteIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchWorkflowRuns,
  type WorkflowDefinitionRow,
  type WorkflowRunsFilter,
} from "@/lib/admin/workflows";
import { DateTimeText, EventTypeChip, RunStatusBadge } from "./atoms";

const ALL = "__all__";

interface WorkflowRunsPanelProps {
  definitions: WorkflowDefinitionRow[];
  filter: { workflowId: string | null; status: "succeeded" | "failed" | null };
  onFilterChange: (filter: {
    workflowId: string | null;
    status: "succeeded" | "failed" | null;
  }) => void;
  onShowTrace: (correlationId: string) => void;
}

export function WorkflowRunsPanel({
  definitions,
  filter,
  onFilterChange,
  onShowTrace,
}: WorkflowRunsPanelProps) {
  const { t } = useTranslation();

  const runsQuery = useQuery({
    queryKey: ["admin", "workflow-runs", filter.workflowId, filter.status],
    queryFn: () => {
      const params: WorkflowRunsFilter = { limit: 200 };
      if (filter.workflowId) params.workflowId = filter.workflowId;
      if (filter.status) params.status = filter.status;
      return fetchWorkflowRuns(params);
    },
    staleTime: 15_000,
  });

  const rows = runsQuery.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter.workflowId ?? ALL}
          onValueChange={(value) =>
            onFilterChange({ ...filter, workflowId: value === ALL ? null : value })
          }
        >
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue placeholder={t("adminWorkflows.runs.filterWorkflow")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminWorkflows.runs.allWorkflows")}</SelectItem>
            {definitions.map((def) => (
              <SelectItem key={def.id} value={def.id}>
                {def.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filter.status ?? ALL}
          onValueChange={(value) =>
            onFilterChange({
              ...filter,
              status: value === ALL ? null : value === "failed" ? "failed" : "succeeded",
            })
          }
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder={t("adminWorkflows.runs.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("adminWorkflows.runs.allStatuses")}</SelectItem>
            <SelectItem value="succeeded">{t("adminWorkflows.runs.statusSucceeded")}</SelectItem>
            <SelectItem value="failed">{t("adminWorkflows.runs.statusFailed")}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void runsQuery.refetch()}
          disabled={runsQuery.isFetching}
        >
          {runsQuery.isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {t("adminWorkflows.runs.refresh")}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {runsQuery.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("adminWorkflows.common.loading")}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <History className="h-6 w-6" aria-hidden />
              {t("adminWorkflows.runs.empty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("adminWorkflows.runs.colWhen")}</TableHead>
                    <TableHead>{t("adminWorkflows.runs.colWorkflow")}</TableHead>
                    <TableHead>{t("adminWorkflows.runs.colEvent")}</TableHead>
                    <TableHead>{t("adminWorkflows.runs.filterStatus")}</TableHead>
                    <TableHead className="text-right">
                      {t("adminWorkflows.runs.colSteps")}
                    </TableHead>
                    <TableHead>{t("adminWorkflows.runs.colError")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((run) => {
                    // Const zamiast property access - narrowing null-a działa
                    // wtedy także wewnątrz closure onClick.
                    const correlationId = run.correlation_id;
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          <DateTimeText iso={run.created_at} />
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm">
                          {run.workflow_definitions?.name ?? (
                            <span className="text-muted-foreground">
                              {t("adminWorkflows.runs.deletedWorkflow")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <EventTypeChip type={run.event_type} />
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {run.steps_completed}
                        </TableCell>
                        <TableCell
                          className="max-w-[260px] truncate text-xs text-destructive"
                          title={run.error ?? undefined}
                        >
                          {run.error ?? ""}
                        </TableCell>
                        <TableCell className="text-right">
                          {correlationId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => onShowTrace(correlationId)}
                            >
                              <RouteIcon className="h-3.5 w-3.5" aria-hidden />
                              {t("adminWorkflows.runs.trace")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
