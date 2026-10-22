// Publikacja ścieżki (S8, SPEC §6.3 „Publikacja”) - admin widzi, co ścieżka
// zrobi, zanim obejmie prawdziwe kontakty.
//
// CO POKAZUJEMY: wyzwalacz z szacunkiem wejść z ostatnich 30 dni, filtr,
// kategorię z podstawą prawną, liczbę maili i politykę wysyłki z ustawień
// silnika (zgoda, limit 7 dni, cisza nocna, nadawca), cel, wyjścia, ponowne
// wejście, stan silnika, przepisy automatyzacji, które ścieżkę dublują, oraz
// problemy (`useJourneyIssues` - ta sama lista co „Sprawdź (n)” w pasku).
//
// BLOKADY PANELU (S8.1 `issues.ts`): treść maila identyczna z szablonem
// i nadawca domyślny nie istnieją w SQL - baza opublikowałaby taką ścieżkę.
// ODCHYLENIE OD SPEC: „nadawca domyślny” to `journey_settings.sender_name`
// NULL (ścieżki wysyłają z `noreply@SENDER_DOMAIN` z nazwą serwisu), nie
// `onboarding@resend.dev`. Dopóki ustawienia silnika się nie wczytały,
// przycisk czeka - nieznana blokada to nie brak blokady.
//
// PUBLIKUJEMY SZKIC Z BAZY. `admin_journey_publish` nie przyjmuje grafu -
// bierze `journey_definitions.draft`. Lokalny szkic edytora trzeba więc
// najpierw zapisać (`flushDraft` = flush autozapisu), a publikacja idzie
// z tokenem z TEGO zapisu (CAS). `draft` w wywołaniu służy tylko walidacji
// grafu w TS przed RPC.
//
// „N KONTAKTÓW KONTYNUUJE WERSJĘ k”: `JourneyListItem.active` (zapisy w toku
// bez testowych) i numer bieżącej wersji. Tryb `drain` (domyślny) zostawia ich
// na starej wersji, `exit_all` kończy ich przejścia od razu.
//
// DEDUPLIKACJA Z PRZEPISAMI: zaznaczone przepisy wyłączamy `useSetWorkflowEnabled`
// DOPIERO po udanej publikacji - odwrotna kolejność przy odrzuconej publikacji
// zostawiłaby kontakty bez żadnej automatyzacji.
//
// ODMOWY JAKO STANY: redaktor -> `RoleGateNotice` (publikuje tylko admin),
// brak `aal2` -> `MfaRequiredNotice`, konflikt CAS -> komunikat + `onConflict`
// (edytor pokazuje różnice), `graph_invalid`/`content_missing` z serwera ->
// lista problemów z numerami kroków.
import { useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { isMfaRequiredError, type JourneyCapabilities } from "@/lib/admin/journeys/access";
import { conditionHash } from "@/lib/admin/journeys/hash";
import { JOURNEY_ISSUE_LABEL_KEY, type JourneyIssue } from "@/lib/admin/journeys/issues";
import type { JourneyDetailDto } from "@/lib/admin/journeys/journeyEditor.functions";
import {
  mutationErrorText,
  usePublishJourney,
  type JourneyMutationFailure,
} from "@/lib/admin/journeys/journeyMutations";
import {
  JOURNEY_CATEGORY_HINT_KEY,
  JOURNEY_CATEGORY_LABEL_KEY,
  JOURNEY_ENGINE_NOTICE_KEY,
  JOURNEY_REENTRY_LABEL_KEY,
  engineHealthNotice,
  translateSummary,
  triggerSentence,
  type JourneyTranslate,
} from "@/lib/admin/journeys/summaries";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { useSetWorkflowEnabled } from "@/lib/admin/workflowQueries";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-publish";
import type { JourneyPublishResult } from "@/lib/journeys/dto";
import type { GraphIssueCode, JourneyDraft } from "@/lib/journeys/graph";
import { journeyLabelKey, journeyTriggerLabelKey } from "@/lib/journeys/labels";
import type { JourneySqlGraphIssueCode } from "@/lib/journeys/labels";
import type { JourneyCategory } from "@/lib/journeys/limits";
import type { JourneyPredicateKind } from "@/lib/journeys/predicates";
import { journeyTriggerEstimateQueryOptions } from "@/lib/journeys/queries";
import { journeyTrigger } from "@/lib/journeys/triggers";
import {
  JourneyIssuesList,
  useJourneyIssues,
  type JourneyIssuesState,
  type JourneyWorkflowDuplicate,
} from "./JourneyIssuesList";

export interface JourneyPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  journeyId: string;
  /** Szczegół z `journeyDetailQueryOptions` (definicja, wersje, treści, flagi szablonu). */
  detail: JourneyDetailDto;
  /** Szkic z sesji edytora (`null` - nie przechodzi schematu; publikacja zablokowana). */
  draft: JourneyDraft | null;
  /** Kategoria i podstawa prawna z arkusza ustawień (jak w `useJourneyIssues`). */
  definition?: { category?: JourneyCategory; legalBasis?: string | null };
  /** Token CAS sesji edytora (`updated_at` szkicu). */
  expectedUpdatedAt: string;
  capabilities: Pick<JourneyCapabilities, "canPublish">;
  /**
   * Zapis lokalnego szkicu przed publikacją (flush autozapisu); oddaje token
   * po zapisie albo `null`, gdy zapis się nie udał (konflikt pokazuje edytor).
   */
  flushDraft?: () => Promise<string | null>;
  onPublished?: (result: JourneyPublishResult) => void;
  /** Konflikt CAS - edytor odświeża szczegół i pokazuje różnice. */
  onConflict?: () => void;
  /** Przejście do kroku z listy problemów - dialog zamyka się sam. */
  onFocusNode?: (nodeId: string) => void;
}

