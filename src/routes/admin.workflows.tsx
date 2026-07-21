// /admin/workflows - panel „Automatyzacje": UI silnika przepisów „gdy X ->
// zrób Y" (workflow_definitions / workflow_runs / workflow_templates z
// migracji 20260711204000) plus diagnostyczny ślad korelacji
// (get_correlated_events + workflow_runs + integration_deliveries).
//
// Zakładka i kontekst (correlation_id, filtr przepisu) żyją w search params,
// więc widoki są linkowalne: /admin/workflows?tab=trace&correlation=<uuid>.
// UWAGA: bez side-effect importu "@/lib/i18n-admin-workflows" na poziomie
// trasy - config trasy jest w EAGER grafie routera i taki import wciągnąłby
// słownik do chunka wejściowego. Overlay rejestrują komponenty panelu
// (ten sam lazy chunk co komponent strony).
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlusCircle, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  aggregateRunStats,
  deleteWorkflowDefinition,
  draftFromDefinition,
  emptyWorkflowDraft,
  fetchRecentWorkflowRuns,
  fetchWorkflowDefinitions,
  fetchWorkflowTemplates,
  saveWorkflowDefinition,
  setWorkflowEnabled,
  type WorkflowDefinitionRow,
  type WorkflowDraft,
} from "@/lib/admin/workflows";
import { WorkflowDefinitionsPanel } from "@/components/admin/workflows/WorkflowDefinitionsPanel";
import { WorkflowEditorDialog } from "@/components/admin/workflows/WorkflowEditorDialog";
import { WorkflowRunsPanel } from "@/components/admin/workflows/WorkflowRunsPanel";
import { WorkflowTemplatesPanel } from "@/components/admin/workflows/WorkflowTemplatesPanel";
import { CorrelationTracePanel } from "@/components/admin/workflows/CorrelationTracePanel";

const TABS = ["definitions", "runs", "templates", "trace"] as const;
type WorkflowsTab = (typeof TABS)[number];

interface WorkflowsSearch {
  tab?: WorkflowsTab;
  correlation?: string;
  workflow?: string;
}

// Okno statystyk na liście przepisów i w KPI (ostatnie N przebiegów).
const RUNS_WINDOW = 500;

// Lokalna kopia walidacji uuid: validateSearch żyje w eager configu trasy,
// a import isUuid z @/lib/admin/workflows wciągnąłby całą warstwę danych
// (łącznie z klientem Supabase) do chunka wejściowego.
const SEARCH_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function searchUuid(value: unknown): string | undefined {
  return typeof value === "string" && SEARCH_UUID_RE.test(value) ? value : undefined;
}

