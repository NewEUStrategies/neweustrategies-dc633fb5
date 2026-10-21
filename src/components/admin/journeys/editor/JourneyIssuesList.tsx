// Lista problemów ścieżki (S8, SPEC §6.3 „Sprawdź (n)”) - ta sama lista
// w pasku edytora i w dialogu publikacji.
//
// JEDNO ŹRÓDŁO PROBLEMÓW. Zdania, poziomy i kolejność liczy
// `collectJourneyIssues` (S8.1 `issues.ts`); tu jest tylko prezentacja i hook
// `useJourneyIssues`, który składa kontekst serwera: nazwa nadawcy i stan
// silnika (`journey_settings`, zdrowie), przepisy automatyzacji (nakładanie
// i zastępowany przepis szablonu), aktywne ścieżki (cykl wyzwalaczy). Pasek
// edytora i dialog publikacji wołają ten sam hook - licznik „Sprawdź (n)”
// nie może pokazać mniej blokad niż dialog, który potem odmówi publikacji.
//
// KOLOR NIGDY SAM: poziom to ikona + słowo („Blokuje publikację”), numer
// kroku to tekst. Przejście do kroku (`onFocusNode`) zamyka dialog i stawia
// fokus na karcie kanwy albo wierszu listy - decyduje edytor.
//
// KONTEKST NIEPEŁNY ≠ BRAK BLOKAD. Dopóki ustawienia silnika się nie wczytały,
// blokada „nadawca domyślny” jest NIEZNANA, a nie spełniona - hook oddaje
// `ready: false` i dialog publikacji czeka.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import {
  collectJourneyIssues,
  issueCounts,
  publishBlockers,
  type JourneyIssue,
  type JourneyIssueSeverity,
  type JourneyIssueWorkflow,
} from "@/lib/admin/journeys/issues";
import type { JourneyDetailDto } from "@/lib/admin/journeys/journeyEditor.functions";
import { journeyTemplateCatalogQueryOptions } from "@/lib/admin/journeys/journeyQueries";
import { parseWorkflowSteps, type WorkflowDefinitionRow } from "@/lib/admin/workflows";
import { workflowDefinitionsQueryOptions } from "@/lib/admin/workflowQueries";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-publish";
import type {
  JourneyEngineHealthDto,
  JourneyListItem,
  JourneySettingsDto,
} from "@/lib/journeys/dto";
import type { JourneyDraft } from "@/lib/journeys/graph";
import type { JourneyCategory } from "@/lib/journeys/limits";
import {
  journeyEngineHealthQueryOptions,
  journeyListQueryOptions,
  journeySettingsQueryOptions,
} from "@/lib/journeys/queries";

// ── Kontekst problemów (hook wspólny dla paska edytora i publikacji) ─────────

export interface UseJourneyIssuesInput {
  tenantId: string | null;
  journeyId: string;
  /** Szczegół z `journeyDetailQueryOptions` (`null` - jeszcze się wczytuje). */
  detail: JourneyDetailDto | null;
  /**
   * Szkic z sesji edytora (może być niezapisany). `undefined` - szkic
   * z `detail`; `null` - szkic edytora nie przechodzi schematu.
   */
  draft?: JourneyDraft | null;
  /** Kategoria i podstawa prawna z arkusza ustawień przed zapisem. */
  definition?: { category?: JourneyCategory; legalBasis?: string | null };
  /** Odczyty kontekstu tylko wtedy, gdy ktoś patrzy (dialog otwarty, pasek widoczny). */
  enabled?: boolean;
}

export interface JourneyIssuesContext {
  settings: JourneySettingsDto | null;
  health: JourneyEngineHealthDto | null;
  /** Przepisy najemcy; `null` - nieznane (odczyt trwa albo się nie udał). */
  workflows: readonly WorkflowDefinitionRow[] | null;
  workflowsFailed: boolean;
  /** Wiersz tej ścieżki z listy (`active` = kontakty w toku bez testowych). */
  listItem: JourneyListItem | null;
  /** Przepis, który zastępuje szablon ścieżki (`replacesWorkflowTemplate`). */
  replacesWorkflowTemplate: string | null;
  /**
   * Włączone przepisy, które dublują ścieżkę: zastępowany przez szablon albo
   * ten sam wyzwalacz z zadaniem CRM (reguła `workflow_overlap` walidatora).
   */
  workflowDuplicates: readonly JourneyWorkflowDuplicate[];
}

export interface JourneyWorkflowDuplicate {
  row: WorkflowDefinitionRow;
  reason: "replace" | "overlap";
}

export interface JourneyIssuesState {
  issues: JourneyIssue[];
  blockers: JourneyIssue[];
  counts: Record<JourneyIssueSeverity, number>;
  /** Ustawienia, zdrowie, lista i katalog wczytane - lista blokad jest pełna. */
  ready: boolean;
  /** Odczyt kontekstu potrzebnego do blokad zawiódł (ponowienie: `retry`). */
  failed: boolean;
  /** Któryś odczyt odmówił z braku `aal2`. */
  mfaRequired: boolean;
  retry: () => void;
  context: JourneyIssuesContext;
}