export function JourneyPublishDialog(props: JourneyPublishDialogProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const { open, onOpenChange, capabilities } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="journey-publish-dialog"
        data-tour="journey-publish"
        className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px]"
      >
        <DialogHeader>
          <DialogTitle>{t("adminJourneys.publishDialog.title")}</DialogTitle>
          <DialogDescription>{t("adminJourneys.publishDialog.description")}</DialogDescription>
        </DialogHeader>
        {!open ? null : capabilities.canPublish ? (
          <PublishBody {...props} />
        ) : (
          <RoleGateNotice requiredRole="admin" />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Błąd z `detail` RPC: `[{code, nodeId?}]` (graf) albo `["id", …]` (brak treści). */
function serverIssues(
  failure: JourneyMutationFailure,
  numbering: ReadonlyMap<string, string>,
): JourneyIssue[] | null {
  if (failure.reason !== "graph_invalid" && failure.reason !== "content_missing") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(failure.detail ?? "");
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const issues: JourneyIssue[] = [];
  for (const entry of parsed) {
    if (failure.reason === "content_missing" && typeof entry === "string") {
      issues.push({
        code: "content_missing",
        severity: "blocker",
        nodeId: entry,
        number: numbering.get(entry) ?? "",
        labelKey: JOURNEY_ISSUE_LABEL_KEY.content_missing,
        params: {},
      });
    } else if (failure.reason === "graph_invalid" && typeof entry === "object" && entry) {
      const { code, nodeId } = entry as { code?: unknown; nodeId?: unknown };
      if (typeof code !== "string") continue;
      const id = typeof nodeId === "string" ? nodeId : undefined;
      issues.push({
        code,
        severity: "blocker",
        ...(id ? { nodeId: id, number: numbering.get(id) ?? "" } : {}),
        labelKey: journeyLabelKey("graphIssue", code as GraphIssueCode | JourneySqlGraphIssueCode),
        params: {},
      });
    }
  }
  return issues.length > 0 ? issues : null;
}

function PublishBody({
  onOpenChange,
  tenantId,
  journeyId,
  detail,
  draft,
  definition,
  expectedUpdatedAt,
  flushDraft,
  onPublished,
  onConflict,
  onFocusNode,
}: JourneyPublishDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const state = useJourneyIssues({ tenantId, journeyId, detail, draft, definition });
  const publish = usePublishJourney(tenantId, journeyId);
  const setWorkflowEnabled = useSetWorkflowEnabled();
  const [mode, setMode] = useState<"drain" | "exit_all">("drain");
  const [acknowledged, setAcknowledged] = useState(false);
  // Domyślnie WSZYSTKIE dublujące przepisy do wyłączenia - admin odznacza świadomie.
  const [keepWorkflows, setKeepWorkflows] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [rejected, setRejected] = useState<JourneyIssue[] | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [saving, setSaving] = useState(false);

  if (mfaRequired || state.mfaRequired) return <MfaRequiredNotice />;

  const numbering = buildJourneyView(draft?.graph ?? null).numbering;
  const archived = detail.definition.status === "archived";
  const blockers = state.blockers.length;
  const toDisable = state.context.workflowDuplicates.filter(
    (duplicate) => !keepWorkflows.has(duplicate.row.id),
  );
  const pending = saving || publish.isPending;
  const canSubmit =
    state.ready &&
    !state.failed &&
    draft !== null &&
    blockers === 0 &&
    !archived &&
    acknowledged &&
    !pending;

  const focusNode = onFocusNode
    ? (nodeId: string) => {
        onOpenChange(false);
        onFocusNode(nodeId);
      }
    : undefined;

  const handleFailure = (result: JourneyMutationFailure) => {
    if (result.error === "conflict") {
      setConflict(true);
      onConflict?.();
      return;
    }
    const issues = serverIssues(result, numbering);
    if (issues) setRejected(issues);
    else setFailure(mutationErrorText(t, result));
  };

  const submit = async () => {
    setFailure(null);
    setConflict(false);
    setRejected(null);
    if (!canSubmit || draft === null) return;
    try {
      setSaving(true);
      const token = flushDraft ? await flushDraft() : expectedUpdatedAt;
      setSaving(false);
      if (token === null) {
        setFailure(t("adminJourneys.publishDialog.saveFailed"));
        return;
      }
      const result = await publish.mutateAsync({ expectedUpdatedAt: token, mode, draft });
      if (!result.ok) return handleFailure(result);
      for (const duplicate of toDisable) {
        try {
          await setWorkflowEnabled.mutateAsync({ id: duplicate.row.id, enabled: false });
        } catch {
          toast.warning(
            t("adminJourneys.publishDialog.workflowDisableFailed", { name: duplicate.row.name }),
          );
        }
      }
      toast.success(t("adminJourneys.publishDialog.published", { version: result.data.version }));
      onPublished?.(result.data);
      onOpenChange(false);
    } catch (error) {
      setSaving(false);
      if (isMfaRequiredError(error)) setMfaRequired(true);
      else setFailure(t("adminJourneys.publishDialog.error"));
    }
  };

  const hint = archived
    ? t("adminJourneys.publishDialog.archived")
    : blockers > 0
      ? t("adminJourneys.publishDialog.blocked", { count: blockers })
      : state.ready && !acknowledged
        ? t("adminJourneys.publishDialog.ackRequired")
        : null;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {state.failed ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{t("adminJourneys.publishDialog.loadError")}</span>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={state.retry}>
            {t("adminJourneys.common.retry")}
          </Button>
        </div>
      ) : !state.ready ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.publishDialog.loading")}
        </p>
      ) : null}

      <PublishSummary
        tenantId={tenantId}
        draft={draft}
        category={definition?.category ?? detail.definition.category}
        legalBasis={
          definition?.legalBasis === undefined
            ? detail.definition.legalBasis
            : definition.legalBasis
        }
        state={state}
      />

      {state.context.workflowDuplicates.length > 0 || state.context.workflowsFailed ? (
        <WorkflowDuplicates
          duplicates={state.context.workflowDuplicates}
          failed={state.context.workflowsFailed}
          keep={keepWorkflows}
          onToggle={(workflowId, disable) =>
            setKeepWorkflows((current) => {
              const next = new Set(current);
              if (disable) next.delete(workflowId);
              else next.add(workflowId);
              return next;
            })
          }
        />
      ) : null}

      <JourneyIssuesList
        issues={state.issues}
        onFocusNode={focusNode}
        headingLevel={3}
        loading={!state.ready && !state.failed}
      />

      {detail.versions.length > 0 ? (
        <RunningContacts
          detail={detail}
          active={state.context.listItem?.active ?? null}
          mode={mode}
          onModeChange={setMode}
          name={`${id}-mode`}
        />
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.publishDialog.firstVersion")}
        </p>
      )}

      <div className="flex min-h-6 items-start gap-2">
        <Checkbox
          id={`${id}-ack`}
          className="mt-0.5"
          checked={acknowledged}
          onCheckedChange={(value) => setAcknowledged(value === true)}
        />
        <Label htmlFor={`${id}-ack`} className="text-sm font-normal leading-snug">
          {t("adminJourneys.publishDialog.ack")}
        </Label>
      </div>

      {rejected ? (
        <div role="alert">
          <JourneyIssuesList
            issues={rejected}
            onFocusNode={focusNode}
            headingLevel={3}
            title={t("adminJourneys.publishDialog.serverTitle")}
          />
        </div>
      ) : null}
      {conflict ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {t("adminJourneys.publishDialog.conflict")}
        </p>
      ) : null}
      {failure !== null ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <DialogFooter className="items-center gap-2">
        {hint !== null ? (
          <p id={`${id}-hint`} className="m-0 mr-auto text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("adminJourneys.common.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
          aria-describedby={hint !== null ? `${id}-hint` : undefined}
        >
          {pending
            ? t("adminJourneys.publishDialog.submitting")
            : t("adminJourneys.publishDialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Podsumowanie: co zrobi ścieżka ───────────────────────────────────────────

/** Etykieta zdarzenia celu/wyjścia: z katalogu wyzwalaczy, inaczej sam typ. */
function eventLabel(t: JourneyTranslate, eventType: string): string {
  return journeyTrigger(eventType) ? t(journeyTriggerLabelKey(eventType)) : eventType;
}

function SummaryRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[10rem_1fr]">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="m-0 space-y-0.5 text-sm">{children}</dd>
    </div>
  );
}

function PublishSummary({
  tenantId,
  draft,
  category,
  legalBasis,
  state,
}: {
  tenantId: string | null;
  draft: JourneyDraft | null;
  category: JourneyCategory;
  legalBasis: string | null;
  state: JourneyIssuesState;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const settings = draft?.settings ?? null;
  const condition = settings?.triggerCondition ?? {};
  const trigger = settings?.triggerEventType ?? null;
  const estimate = useQuery({
    ...journeyTriggerEstimateQueryOptions(
      tenantId,
      trigger ?? "",
      condition,
      conditionHash(condition),
    ),
    enabled: Boolean(tenantId) && trigger !== null,
  });
  const engine = state.context.settings;
  const health = state.context.health;
  const emailCount = (draft?.graph.nodes ?? []).filter((node) => node.type === "send_email").length;
  const entryFilter = settings?.entryFilter ?? [];
  const notice = health ? engineHealthNotice(health, Date.now()) : null;

  const estimateText =
    estimate.data?.state === "ready"
      ? t("adminJourneys.publishDialog.estimateValue", {
          count: estimate.data.data.contacts,
          days: estimate.data.data.days,
          events: estimate.data.data.events,
        })
      : estimate.isPending && trigger !== null
        ? t("adminJourneys.publishDialog.estimateLoading")
        : t("adminJourneys.publishDialog.estimateUnavailable");

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="m-0 text-sm font-semibold">
        {t("adminJourneys.publishDialog.summaryTitle")}
      </h3>
      <dl className="m-0 space-y-2 rounded-[6px] border border-border p-3">
        <SummaryRow term={t("adminJourneys.publishDialog.trigger")}>
          <p className="m-0">
            {settings
              ? translateSummary(t, triggerSentence(settings))
              : t("adminJourneys.publishDialog.triggerMissing")}
          </p>
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.estimate")}>
          <p className="m-0" data-testid="journey-publish-estimate">
            {estimateText}
          </p>
          <p className="m-0 text-xs text-muted-foreground">
            {t("adminJourneys.publishDialog.estimateHint")}
          </p>
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.entryFilter")}>
          <p className="m-0">
            {entryFilter.length === 0
              ? t("adminJourneys.publishDialog.entryFilterNone")
              : t("adminJourneys.publishDialog.entryFilterValue", {
                  count: entryFilter.length,
                  list: entryFilter
                    .map((predicate) =>
                      t(journeyLabelKey("predicate", predicate.kind as JourneyPredicateKind)),
                    )
                    .join(", "),
                })}
          </p>
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.category")}>
          <p className="m-0">{t(JOURNEY_CATEGORY_LABEL_KEY[category])}</p>
          <p className="m-0 text-xs text-muted-foreground">
            {t(JOURNEY_CATEGORY_HINT_KEY[category])}
          </p>
          {legalBasis ? (
            <p className="m-0">
              {t("adminJourneys.publishDialog.legalBasis", { text: legalBasis })}
            </p>
          ) : null}
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.emails")}>
          <p className="m-0">
            {emailCount === 0
              ? t("adminJourneys.publishDialog.emailsNone")
              : t("adminJourneys.publishDialog.emailsValue", { count: emailCount })}
          </p>
          {emailCount > 0 ? (
            engine ? (
              <>
                <p className="m-0 text-xs text-muted-foreground">
                  {category === "marketing"
                    ? t("adminJourneys.publishDialog.policyMarketing", {
                        cap: engine.marketingCapPer7d,
                        start: engine.quietStart,
                        end: engine.quietEnd,
                        timezone: engine.timezone,
                      })
                    : t("adminJourneys.publishDialog.policyService")}
                </p>
                <p className="m-0 text-xs text-muted-foreground">
                  {engine.senderName
                    ? t("adminJourneys.publishDialog.sender", { name: engine.senderName })
                    : t("adminJourneys.publishDialog.senderDefault")}
                </p>
              </>
            ) : (
              <p className="m-0 text-xs text-muted-foreground">
                {t("adminJourneys.publishDialog.policyUnknown")}
              </p>
            )
          ) : null}
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.goal")}>
          <p className="m-0">
            {settings?.goal
              ? eventLabel(t, settings.goal.eventType)
              : t("adminJourneys.publishDialog.goalNone")}
          </p>
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.exits")}>
          <p className="m-0">
            {(settings?.exitEvents ?? []).length === 0
              ? t("adminJourneys.publishDialog.exitsNone")
              : (settings?.exitEvents ?? [])
                  .map((exit) => eventLabel(t, exit.eventType))
                  .join(", ")}
          </p>
          {category === "marketing" ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminJourneys.publishDialog.exitUnsubscribe")}
            </p>
          ) : null}
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.reentry")}>
          <p className="m-0">
            {settings?.reentry === "cooldown"
              ? t("adminJourneys.publishDialog.reentryCooldown", {
                  label: t(JOURNEY_REENTRY_LABEL_KEY.cooldown),
                  count: settings.reentryCooldownDays ?? DEFAULT_COOLDOWN_DAYS,
                })
              : t(JOURNEY_REENTRY_LABEL_KEY[settings?.reentry ?? "never"])}
          </p>
        </SummaryRow>
        <SummaryRow term={t("adminJourneys.publishDialog.engine")}>
          <p className="m-0" role={notice ? "status" : undefined}>
            {notice === "errors"
              ? // Zdanie paska listy odsyła do błędów „poniżej” - tu ich nie ma.
                t("adminJourneys.publishDialog.engineErrors")
              : notice
                ? t(JOURNEY_ENGINE_NOTICE_KEY[notice])
                : health
                  ? t("adminJourneys.publishDialog.engineOk")
                  : t("adminJourneys.publishDialog.engineUnknown")}
          </p>
        </SummaryRow>
      </dl>
    </section>
  );
}

/**
 * Karencja, gdy szkic jej nie podał - ta sama wartość, którą wpisuje
 * `admin_journey_publish` (`COALESCE(reentryCooldownDays, 30)`).
 */
const DEFAULT_COOLDOWN_DAYS = 30;

// ── Przepisy automatyzacji dublujące ścieżkę ─────────────────────────────────

const WORKFLOW_REASON_KEY: Readonly<Record<JourneyWorkflowDuplicate["reason"], string>> = {
  replace: "adminJourneys.publishDialog.workflowReason.replace",
  overlap: "adminJourneys.publishDialog.workflowReason.overlap",
};

function WorkflowDuplicates({
  duplicates,
  failed,
  keep,
  onToggle,
}: {
  duplicates: readonly JourneyWorkflowDuplicate[];
  failed: boolean;
  keep: ReadonlySet<string>;
  onToggle: (workflowId: string, disable: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset className="m-0 space-y-2 rounded-[6px] border border-border p-3">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
        <Workflow className="h-4 w-4" aria-hidden="true" />
        {t("adminJourneys.publishDialog.workflows")}
      </legend>
      {failed ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.publishDialog.workflowsFailed")}
        </p>
      ) : (
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.publishDialog.workflowsHint")}
        </p>
      )}
      {duplicates.map(({ row, reason }) => (
        <div key={row.id} className="flex min-h-6 items-start gap-2">
          <Checkbox
            id={`${id}-${row.id}`}
            className="mt-0.5"
            checked={!keep.has(row.id)}
            aria-describedby={`${id}-${row.id}-reason`}
            onCheckedChange={(value) => onToggle(row.id, value === true)}
          />
          <div className="space-y-0.5">
            <Label htmlFor={`${id}-${row.id}`} className="text-sm font-normal leading-snug">
              {t("adminJourneys.publishDialog.workflowDisable", { name: row.name })}
            </Label>
            <p id={`${id}-${row.id}-reason`} className="m-0 text-xs text-muted-foreground">
              {t(WORKFLOW_REASON_KEY[reason])}
            </p>
          </div>
        </div>
      ))}
    </fieldset>
  );
}

// ── Kontakty w toku: drain / exit_all ────────────────────────────────────────

const PUBLISH_MODES = [
  {
    value: "drain",
    labelKey: "adminJourneys.publishDialog.modeDrain",
    hintKey: "adminJourneys.publishDialog.modeDrainHint",
  },
  {
    value: "exit_all",
    labelKey: "adminJourneys.publishDialog.modeExitAll",
    hintKey: "adminJourneys.publishDialog.modeExitAllHint",
  },
] as const;

function RunningContacts({
  detail,
  active,
  mode,
  onModeChange,
  name,
}: {
  detail: JourneyDetailDto;
  active: number | null;
  mode: "drain" | "exit_all";
  onModeChange: (mode: "drain" | "exit_all") => void;
  name: string;
}) {
  const { t } = useTranslation();
  const current =
    detail.versions.find((version) => version.id === detail.definition.publishedVersionId) ??
    detail.versions[0];
  const version = current?.version ?? 0;
  const next = Math.max(0, ...detail.versions.map((entry) => entry.version)) + 1;
  return (
    <fieldset className="m-0 space-y-2 rounded-[6px] border border-border p-3">
      <legend className="px-1 text-sm font-semibold">
        {t("adminJourneys.publishDialog.running")}
      </legend>
      {active !== null ? (
        <p className="m-0 flex items-center gap-2 text-sm" data-testid="journey-publish-continuing">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {t("adminJourneys.publishDialog.continuing", { count: active, version })}
        </p>
      ) : null}
      {PUBLISH_MODES.map(({ value, labelKey, hintKey }) => (
        <label key={value} className="flex min-h-6 cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={value}
            className="mt-1"
            checked={mode === value}
            onChange={() => onModeChange(value)}
          />
          <span className="space-y-0.5">
            <span className="block">{t(labelKey)}</span>
            <span className="block text-xs text-muted-foreground">
              {t(hintKey, { version, next })}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