export const Route = createFileRoute("/admin/workflows")({
  head: () => ({
    meta: [{ title: "Automatyzacje · Admin" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: (s: Record<string, unknown>): WorkflowsSearch => ({
    tab: TABS.includes(s.tab as WorkflowsTab) ? (s.tab as WorkflowsTab) : undefined,
    correlation: searchUuid(s.correlation),
    workflow: searchUuid(s.workflow),
  }),
  component: AdminWorkflowsPage,
});

function AdminWorkflowsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const qc = useQueryClient();

  const tab: WorkflowsTab = search.tab ?? "definitions";
  const [runStatusFilter, setRunStatusFilter] = useState<"succeeded" | "failed" | null>(null);
  const [editorDraft, setEditorDraft] = useState<WorkflowDraft | null>(null);

  const setSearch = (patch: Partial<WorkflowsSearch>) =>
    void navigate({
      search: (prev: WorkflowsSearch) => ({ ...prev, ...patch }),
      replace: true,
    });

  const definitionsQuery = useQuery({
    queryKey: ["admin", "workflow-definitions"],
    queryFn: fetchWorkflowDefinitions,
    staleTime: 30_000,
  });
  const recentRunsQuery = useQuery({
    queryKey: ["admin", "workflow-runs-window", RUNS_WINDOW],
    queryFn: () => fetchRecentWorkflowRuns(RUNS_WINDOW),
    staleTime: 30_000,
  });
  const templatesQuery = useQuery({
    queryKey: ["admin", "workflow-templates"],
    queryFn: fetchWorkflowTemplates,
    staleTime: 5 * 60_000,
  });

  // Fallbacki w useMemo (nie `?? []` inline): świeża tablica przy każdym
  // renderze unieważniałaby zależne useMemo poniżej.
  const definitions = useMemo(() => definitionsQuery.data ?? [], [definitionsQuery.data]);
  const recentRuns = useMemo(() => recentRunsQuery.data ?? [], [recentRunsQuery.data]);
  const templates = templatesQuery.data ?? [];
  const stats = useMemo(() => aggregateRunStats(recentRuns), [recentRuns]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "workflow-definitions"] });
    void qc.invalidateQueries({ queryKey: ["admin", "workflow-runs-window", RUNS_WINDOW] });
  };

  const save = useMutation({
    mutationFn: saveWorkflowDefinition,
    onSuccess: () => {
      toast.success(t("adminWorkflows.common.saved"));
      setEditorDraft(null);
      invalidate();
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("adminWorkflows.common.error", { message }));
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setWorkflowEnabled(id, enabled),
    onSuccess: invalidate,
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("adminWorkflows.common.error", { message }));
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: deleteWorkflowDefinition,
    onSuccess: () => {
      toast.success(t("adminWorkflows.common.deleted"));
      invalidate();
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("adminWorkflows.common.error", { message }));
    },
  });

  const showTrace = (correlationId: string) =>
    setSearch({ tab: "trace", correlation: correlationId });

  const kpis = useMemo(() => {
    const failed = recentRuns.filter((r) => r.status === "failed").length;
    return {
      active: definitions.filter((d) => d.enabled).length,
      runs: recentRuns.length,
      failed,
      installed: definitions.filter((d) => d.template_key !== null).length,
    };
  }, [definitions, recentRuns]);

  const jumpToFailed = () => {
    setRunStatusFilter("failed");
    setSearch({ tab: "runs", workflow: undefined });
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-brand/10 text-brand">
            <WorkflowIcon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold">{t("adminWorkflows.title")}</h1>
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
              {t("adminWorkflows.subtitle")}
            </p>
          </div>
        </div>
        <Button onClick={() => setEditorDraft(emptyWorkflowDraft())} className="md:self-center">
          <PlusCircle className="mr-2 h-4 w-4" aria-hidden />
          {t("adminWorkflows.definitions.newRecipe")}
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(value) => setSearch({ tab: value as WorkflowsTab })}>
        <TabsList className="flex w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="definitions">{t("adminWorkflows.tabs.definitions")}</TabsTrigger>
          <TabsTrigger value="templates">{t("adminWorkflows.tabs.templates")}</TabsTrigger>
          <TabsTrigger value="runs">{t("adminWorkflows.tabs.runs")}</TabsTrigger>
          <TabsTrigger value="trace">{t("adminWorkflows.tabs.trace")}</TabsTrigger>
        </TabsList>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label={t("adminWorkflows.kpi.activeDefinitions")} value={kpis.active} />
          <KpiCard label={t("adminWorkflows.kpi.templatesInstalled")} value={kpis.installed} />
          <KpiCard
            label={t("adminWorkflows.kpi.runsWindow", { count: RUNS_WINDOW })}
            value={kpis.runs}
          />
          <KpiCard
            label={t("adminWorkflows.kpi.failuresWindow", { count: RUNS_WINDOW })}
            value={kpis.failed}
            tone={kpis.failed > 0 ? "destructive" : "default"}
            onClick={kpis.failed > 0 ? jumpToFailed : undefined}
          />
        </div>

        <TabsContent value="definitions" className="mt-4">
          <WorkflowDefinitionsPanel
            definitions={definitions}
            stats={stats}
            loading={definitionsQuery.isLoading}
            onCreate={() => setEditorDraft(emptyWorkflowDraft())}
            onEdit={(row: WorkflowDefinitionRow) => setEditorDraft(draftFromDefinition(row))}
            onDelete={(row: WorkflowDefinitionRow) => remove.mutate(row.id)}
            onToggle={(row: WorkflowDefinitionRow, enabled: boolean) =>
              toggle.mutate({ id: row.id, enabled })
            }
            onShowRuns={(row: WorkflowDefinitionRow) =>
              setSearch({ tab: "runs", workflow: row.id })
            }
          />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <WorkflowTemplatesPanel
            templates={templates}
            definitions={definitions}
            loading={templatesQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <WorkflowRunsPanel
            definitions={definitions}
            filter={{ workflowId: search.workflow ?? null, status: runStatusFilter }}
            onFilterChange={(next) => {
              setRunStatusFilter(next.status);
              setSearch({ workflow: next.workflowId ?? undefined });
            }}
            onShowTrace={showTrace}
          />
        </TabsContent>

        <TabsContent value="trace" className="mt-4">
          <CorrelationTracePanel
            correlationId={search.correlation ?? null}
            onCorrelationIdChange={(id) => setSearch({ correlation: id ?? undefined })}
          />
        </TabsContent>
      </Tabs>

      <WorkflowEditorDialog
        open={editorDraft !== null}
        initial={editorDraft ?? emptyWorkflowDraft()}
        saving={save.isPending}
        onClose={() => setEditorDraft(null)}
        onSave={(draft) => save.mutate(draft)}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone = "default",
  onClick,
}: {
  label: string;
  value: number;
  tone?: "default" | "destructive";
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  return (
    <Card
      onClick={onClick}
      className={
        clickable
          ? "cursor-pointer transition-colors hover:border-brand/40 hover:bg-brand/5"
          : ""
      }
    >
      <CardContent className="space-y-1 p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-2xl font-semibold tabular-nums ${
            tone === "destructive" ? "text-destructive" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

