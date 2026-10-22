// Panel kroku ścieżki (S8, SPEC §6.3) - `Sheet side="right"` z zakładkami
// Ustawienia | Wyniki | Kontakty sterowanymi adresem (`?node=&tab=`).
//
// KOMPONENT STEROWANY. Stan szkicu trzyma sesja edytora (`editorSession.ts`,
// montuje ją `JourneyEditor`): panel dostaje szkic, numer kroku liczy z tego
// samego `buildJourneyView` co kanwa i lista, a każdą przyjętą zmianę oddaje
// jako NOWY węzeł (`onChangeNode`) z etykietą operacji do historii (cofnij,
// ponów, `aria-live`). Pisanie w jednym polu to jeden wpis historii
// (`coalesceKey` = krok + pole).
//
// FORMULARZE 14 TYPÓW = `NODE_PARAMS_SCHEMAS` S5. Limity pól (czas 5 min-365
// dni, termin zdarzenia ≤ 30 dni, tytuł zadania ≤ 200, tag ≤ 64, wiadomość
// zespołu ≤ 500, lista newslettera wg wzorca) są te same co w walidatorze TS
// i SQL - wartość spoza nich zostaje w polu z komunikatem i NIE trafia do
// szkicu (odrzucenie, nie przycięcie). Węzeł ze szkicu, którego parametry nie
// przechodzą schematu (stary szkic), pokazuje błąd i przycisk „Przywróć
// ustawienia domyślne” - formularz nie udaje, że wartości są poprawne.
//
// CZEKANIE NIE PRZESKAKUJE GAŁĘZI. „Czekaj na zdarzenie” ma dwie gałęzie
// (zdarzenie / minął termin), pozostałe czekania jedną - zmiana rodzaju
// w panelu zostawiłaby graf z niekompletnymi gałęziami. Panel zmienia więc
// rodzaj tylko w obrębie tej samej liczby gałęzi; resztę robi paleta kanwy
// (usuń krok i wstaw nowy).
//
// WYNIKI I KONTAKTY to komponenty S8.2 (`JourneyNodeResults`,
// `JourneyEnrollmentsTable`) - te same zapytania co kanwa i widok „Wyniki”;
// pominięcie czekania jest tam tylko dla admina (`journeyCapabilities`).
import { useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { AlertTriangle, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { JourneyEnrollmentsTable } from "@/components/admin/journeys/results/JourneyEnrollmentsTable";
import { JourneyNodeResults } from "@/components/admin/journeys/results/JourneyNodeResults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlatformSelect } from "@/components/ui/platform-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimeInput } from "@/components/ui/time-input";
import type { JourneyCapabilities } from "@/lib/admin/journeys/access";
import type { JourneyUpdateOptions } from "@/lib/admin/journeys/editorSession";
import type { JourneyEmailContentDto } from "@/lib/admin/journeys/journeyEditor.functions";
import { DEFAULT_WAIT_EVENT, defaultParams, waitUntilEventParams } from "@/lib/admin/journeys/ops";
import {
  describeNode,
  durationSummary,
  translateSummary,
  triggerSentence,
} from "@/lib/admin/journeys/summaries";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { BILLING_OWNED_LIFECYCLE_STAGES, LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { crmStaffUsersQueryOptions } from "@/lib/crm/leadMutations";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-steps";
import {
  NODE_PARAMS_SCHEMAS,
  ancestorsOf,
  validateJourneyGraph,
  type JourneyDraft,
  type JourneyNode,
} from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_LIMITS } from "@/lib/journeys/limits";
import { requiredBranches } from "@/lib/journeys/nodeTypes";
import { CRM_STAGES, type JourneyPredicate } from "@/lib/journeys/predicates";
import { journeySettingsQueryOptions } from "@/lib/journeys/queries";
import type { JourneyEditorTab } from "@/lib/journeys/editorSearch";
import type { RevenuePeriod } from "@/lib/revenue/search";
import { EmailStepEditor } from "./EmailStepEditor";
import {
  BufferedIntField,
  BufferedTextField,
  CheckGroup,
  ConditionFields,
  PredicateList,
  SheetField,
  TriggerEventSelect,
  describedBy,
  emailNodeOptions,
  useFormBuffer,
} from "./PredicateRow";

/** Szkic z podmienionym węzłem (ten sam `id`) - przepis dla `session.updateDraft`. */
export function replaceJourneyNode(draft: JourneyDraft, node: JourneyNode): JourneyDraft {
  return {
    ...draft,
    graph: {
      ...draft.graph,
      nodes: draft.graph.nodes.map((current) => (current.id === node.id ? node : current)),
    },
  };
}

export interface JourneyStepSheetProps {
  /** Panel otwarty (`?node=` w adresie). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journeyId: string;
  tenantId: string | null;
  /** Szkic z sesji edytora (`session.draft`). */
  draft: JourneyDraft;
  nodeId: string;
  /** Zakładka z adresu (`?tab=`, domyślnie `settings`). */
  tab: JourneyEditorTab;
  onTabChange: (tab: JourneyEditorTab) => void;
  /** `journeyCapabilities(roles)` - bez `canEdit` panel jest podglądem. */
  capabilities: JourneyCapabilities;
  /** `session.editable` (konflikt, podgląd wersji, archiwum = tylko odczyt). */
  editable: boolean;
  /** Treści maili szkicu (`detail.contents`). */
  contents: readonly JourneyEmailContentDto[];
  /** `detail.templateMatches` - wariant A nadal identyczny z szablonem. */
  templateMatches?: Readonly<Record<string, boolean>>;
  /** `session.ensureNodeSaved` - flush szkicu przed pierwszym zapisem treści maila. */
  ensureNodeSaved: (nodeId: string) => Promise<boolean>;
  /** Przyjęta zmiana kroku - edytor woła `session.updateDraft(d => replaceJourneyNode(d, node), options)`. */
  onChangeNode: (node: JourneyNode, options: JourneyUpdateOptions) => void;
  /** Krok wyzwalacza otwiera arkusz wyzwalacza. */
  onOpenTrigger?: () => void;
  /** Okno statystyk zakładki „Wyniki” (`?stats=`, bez `off`). */
  statsPeriod?: RevenuePeriod;
  /** Wersja oglądana w wynikach (`null` = wszystkie wersje w oknie). */
  versionId?: string | null;
}

export function JourneyStepSheet(props: JourneyStepSheetProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const { draft, nodeId, tab } = props;
  const view = useMemo(() => buildJourneyView(draft.graph), [draft.graph]);
  const node = draft.graph.nodes.find((candidate) => candidate.id === nodeId) ?? null;
  const number = view.numbering.get(nodeId) ?? "";
  const subject =
    props.contents.find((c) => c.nodeId === nodeId && c.variant === "A")?.subjectPl ?? null;
  const title = node
    ? t("adminJourneys.stepSheet.title", {
        number: number || "-",
        type: t(journeyLabelKey("nodeType", node.type)),
      })
    : t("adminJourneys.stepSheet.missingTitle");
  const description = node
    ? translateSummary(t, describeNode(node, { subject, settings: draft.settings }))
    : t("adminJourneys.stepSheet.missing");

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        data-testid="journey-step-sheet"
        data-node-id={nodeId}
        data-tab={tab}
      >
        <SheetHeader className="pr-6">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {node ? (
          <Tabs
            value={tab}
            onValueChange={(next) => props.onTabChange(next as JourneyEditorTab)}
            className="mt-4"
          >
            <TabsList aria-label={t("adminJourneys.stepSheet.tabs.label")}>
              <TabsTrigger value="settings">
                {t("adminJourneys.stepSheet.tabs.settings")}
              </TabsTrigger>
              <TabsTrigger value="results">{t("adminJourneys.stepSheet.tabs.results")}</TabsTrigger>
              <TabsTrigger value="contacts">
                {t("adminJourneys.stepSheet.tabs.contacts")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="settings">
              <StepSettings {...props} node={node} number={number} />
            </TabsContent>
            <TabsContent value="results">
              <JourneyNodeResults
                journeyId={props.journeyId}
                nodeId={nodeId}
                versionId={props.versionId ?? null}
                period={props.statsPeriod}
              />
            </TabsContent>
            <TabsContent value="contacts">
              <JourneyEnrollmentsTable journeyId={props.journeyId} nodeId={nodeId} />
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Zdanie „co się stanie z kontaktem” - te same klucze co paleta kanwy. */
function effectKey(node: JourneyNode): string {
  if (node.type === "wait") {
    const mode = (node.params as { mode?: unknown } | undefined)?.mode;
    const id =
      mode === "until_time"
        ? "wait_until_time"
        : mode === "until_event"
          ? "wait_until_event"
          : "wait_duration";
    return `adminJourneys.common.effect.${id}`;
  }
  if (node.type === "trigger") return "adminJourneys.stepSheet.triggerEffect";
  return `adminJourneys.common.effect.${node.type}`;
}

/** Parametry startowe przy naprawie: czekanie zachowuje liczbę gałęzi. */
function repairParams(node: JourneyNode): unknown {
  if (node.type === "wait" && requiredBranches("wait", node.params).includes("event")) {
    return waitUntilEventParams();
  }
  return defaultParams(node.type);
}

interface FormProps<P> {
  id: string;
  params: P;
  disabled: boolean;
  /** Zapytania pomocnicze (zespół, ustawienia silnika) - tylko z najemcą. */
  tenantId: string | null;
  commit: (params: unknown, field: string) => void;
}

function StepSettings(props: JourneyStepSheetProps & { node: JourneyNode; number: string }) {
  const { t } = useTranslation();
  const { node, number, draft, capabilities } = props;
  const id = useId();
  const canChange = capabilities.canEdit && props.editable;
  const disabled = !canChange;
  const parsed = NODE_PARAMS_SCHEMAS[node.type].safeParse(node.params ?? {});
  const issues = useMemo(
    () =>
      validateJourneyGraph(draft.graph, {
        triggerEventType: draft.settings.triggerEventType,
      }).errors.filter((issue) => issue.nodeId === node.id),
    [draft.graph, draft.settings.triggerEventType, node.id],
  );

  const commit = (params: unknown, field: string) => {
    if (!canChange) return;
    props.onChangeNode(
      { ...node, params },
      {
        label: t("adminJourneys.stepSheet.history", { number: number || "-" }),
        coalesceKey: `step:${node.id}:${field}`,
      },
    );
  };

  const form = (): ReactNode => {
    if (!parsed.success) return null;
    const common = { id, disabled, commit, tenantId: props.tenantId };
    switch (node.type) {
      case "trigger":
        return <TriggerPanel settings={draft.settings} onOpenTrigger={props.onOpenTrigger} />;
      case "wait":
        return <WaitForm {...common} params={parsed.data as WaitParams} />;
      case "send_email":
        return (
          <EmailStepEditor
            journeyId={props.journeyId}
            tenantId={props.tenantId}
            nodeId={node.id}
            graph={draft.graph}
            triggerEventType={draft.settings.triggerEventType}
            contents={props.contents}
            templateMatches={props.templateMatches}
            editable={canChange}
            ensureNodeSaved={props.ensureNodeSaved}
          />
        );
      case "ab_split":
        return (
          <AbSplitForm
            {...common}
            params={parsed.data as AbParams}
            hasGoal={Boolean(draft.settings.goal)}
          />
        );
      case "if_else":
        return (
          <IfElseForm
            {...common}
            params={parsed.data as IfElseParams}
            node={node}
            draft={draft}
            contents={props.contents}
          />
        );
      case "set_lifecycle_stage":
        return <LifecycleForm {...common} params={parsed.data as { stage: string }} />;
      case "set_crm_stage":
        return <CrmStageForm {...common} params={parsed.data as CrmStageParams} />;
      case "create_crm_task":
        return <TaskForm {...common} params={parsed.data as TaskParams} />;
      case "add_tag":
      case "remove_tag":
        return <TagForm {...common} params={parsed.data as { tag: string }} />;
      case "newsletter_list":
        return <NewsletterForm {...common} params={parsed.data as NewsletterParams} />;
      case "notify_staff":
        return <NotifyForm {...common} params={parsed.data as NotifyParams} />;
      case "goal":
        return <GoalForm {...common} params={parsed.data as { label?: string }} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4" data-testid="journey-step-settings" data-node-type={node.type}>
      {!canChange ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {capabilities.canEdit
            ? t("adminJourneys.stepSheet.readOnly")
            : t("adminJourneys.stepSheet.roleReadOnly")}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">{t(effectKey(node))}</p>
      {issues.length > 0 ? (
        <ul className="space-y-1" aria-label={t("adminJourneys.stepSheet.issues")}>
          {issues.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              className="flex items-start gap-1.5 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t(journeyLabelKey("graphIssue", issue.code))}
            </li>
          ))}
        </ul>
      ) : null}
      {!parsed.success ? (
        <div className="space-y-2 rounded-[6px] border border-border p-3">
          <p className="text-sm">{t("adminJourneys.stepSheet.paramsInvalid")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => commit(repairParams(node), "repair")}
          >
            {t("adminJourneys.stepSheet.repair")}
          </Button>
        </div>
      ) : (
        form()
      )}
    </div>
  );
}

// ── Wyzwalacz ───────────────────────────────────────────────────────────────

function TriggerPanel({
  settings,
  onOpenTrigger,
}: {
  settings: JourneyDraft["settings"];
  onOpenTrigger?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-sm">{translateSummary(t, triggerSentence(settings))}</p>
      {onOpenTrigger ? (
        <Button type="button" variant="outline" size="sm" onClick={onOpenTrigger}>
          {t("adminJourneys.stepSheet.openTrigger")}
        </Button>
      ) : null}
    </div>
  );
}

// ── Czekanie ────────────────────────────────────────────────────────────────

type WaitParams =
  | { mode: "duration"; minutes: number }
  | { mode: "until_time"; weekdays: number[]; time: string }
  | {
      mode: "until_event";
      eventType: string;
      condition: Record<string, string | number | boolean>;
      timeoutMinutes: number;
    };

/** Domyślne parametry rodzaju czekania - te same co paleta kanwy. */
const WAIT_DEFAULTS = {
  duration: { mode: "duration", minutes: 24 * 60 },
  until_time: { mode: "until_time", weekdays: [1, 2, 3, 4, 5], time: "09:00" },
} as const;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function WaitForm({ id, params, disabled, commit, tenantId }: FormProps<WaitParams>) {
  const { t } = useTranslation();
  const modeId = `${id}-mode`;
  const branching = params.mode === "until_event";
  return (
    <div className="space-y-4">
      <SheetField
        id={modeId}
        label={t("adminJourneys.stepSheet.wait.mode")}
        hint={t("adminJourneys.stepSheet.wait.modeHint")}
      >
        <PlatformSelect
          id={modeId}
          value={params.mode}
          disabled={disabled}
          aria-describedby={`${modeId}-hint`}
          onChange={(event) => {
            const mode = event.target.value as "duration" | "until_time";
            if (mode === params.mode) return;
            commit(WAIT_DEFAULTS[mode], "mode");
          }}
        >
          <option value="duration" disabled={branching}>
            {t("adminJourneys.common.palette.waitDuration")}
          </option>
          <option value="until_time" disabled={branching}>
            {t("adminJourneys.common.palette.waitUntilTime")}
          </option>
          <option value="until_event" disabled={!branching}>
            {t("adminJourneys.common.palette.waitUntilEvent")}
          </option>
        </PlatformSelect>
      </SheetField>
      {params.mode === "duration" ? (
        <DurationField
          id={`${id}-minutes`}
          label={t("adminJourneys.stepSheet.wait.duration")}
          minutes={params.minutes}
          min={JOURNEY_LIMITS.waitMinutesMin}
          max={JOURNEY_LIMITS.waitMinutesMax}
          disabled={disabled}
          onCommit={(minutes) => commit({ mode: "duration", minutes }, "minutes")}
        />
      ) : null}
      {params.mode === "until_time" ? (
        <UntilTimeFields
          id={id}
          params={params}
          disabled={disabled}
          commit={commit}
          tenantId={tenantId}
        />
      ) : null}
      {params.mode === "until_event" ? (
        <div className="space-y-4">
          <SheetField
            id={`${id}-event`}
            label={t("adminJourneys.stepSheet.wait.event")}
            hint={t("adminJourneys.stepSheet.wait.eventHint")}
          >
            <TriggerEventSelect
              id={`${id}-event`}
              value={params.eventType}
              disabled={disabled}
              ariaDescribedBy={`${id}-event-hint`}
              onChange={(eventType) =>
                commit(
                  { ...params, eventType: eventType || DEFAULT_WAIT_EVENT, condition: {} },
                  "event",
                )
              }
            />
          </SheetField>
          <ConditionFields
            idPrefix={`${id}-condition`}
            eventType={params.eventType}
            value={params.condition}
            disabled={disabled}
            onCommit={(condition) => commit({ ...params, condition }, "condition")}
          />
          <DurationField
            id={`${id}-timeout`}
            label={t("adminJourneys.stepSheet.wait.timeout")}
            hint={t("adminJourneys.stepSheet.wait.timeoutHint")}
            minutes={params.timeoutMinutes}
            min={JOURNEY_LIMITS.waitMinutesMin}
            max={JOURNEY_LIMITS.untilEventTimeoutMaxMinutes}
            disabled={disabled}
            onCommit={(timeoutMinutes) => commit({ ...params, timeoutMinutes }, "timeout")}
          />
        </div>
      ) : null}
    </div>
  );
}

function UntilTimeFields({
  id,
  params,
  disabled,
  commit,
  tenantId,
}: {
  id: string;
  params: Extract<WaitParams, { mode: "until_time" }>;
  disabled: boolean;
  commit: (params: unknown, field: string) => void;
  tenantId: string | null;
}) {
  const { t } = useTranslation();
  const timeId = `${id}-time`;
  const hydrated = useHydrated();
  const engine = useQuery({
    ...journeySettingsQueryOptions(tenantId),
    enabled: hydrated && Boolean(tenantId),
  });
  const timezone = engine.data?.state === "ready" ? engine.data.data.timezone : null;
  const {
    form: time,
    setForm: setTime,
    markCommitted,
  } = useFormBuffer(params.time, () => params.time);
  const [weekdayError, setWeekdayError] = useState(false);
  const timeError = TIME_RE.test(time) ? null : t("adminJourneys.sheetField.error.time");
  return (
    <div className="space-y-4">
      <CheckGroup
        id={`${id}-weekdays`}
        legend={t("adminJourneys.stepSheet.wait.weekdays")}
        options={WEEKDAYS.map((day) => ({
          value: String(day),
          label: t(`adminJourneys.stepSheet.weekday.${day}`),
        }))}
        value={params.weekdays.map(String)}
        disabled={disabled}
        error={weekdayError ? t("adminJourneys.sheetField.error.pickOne") : null}
        onChange={(next) => {
          // Ostatni dzień zostaje zaznaczony: czekanie bez dni nie ma końca.
          if (next.length === 0) {
            setWeekdayError(true);
            return;
          }
          setWeekdayError(false);
          const weekdays = next.map(Number).sort((a, b) => a - b);
          commit({ ...params, weekdays }, "weekdays");
        }}
      />
      <SheetField
        id={timeId}
        label={t("adminJourneys.stepSheet.wait.time")}
        hint={
          timezone
            ? t("adminJourneys.stepSheet.wait.timeZone", { timezone })
            : t("adminJourneys.stepSheet.wait.timeZoneUnknown")
        }
        error={timeError}
      >
        <TimeInput
          id={timeId}
          value={time}
          disabled={disabled}
          required
          aria-invalid={timeError ? true : undefined}
          aria-describedby={describedBy(`${timeId}-hint`, timeError && `${timeId}-error`)}
          onChange={(event) => {
            const next = event.target.value.slice(0, 5);
            setTime(next);
            if (!TIME_RE.test(next) || next === params.time) return;
            markCommitted(next);
            commit({ ...params, time: next }, "time");
          }}
        />
      </SheetField>
    </div>
  );
}

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 24 * 60 } as const;
type DurationUnit = keyof typeof UNIT_MINUTES;

/** Największa jednostka, w której czas jest całkowity (jak opis kroku na kanwie). */
function unitFor(minutes: number): DurationUnit {
  if (minutes % UNIT_MINUTES.days === 0) return "days";
  if (minutes % UNIT_MINUTES.hours === 0) return "hours";
  return "minutes";
}

/**
 * Czas w minutach jako liczba + jednostka. Zakres (np. 5 min - 365 dni)
 * sprawdzamy na minutach - te same granice co schemat czekania i SQL.
 */
function DurationField({
  id,
  label,
  hint,
  minutes,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  minutes: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (minutes: number) => void;
}) {
  const { t } = useTranslation();
  const { form, setForm, markCommitted } = useFormBuffer(minutes, () => {
    const unit = unitFor(minutes);
    return { amount: String(minutes / UNIT_MINUTES[unit]), unit };
  });
  const total = /^\d+$/.test(form.amount.trim())
    ? Number(form.amount.trim()) * UNIT_MINUTES[form.unit]
    : Number.NaN;
  const valid = Number.isSafeInteger(total) && total >= min && total <= max;
  const error = valid
    ? null
    : t("adminJourneys.sheetField.error.durationRange", {
        min: translateSummary(t, durationSummary(min, "plain")),
        max: translateSummary(t, durationSummary(max, "plain")),
      });
  const update = (next: { amount: string; unit: DurationUnit }) => {
    setForm(next);
    const value = /^\d+$/.test(next.amount.trim())
      ? Number(next.amount.trim()) * UNIT_MINUTES[next.unit]
      : Number.NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max || value === minutes) return;
    markCommitted(value);
    onCommit(value);
  };
  return (
    <SheetField id={id} label={label} hint={hint} error={error}>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          value={form.amount}
          disabled={disabled}
          required
          className="min-w-0 flex-1 tabular-nums"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
          onChange={(event) => update({ ...form, amount: event.target.value })}
        />
        <PlatformSelect
          value={form.unit}
          disabled={disabled}
          className="w-32 shrink-0"
          aria-label={t("adminJourneys.stepSheet.wait.unit", { field: label })}
          onChange={(event) => update({ ...form, unit: event.target.value as DurationUnit })}
        >
          {(Object.keys(UNIT_MINUTES) as DurationUnit[]).map((unit) => (
            <option key={unit} value={unit}>
              {t(`adminJourneys.stepSheet.unit.${unit}`)}
            </option>
          ))}
        </PlatformSelect>
      </div>
    </SheetField>
  );
}

// ── Logika ──────────────────────────────────────────────────────────────────

interface AbParams {
  weights: { A: number; B: number };
  winnerMetric: "goal" | "click";
}

function AbSplitForm({
  id,
  params,
  disabled,
  commit,
  hasGoal,
}: FormProps<AbParams> & { hasGoal: boolean }) {
  const { t } = useTranslation();
  const metricId = `${id}-metric`;
  const goalMissing = params.winnerMetric === "goal" && !hasGoal;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("adminJourneys.stepSheet.ab.weightsHint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <BufferedIntField
          id={`${id}-a`}
          label={t("adminJourneys.stepSheet.ab.weightA")}
          value={params.weights.A}
          min={0}
          max={100}
          disabled={disabled}
          onCommit={(value) =>
            commit({ ...params, weights: { A: value ?? 0, B: 100 - (value ?? 0) } }, "weights")
          }
        />
        <BufferedIntField
          id={`${id}-b`}
          label={t("adminJourneys.stepSheet.ab.weightB")}
          value={params.weights.B}
          min={0}
          max={100}
          disabled={disabled}
          onCommit={(value) =>
            commit({ ...params, weights: { A: 100 - (value ?? 0), B: value ?? 0 } }, "weights")
          }
        />
      </div>
      <SheetField
        id={metricId}
        label={t("adminJourneys.stepSheet.ab.metric")}
        hint={t("adminJourneys.stepSheet.ab.metricHint")}
        error={goalMissing ? t("adminJourneys.stepSheet.ab.goalMissing") : null}
      >
        <PlatformSelect
          id={metricId}
          value={params.winnerMetric}
          disabled={disabled}
          aria-describedby={describedBy(`${metricId}-hint`, goalMissing && `${metricId}-error`)}
          onChange={(event) =>
            commit(
              { ...params, winnerMetric: event.target.value === "goal" ? "goal" : "click" },
              "metric",
            )
          }
        >
          <option value="click">{t("adminJourneys.stepSheet.ab.metricClick")}</option>
          <option value="goal">{t("adminJourneys.stepSheet.ab.metricGoal")}</option>
        </PlatformSelect>
      </SheetField>
    </div>
  );
}

interface IfElseParams {
  match: "all" | "any";
  predicates: JourneyPredicate[];
}

function IfElseForm({
  id,
  params,
  disabled,
  commit,
  node,
  draft,
  contents,
}: FormProps<IfElseParams> & {
  node: JourneyNode;
  draft: JourneyDraft;
  contents: readonly JourneyEmailContentDto[];
}) {
  const { t } = useTranslation();
  const matchId = `${id}-match`;
  // Otwarcie/kliknięcie wolno sprawdzać tylko dla maila wysłanego WCZEŚNIEJ na
  // tej drodze (przodek) - inaczej warunek czytałby wiadomość, której kontakt
  // jeszcze nie dostał (`predicate_not_ancestor_email`).
  const emailNodes = useMemo(
    () => emailNodeOptions(t, draft.graph, contents, ancestorsOf(draft.graph, node.id)),
    [t, draft.graph, contents, node.id],
  );
  return (
    <div className="space-y-4">
      <SheetField id={matchId} label={t("adminJourneys.stepSheet.ifElse.match")}>
        <PlatformSelect
          id={matchId}
          value={params.match}
          disabled={disabled}
          onChange={(event) =>
            commit({ ...params, match: event.target.value === "any" ? "any" : "all" }, "match")
          }
        >
          <option value="all">{t("adminJourneys.stepSheet.ifElse.all")}</option>
          <option value="any">{t("adminJourneys.stepSheet.ifElse.any")}</option>
        </PlatformSelect>
      </SheetField>
      <PredicateList
        id={`${id}-predicates`}
        legend={t("adminJourneys.stepSheet.ifElse.predicates")}
        hint={t("adminJourneys.stepSheet.ifElse.predicatesHint")}
        value={params.predicates}
        min={1}
        max={20}
        context={{ emailNodes, triggerEventType: draft.settings.triggerEventType }}
        disabled={disabled}
        onCommit={(predicates) => commit({ ...params, predicates }, "predicates")}
      />
    </div>
  );
}

// ── Akcje CRM ───────────────────────────────────────────────────────────────

function LifecycleForm({ id, params, disabled, commit }: FormProps<{ stage: string }>) {
  const { t } = useTranslation();
  const stageId = `${id}-stage`;
  return (
    <SheetField
      id={stageId}
      label={t("adminJourneys.stepSheet.lifecycle.stage")}
      hint={t("adminCrm.lifecycle.change.billingOwned")}
    >
      <PlatformSelect
        id={stageId}
        value={params.stage}
        disabled={disabled}
        aria-describedby={`${stageId}-hint`}
        onChange={(event) => commit({ stage: event.target.value }, "stage")}
      >
        {LIFECYCLE_STAGES.filter(
          (stage) => !(BILLING_OWNED_LIFECYCLE_STAGES as readonly string[]).includes(stage),
        ).map((stage) => (
          <option key={stage} value={stage}>
            {t(`adminCrm.lifecycle.stages.${stage}`)}
          </option>
        ))}
      </PlatformSelect>
    </SheetField>
  );
}

interface CrmStageParams {
  stage: string;
  onlyForward: boolean;
}

function CrmStageForm({ id, params, disabled, commit }: FormProps<CrmStageParams>) {
  const { t } = useTranslation();
  const stageId = `${id}-stage`;
  const forwardId = `${id}-forward`;
  return (
    <div className="space-y-4">
      <SheetField id={stageId} label={t("adminJourneys.stepSheet.crmStage.stage")}>
        <PlatformSelect
          id={stageId}
          value={params.stage}
          disabled={disabled}
          onChange={(event) => commit({ ...params, stage: event.target.value }, "stage")}
        >
          {CRM_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {t(`adminCrm.lifecycle.crmStages.${stage}`)}
            </option>
          ))}
        </PlatformSelect>
      </SheetField>
      <SwitchRow
        id={forwardId}
        label={t("adminJourneys.stepSheet.crmStage.onlyForward")}
        hint={t("adminJourneys.stepSheet.crmStage.onlyForwardHint")}
        checked={params.onlyForward}
        disabled={disabled}
        onChange={(onlyForward) => commit({ ...params, onlyForward }, "forward")}
      />
    </div>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={onChange}
      />
    </div>
  );
}

interface TaskParams {
  title: string;
  description?: string;
  dueInDays: number;
  assignee: { mode: "owner_or_default" } | { mode: "user"; userId: string };
}

/** Zespół CRM do wyboru osoby - po hydratacji i tylko z najemcą (sesja). */
function useStaff(tenantId: string | null) {
  const hydrated = useHydrated();
  const enabled = hydrated && tenantId !== null;
  const query = useQuery({ ...crmStaffUsersQueryOptions(), enabled });
  return { staff: query.data ?? [], isPending: query.isPending && enabled, isError: query.isError };
}

function TaskForm({ id, params, disabled, commit, tenantId }: FormProps<TaskParams>) {
  const { t } = useTranslation();
  const assigneeId = `${id}-assignee`;
  const userId = `${id}-user`;
  const { staff, isPending, isError } = useStaff(tenantId);
  // „Wybrana osoba” bez osoby nie przejdzie schematu - tryb czeka lokalnie,
  // aż administrator wskaże kogoś z zespołu.
  const { form: mode, setForm: setMode } = useFormBuffer(
    params.assignee,
    () => params.assignee.mode,
  );
  const selectedUser = params.assignee.mode === "user" ? params.assignee.userId : "";
  const userMissing = mode === "user" && selectedUser === "";
  const staffHint = isPending
    ? t("adminJourneys.stepSheet.staff.loading")
    : isError
      ? t("adminJourneys.stepSheet.staff.error")
      : undefined;
  return (
    <div className="space-y-4">
      <BufferedTextField
        id={`${id}-title`}
        label={t("adminJourneys.stepSheet.task.title")}
        value={params.title}
        min={1}
        max={JOURNEY_LIMITS.taskTitleMax}
        disabled={disabled}
        onCommit={(title) => commit({ ...params, title }, "title")}
      />
      <BufferedTextField
        id={`${id}-description`}
        label={t("adminJourneys.stepSheet.task.description")}
        value={params.description ?? ""}
        max={JOURNEY_LIMITS.descriptionMax}
        multiline
        disabled={disabled}
        onCommit={(description) => {
          const { description: _drop, ...rest } = params;
          commit(description ? { ...rest, description } : rest, "description");
        }}
      />
      <BufferedIntField
        id={`${id}-due`}
        label={t("adminJourneys.stepSheet.task.dueInDays")}
        hint={t("adminJourneys.stepSheet.task.dueInDaysHint")}
        value={params.dueInDays}
        min={0}
        max={JOURNEY_LIMITS.taskDueDaysMax}
        disabled={disabled}
        onCommit={(dueInDays) => commit({ ...params, dueInDays: dueInDays ?? 0 }, "due")}
      />
      <SheetField id={assigneeId} label={t("adminJourneys.stepSheet.task.assignee")}>
        <PlatformSelect
          id={assigneeId}
          value={mode}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value === "user") {
              setMode("user");
              return;
            }
            setMode("owner_or_default");
            commit({ ...params, assignee: { mode: "owner_or_default" } }, "assignee");
          }}
        >
          <option value="owner_or_default">
            {t("adminJourneys.stepSheet.task.assigneeOwner")}
          </option>
          <option value="user">{t("adminJourneys.stepSheet.task.assigneeUser")}</option>
        </PlatformSelect>
      </SheetField>
      {mode === "user" ? (
        <SheetField
          id={userId}
          label={t("adminJourneys.stepSheet.task.user")}
          hint={staffHint}
          error={userMissing ? t("adminJourneys.sheetField.error.pickOne") : null}
        >
          <PlatformSelect
            id={userId}
            value={selectedUser}
            disabled={disabled}
            placeholder={t("adminJourneys.stepSheet.staff.pick")}
            aria-invalid={userMissing ? true : undefined}
            aria-describedby={describedBy(
              staffHint && `${userId}-hint`,
              userMissing && `${userId}-error`,
            )}
            onChange={(event) =>
              commit(
                { ...params, assignee: { mode: "user", userId: event.target.value } },
                "assignee",
              )
            }
          >
            {selectedUser && !staff.some((person) => person.id === selectedUser) ? (
              <option value={selectedUser}>{t("adminJourneys.stepSheet.staff.outside")}</option>
            ) : null}
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </PlatformSelect>
        </SheetField>
      ) : null}
    </div>
  );
}