/** Akcje kroków przepisu - do ostrzeżenia o nakładaniu (`workflow_overlap`). */
function workflowActions(row: Pick<WorkflowDefinitionRow, "steps">): string[] {
  return parseWorkflowSteps(row.steps).map((step) => step.action);
}

export function useJourneyIssues({
  tenantId,
  journeyId,
  detail,
  draft,
  definition,
  enabled = true,
}: UseJourneyIssuesInput): JourneyIssuesState {
  const hydrated = useHydrated();
  const active = enabled && hydrated && Boolean(tenantId);
  const settingsQuery = useQuery({ ...journeySettingsQueryOptions(tenantId), enabled: active });
  const healthQuery = useQuery({ ...journeyEngineHealthQueryOptions(tenantId), enabled: active });
  const listQuery = useQuery({ ...journeyListQueryOptions(tenantId, null), enabled: active });
  const workflowsQuery = useQuery({ ...workflowDefinitionsQueryOptions(), enabled: active });
  const templateKey = detail?.definition.templateKey ?? null;
  const catalogQuery = useQuery({
    ...journeyTemplateCatalogQueryOptions(tenantId),
    enabled: active && templateKey !== null,
  });

  const settings = settingsQuery.data?.state === "ready" ? settingsQuery.data.data : null;
  const health = healthQuery.data?.state === "ready" ? healthQuery.data.data : null;
  const list = listQuery.data?.state === "ready" ? listQuery.data.data : null;
  const workflows = workflowsQuery.data ?? null;
  const replacesWorkflowTemplate =
    catalogQuery.data?.find((entry) => entry.key === templateKey)?.replacesWorkflowTemplate ?? null;

  const category = definition?.category ?? detail?.definition.category ?? "marketing";
  const legalBasis =
    definition?.legalBasis === undefined
      ? (detail?.definition.legalBasis ?? null)
      : definition.legalBasis;

  const useLocal = draft !== undefined;
  const effectiveDraft: JourneyDraft | null = useLocal
    ? (draft ?? null)
    : detail?.draftValid
      ? detail.draft
      : null;

  const workflowDuplicates = useMemo((): JourneyWorkflowDuplicate[] => {
    if (workflows === null) return [];
    const trigger = effectiveDraft?.settings.triggerEventType ?? null;
    const hasTask = (effectiveDraft?.graph.nodes ?? []).some(
      (node) => node.type === "create_crm_task",
    );
    return workflows.flatMap((row): JourneyWorkflowDuplicate[] => {
      if (!row.enabled) return [];
      if (replacesWorkflowTemplate !== null && row.template_key === replacesWorkflowTemplate) {
        return [{ row, reason: "replace" }];
      }
      const overlaps =
        hasTask &&
        row.trigger_event_type === trigger &&
        workflowActions(row).includes("create_crm_task");
      return overlaps ? [{ row, reason: "overlap" }] : [];
    });
  }, [workflows, effectiveDraft, replacesWorkflowTemplate]);

  const issues = useMemo(() => {
    if (detail === null) return [];
    const issueWorkflows: JourneyIssueWorkflow[] | undefined = workflows?.map((row) => ({
      name: row.name,
      enabled: row.enabled,
      triggerEventType: row.trigger_event_type,
      actions: workflowActions(row),
      templateKey: row.template_key,
    }));
    return collectJourneyIssues({
      draft: useLocal ? draft : detail.draftRaw,
      draftValid: useLocal ? draft !== null : detail.draftValid,
      contents: detail.contents,
      definition: { category, legalBasis, replacesWorkflowTemplate },
      // Ustawienia i zdrowie RAZEM: bez ustawień nie znamy nadawcy, bez
      // zdrowia - wyłącznika awaryjnego (env serwera, nie wiersz bazy).
      engine:
        settings !== null
          ? {
              enabled: settings.enabled,
              killSwitch: health?.killSwitch ?? false,
              senderName: settings.senderName,
            }
          : null,
      workflows: issueWorkflows,
      activeJourneys: (list ?? [])
        .filter((item) => item.status === "active" && item.id !== journeyId)
        .flatMap((item) =>
          item.triggerEventType
            ? [{ name: item.name, triggerEventType: item.triggerEventType }]
            : [],
        ),
      templateMatches: detail.templateMatches,
    });
  }, [
    detail,
    draft,
    useLocal,
    category,
    legalBasis,
    replacesWorkflowTemplate,
    settings,
    health,
    workflows,
    list,
    journeyId,
  ]);

  const contextQueries = [settingsQuery, healthQuery, listQuery];
  const catalogPending = templateKey !== null && catalogQuery.isPending;
  const ready =
    detail !== null &&
    active &&
    contextQueries.every((query) => query.isSuccess) &&
    // Przepisy nie blokują publikacji - zawiedziony odczyt to ostrzeżenie
    // w dialogu, nie wieczne „wczytywanie”.
    !workflowsQuery.isPending &&
    !catalogPending;
  const allQueries = [...contextQueries, workflowsQuery, catalogQuery];

  return {
    issues,
    blockers: publishBlockers(issues),
    counts: issueCounts(issues),
    ready,
    failed: contextQueries.some((query) => query.isError) || catalogQuery.isError,
    mfaRequired: allQueries.some((query) => isMfaRequiredError(query.error)),
    retry: () => {
      for (const query of allQueries) if (query.isError) void query.refetch();
    },
    context: {
      settings,
      health,
      workflows,
      workflowsFailed: workflowsQuery.isError,
      listItem: list?.find((item) => item.id === journeyId) ?? null,
      replacesWorkflowTemplate,
      workflowDuplicates,
    },
  };
}