function TagForm({ id, params, disabled, commit }: FormProps<{ tag: string }>) {
  const { t } = useTranslation();
  return (
    <BufferedTextField
      id={`${id}-tag`}
      label={t("adminJourneys.stepSheet.tag.label")}
      hint={t("adminJourneys.stepSheet.tag.hint")}
      value={params.tag}
      min={1}
      max={JOURNEY_LIMITS.tagMax}
      disabled={disabled}
      onCommit={(tag) => commit({ tag }, "tag")}
    />
  );
}

interface NewsletterParams {
  op: "add" | "remove";
  listKey: string;
}

/** Klucz listy newslettera - wzorzec `NODE_PARAMS_SCHEMAS.newsletter_list`. */
const LIST_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function NewsletterForm({ id, params, disabled, commit }: FormProps<NewsletterParams>) {
  const { t } = useTranslation();
  const opId = `${id}-op`;
  return (
    <div className="space-y-4">
      <SheetField id={opId} label={t("adminJourneys.stepSheet.newsletter.op")}>
        <PlatformSelect
          id={opId}
          value={params.op}
          disabled={disabled}
          onChange={(event) =>
            commit({ ...params, op: event.target.value === "remove" ? "remove" : "add" }, "op")
          }
        >
          <option value="add">{t("adminJourneys.stepSheet.newsletter.add")}</option>
          <option value="remove">{t("adminJourneys.stepSheet.newsletter.remove")}</option>
        </PlatformSelect>
      </SheetField>
      <BufferedTextField
        id={`${id}-list`}
        label={t("adminJourneys.stepSheet.newsletter.listKey")}
        hint={t("adminJourneys.stepSheet.newsletter.listKeyHint")}
        value={params.listKey}
        min={1}
        max={64}
        pattern={LIST_KEY_RE}
        patternKey="adminJourneys.sheetField.error.listKey"
        mono
        disabled={disabled}
        onCommit={(listKey) => commit({ ...params, listKey }, "listKey")}
      />
    </div>
  );
}

interface NotifyParams {
  recipients: "owner" | "admins" | { userIds: string[] };
  message: string;
}

/** Najwięcej osób w powiadomieniu (`notify_staff.recipients.userIds` ≤ 20). */
const NOTIFY_USERS_MAX = 20;

function NotifyForm({ id, params, disabled, commit, tenantId }: FormProps<NotifyParams>) {
  const { t } = useTranslation();
  const recipientsId = `${id}-recipients`;
  const { staff, isPending, isError } = useStaff(tenantId);
  const initial = () =>
    typeof params.recipients === "string"
      ? { mode: params.recipients, userIds: [] as string[] }
      : { mode: "users" as const, userIds: params.recipients.userIds };
  const { form, setForm, markCommitted } = useFormBuffer(params.recipients, initial);
  const usersError =
    form.mode === "users" && (form.userIds.length < 1 || form.userIds.length > NOTIFY_USERS_MAX)
      ? t("adminJourneys.sheetField.error.listCount", { min: 1, max: NOTIFY_USERS_MAX })
      : null;
  const update = (next: { mode: "owner" | "admins" | "users"; userIds: string[] }) => {
    setForm(next);
    if (next.mode !== "users") {
      markCommitted(next.mode);
      commit({ ...params, recipients: next.mode }, "recipients");
      return;
    }
    if (next.userIds.length < 1 || next.userIds.length > NOTIFY_USERS_MAX) return;
    const recipients = { userIds: next.userIds };
    markCommitted(recipients);
    commit({ ...params, recipients }, "recipients");
  };
  return (
    <div className="space-y-4">
      <SheetField id={recipientsId} label={t("adminJourneys.stepSheet.notify.recipients")}>
        <PlatformSelect
          id={recipientsId}
          value={form.mode}
          disabled={disabled}
          onChange={(event) => {
            const mode = event.target.value;
            update({
              mode: mode === "admins" ? "admins" : mode === "users" ? "users" : "owner",
              userIds: form.userIds,
            });
          }}
        >
          <option value="owner">{t("adminJourneys.stepSheet.notify.owner")}</option>
          <option value="admins">{t("adminJourneys.stepSheet.notify.admins")}</option>
          <option value="users">{t("adminJourneys.stepSheet.notify.users")}</option>
        </PlatformSelect>
      </SheetField>
      {form.mode === "users" ? (
        <div className="space-y-1">
          {isPending || isError ? (
            <p className="text-xs text-muted-foreground">
              {isPending
                ? t("adminJourneys.stepSheet.staff.loading")
                : t("adminJourneys.stepSheet.staff.error")}
            </p>
          ) : null}
          <CheckGroup
            id={`${id}-users`}
            legend={t("adminJourneys.stepSheet.notify.people")}
            options={staff.map((person) => ({ value: person.id, label: person.label }))}
            value={form.userIds}
            disabled={disabled}
            error={usersError}
            onChange={(userIds) => update({ mode: "users", userIds })}
          />
        </div>
      ) : null}
      <BufferedTextField
        id={`${id}-message`}
        label={t("adminJourneys.stepSheet.notify.message")}
        value={params.message}
        min={1}
        max={JOURNEY_LIMITS.staffMessageMax}
        multiline
        disabled={disabled}
        onCommit={(message) => commit({ ...params, message }, "message")}
      />
    </div>
  );
}

// ── Zakończenie ─────────────────────────────────────────────────────────────

function GoalForm({ id, params, disabled, commit }: FormProps<{ label?: string }>) {
  const { t } = useTranslation();
  return (
    <BufferedTextField
      id={`${id}-goal`}
      label={t("adminJourneys.stepSheet.goal.label")}
      hint={t("adminJourneys.stepSheet.goal.hint")}
      value={params.label ?? ""}
      max={JOURNEY_LIMITS.nameMax}
      disabled={disabled}
      onCommit={(label) => commit(label ? { label } : {}, "label")}
    />
  );
}