// ── Lista ────────────────────────────────────────────────────────────────────

export interface JourneyIssuesListProps {
  issues: readonly JourneyIssue[];
  /** Przejście do kroku (kanwa/lista + fokus); bez niego wiersze nie mają przycisku. */
  onFocusNode?: (nodeId: string) => void;
  /** Własny nagłówek (np. odpowiedź serwera po odrzuconej publikacji). */
  title?: string;
  headingLevel?: 2 | 3;
  /** Kontekst jeszcze się wczytuje - lista może urosnąć. */
  loading?: boolean;
}

const SEVERITY_ICON = {
  blocker: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const SEVERITY_LABEL_KEY: Readonly<Record<JourneyIssueSeverity, string>> = {
  blocker: "adminJourneys.issuesList.severity.blocker",
  warning: "adminJourneys.issuesList.severity.warning",
  info: "adminJourneys.issuesList.severity.info",
};

/** Ostrzeżenia, których `detail` to nazwa (przepisu, ścieżki) - reszta to ścieżka pola. */
const NAMED_DETAIL_CODES: ReadonlySet<string> = new Set(["workflow_overlap", "trigger_cycle"]);

export function JourneyIssuesList({
  issues,
  onFocusNode,
  title,
  headingLevel = 2,
  loading = false,
}: JourneyIssuesListProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const counts = issueCounts(issues);

  return (
    <section data-testid="journey-issues" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className="m-0 text-sm font-semibold">
          {title ?? t("adminJourneys.issuesList.title")}
        </Heading>
        <p className="m-0 text-xs text-muted-foreground">
          {[
            t("adminJourneys.issuesList.countBlocker", { value: counts.blocker }),
            t("adminJourneys.issuesList.countWarning", { value: counts.warning }),
            t("adminJourneys.issuesList.countInfo", { value: counts.info }),
          ].join(" · ")}
        </p>
      </div>
      {loading ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.issuesList.loading")}
        </p>
      ) : null}
      {issues.length === 0 && !loading ? (
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("adminJourneys.issuesList.empty")}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="m-0 list-none space-y-1.5 p-0">
          {issues.map((issue) => (
            <IssueRow
              key={`${issue.code}:${issue.nodeId ?? ""}:${JSON.stringify(issue.params)}`}
              issue={issue}
              onFocusNode={onFocusNode}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function IssueRow({
  issue,
  onFocusNode,
}: {
  issue: JourneyIssue;
  onFocusNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const Icon = SEVERITY_ICON[issue.severity];
  const number = issue.number ?? "";
  const where =
    issue.nodeId === undefined
      ? t("adminJourneys.issuesList.wholeJourney")
      : number
        ? t("adminJourneys.issuesList.step", { number })
        : t("adminJourneys.issuesList.stepDetached");
  const detail = issue.params.detail;
  const concerns =
    NAMED_DETAIL_CODES.has(issue.code) && typeof detail === "string" && detail !== ""
      ? t("adminJourneys.issuesList.concerns", { name: detail })
      : null;
  const nodeId = issue.nodeId;

  return (
    <li
      data-severity={issue.severity}
      data-code={issue.code}
      className="flex flex-wrap items-start gap-2 rounded-[6px] border border-border p-2 text-sm"
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${issue.severity === "blocker" ? "text-destructive" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="m-0 text-xs text-muted-foreground">
          <span
            className={
              issue.severity === "blocker" ? "font-medium text-destructive" : "font-medium"
            }
          >
            {t(SEVERITY_LABEL_KEY[issue.severity])}
          </span>
          {" · "}
          <span>{where}</span>
        </p>
        <p className="m-0">{t(issue.labelKey, issue.params)}</p>
        {concerns ? <p className="m-0 text-xs text-muted-foreground">{concerns}</p> : null}
      </div>
      {nodeId !== undefined && onFocusNode ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0"
          onClick={() => onFocusNode(nodeId)}
        >
          {number
            ? t("adminJourneys.issuesList.goToStep", { number })
            : t("adminJourneys.issuesList.goToDetached")}
        </Button>
      ) : null}
    </li>
  );
}
