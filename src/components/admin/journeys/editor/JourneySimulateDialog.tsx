// Symulacja ścieżki (S8, SPEC §6.3 „Symulacja”) - którędy przez SZKIC
// przeszedłby wybrany kontakt, bez zapisu i bez wysyłki.
//
// SZKIC Z EDYTORA, NIE Z BAZY. `admin_journey_simulate` przyjmuje `p_draft`,
// więc symulujemy dokładnie to, co admin widzi na kanwie - także zmiany,
// których autozapis jeszcze nie wysłał. Klucz cache niesie skrót szkicu
// (`draftChecksum`), więc każda zmiana grafu to nowa symulacja, a kosmetyczna
// różnica obiektu - nie. Szkic, który nie przechodzi schematu (`draft: null`),
// nie trafia do serwera: walidator server fn i tak by go odrzucił.
//
// CO MÓWI WYNIK (stan RPC, migracja `20261020140400`): czekanie jest pomijane
// (czekanie na zdarzenie idzie gałęzią „Minął termin”), A/B losuje wariant
// tym samym kubełkiem co silnik, warunki historii (otwarcia, kliknięcia,
// zdarzenie od wejścia) są fałszem, a krok maila niesie werdykt bramki
// `journey_can_send` (zgoda, wypis, blokada adresu). ODCHYLENIE OD SPEC
// („wynik każdego predykatu”): RPC oddaje wynik CAŁEGO warunku (gałąź tak/nie)
// i adnotację o warunkach historii, nie wynik pojedynczego kryterium - panel
// pokazuje więc kryteria warunku, wynik gałęzi i oznacza kryteria historii
// jako niespełnione, zamiast udawać wynik per kryterium.
//
// PODŚWIETLENIE PRZEJŚCIA. Dialog oddaje identyfikatory kroków ścieżki
// (`onHighlightPath`), edytor podświetla je na kanwie i liście; zamknięcie
// gasi podświetlenie (`null`).
//
// KONTAKTY: `listCrmLeads` (CRM, `requireCrmStaff` z aal2) przez fabrykę
// `journeySimulationLeadsQueryOptions` - ostatnio aktywne albo wyszukane;
// wyszukiwanie na żądanie (przycisk), nie na każdy znak.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import {
  CheckCircle2,
  FlaskConical,
  Flag,
  GitBranch,
  LogOut,
  Mail,
  Timer,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import { draftChecksum } from "@/lib/admin/journeys/hash";
import type { JourneyIssue } from "@/lib/admin/journeys/issues";
import { describeNode, translateSummary } from "@/lib/admin/journeys/summaries";
import {
  journeySimulationLeadsQueryOptions,
  type JourneySimulationLeads,
} from "@/lib/admin/journeys/simulationLeads";
import { buildJourneyView, type JourneyView } from "@/lib/admin/journeys/viewModel";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-publish";
import type { JourneySimulationDto, JourneySimulationStep } from "@/lib/journeys/dto";
import {
  NODE_PARAMS_SCHEMAS,
  type GraphIssueCode,
  type JourneyDraft,
  type JourneyNode,
} from "@/lib/journeys/graph";
import {
  journeyLabelKey,
  type JourneySendVerdict,
  type JourneySimulationNote,
  type JourneySqlGraphIssueCode,
} from "@/lib/journeys/labels";
import { JOURNEY_STEP_OUTCOMES, type JourneyStepOutcome } from "@/lib/journeys/limits";
import { JOURNEY_NODE_TYPES, type JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { HISTORY_PREDICATE_KINDS } from "@/lib/journeys/predicates";
import { journeySimulationQueryOptions } from "@/lib/journeys/queries";
import { JourneyIssuesList } from "./JourneyIssuesList";

export interface JourneySimulateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journeyId: string;
  /** Szkic z sesji edytora (może być niezapisany); `null` - nie przechodzi schematu. */
  draft: JourneyDraft | null;
  /** Temat maila per krok (wariant A) - opis kroku jak na karcie kanwy. */
  subjects?: Readonly<Record<string, string>>;
  /** Podświetlenie przejścia na kanwie i liście; `null` gasi podświetlenie. */
  onHighlightPath?: (nodeIds: readonly string[] | null) => void;
  /** Przejście do kroku - dialog zamyka się sam. */
  onFocusNode?: (nodeId: string) => void;
}

export function JourneySimulateDialog(props: JourneySimulateDialogProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureI18n();
  const { t } = useTranslation();
  const { open, onOpenChange } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="journey-simulate-dialog"
        className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[6px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4" aria-hidden="true" />
            {t("adminJourneys.simulateDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("adminJourneys.simulateDialog.description")}</DialogDescription>
        </DialogHeader>
        {open ? <SimulateBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SimulateBody({
  onOpenChange,
  journeyId,
  draft,
  subjects,
  onHighlightPath,
  onFocusNode,
}: JourneySimulateDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const hydrated = useHydrated();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);

  const leads = useQuery({
    ...journeySimulationLeadsQueryOptions(search),
    enabled: hydrated,
  });

  const checksum = useMemo(() => draftChecksum(draft), [draft]);
  const simulation = useQuery({
    ...journeySimulationQueryOptions(journeyId, leadId ?? "", draft, checksum),
    enabled: hydrated && leadId !== null && draft !== null,
  });
  const result = simulation.data?.state === "ready" ? simulation.data.data : null;
  const view = useMemo(() => buildJourneyView(draft?.graph ?? null), [draft]);

  // Najświeższy callback bez ponownego podświetlania przy każdym renderze rodzica.
  const highlightRef = useRef(onHighlightPath);
  useEffect(() => {
    highlightRef.current = onHighlightPath;
  });
  const pathKey = result?.ok ? result.path.map((step) => step.nodeId).join("\n") : null;
  useEffect(() => {
    if (pathKey === null) return;
    highlightRef.current?.(pathKey.split("\n"));
    return () => highlightRef.current?.(null);
  }, [pathKey]);

  if (isMfaRequiredError(leads.error) || isMfaRequiredError(simulation.error)) {
    return <MfaRequiredNotice />;
  }

  const focusNode = onFocusNode
    ? (nodeId: string) => {
        onOpenChange(false);
        onFocusNode(nodeId);
      }
    : undefined;

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchText.trim());
  };

  return (
    <div className="space-y-4">
      <p
        role="note"
        className="m-0 flex items-start gap-2 rounded-[6px] border border-border bg-muted/30 p-3 text-sm"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="block font-medium">
            {t("adminJourneys.simulateDialog.nothingSaved")}
          </span>
          <span className="block text-muted-foreground">
            {t("adminJourneys.simulateDialog.rules")}
          </span>
        </span>
      </p>

      <form noValidate className="space-y-1" onSubmit={submitSearch}>
        <Label htmlFor={`${id}-search`}>{t("adminJourneys.simulateDialog.search")}</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-search`}
            type="search"
            value={searchText}
            aria-describedby={`${id}-search-hint`}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Button type="submit" variant="outline" className="shrink-0">
            {t("adminJourneys.simulateDialog.searchSubmit")}
          </Button>
        </div>
        <p id={`${id}-search-hint`} className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.simulateDialog.searchHint")}
        </p>
      </form>

      <LeadPicker name={`${id}-lead`} query={leads} selected={leadId} onSelect={setLeadId} />

      {draft === null ? (
        <p role="status" className="m-0 text-sm text-destructive">
          {t("adminJourneys.simulateDialog.draftInvalid")}
        </p>
      ) : leadId === null ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.simulateDialog.pickLead")}
        </p>
      ) : simulation.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{t("adminJourneys.simulateDialog.error")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => void simulation.refetch()}
          >
            {t("adminJourneys.common.retry")}
          </Button>
        </div>
      ) : simulation.data?.state === "forbidden" ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t(journeyLabelKey("mutationError", "forbidden"))}
        </p>
      ) : simulation.data?.state === "unavailable" ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t(journeyLabelKey("mutationError", "unavailable"))}
        </p>
      ) : result === null ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.simulateDialog.running")}
        </p>
      ) : (
        <SimulationResult
          result={result}
          draft={draft}
          view={view}
          subjects={subjects}
          highlighted={onHighlightPath !== undefined}
          onFocusNode={focusNode}
        />
      )}
    </div>
  );
}

function LeadPicker({
  name,
  query,
  selected,
  onSelect,
}: {
  name: string;
  query: {
    data?: JourneySimulationLeads;
    isPending: boolean;
    isError: boolean;
  };
  selected: string | null;
  onSelect: (leadId: string) => void;
}) {
  const { t } = useTranslation();
  const rows = query.data?.rows ?? [];
  return (
    <fieldset className="m-0 space-y-1 rounded-[6px] border border-border p-3">
      <legend className="px-1 text-sm font-semibold">
        {t("adminJourneys.simulateDialog.contactLegend")}
      </legend>
      {query.isPending ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.simulateDialog.leadsLoading")}
        </p>
      ) : query.isError ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {t("adminJourneys.simulateDialog.leadsError")}
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminJourneys.simulateDialog.leadsEmpty")}
        </p>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {rows.map((lead) => (
            <label
              key={lead.id}
              className="flex min-h-6 cursor-pointer items-center gap-2 rounded-[6px] px-1 text-sm hover:bg-muted/40"
            >
              <input
                type="radio"
                name={name}
                value={lead.id}
                checked={selected === lead.id}
                onChange={() => onSelect(lead.id)}
              />
              <span className="min-w-0 truncate">
                {lead.name ? `${lead.name} · ${lead.email}` : lead.email}
              </span>
            </label>
          ))}
        </div>
      )}
      {query.data && query.data.total > rows.length ? (
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.simulateDialog.leadsMore", {
            shown: rows.length,
            total: query.data.total,
          })}
        </p>
      ) : null}
    </fieldset>
  );
}

// ── Wynik ────────────────────────────────────────────────────────────────────

const STEP_ICON: Partial<Record<JourneyNodeType, typeof Mail>> = {
  trigger: Zap,
  wait: Timer,
  send_email: Mail,
  if_else: GitBranch,
  ab_split: FlaskConical,
  goal: Flag,
  exit: LogOut,
};

const KNOWN_TYPES: ReadonlySet<string> = new Set(JOURNEY_NODE_TYPES);
const KNOWN_OUTCOMES: ReadonlySet<string> = new Set(JOURNEY_STEP_OUTCOMES);
const SEND_VERDICTS: ReadonlySet<string> = new Set<JourneySendVerdict>([
  "ok",
  "no_consent",
  "unsubscribed",
  "suppressed",
  "capped",
  "quiet",
]);
const SIMULATION_NOTES: ReadonlySet<string> = new Set<JourneySimulationNote>([
  "duration",
  "until_time",
  "until_event",
  "simulated_bucket",
  "history_predicates_false",
  "would_run",
]);
/** Wyjścia, które nie są wyborem gałęzi - nie ma czego pokazać. */
const LINEAR_OUTCOMES: ReadonlySet<string> = new Set(["next"]);
const HISTORY_KINDS: ReadonlySet<string> = new Set(HISTORY_PREDICATE_KINDS);

function SimulationResult({
  result,
  draft,
  view,
  subjects,
  highlighted,
  onFocusNode,
}: {
  result: JourneySimulationDto;
  draft: JourneyDraft;
  view: JourneyView;
  subjects?: Readonly<Record<string, string>>;
  highlighted: boolean;
  onFocusNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const nodes = useMemo(
    () => new Map(draft.graph.nodes.map((node) => [node.id, node])),
    [draft.graph.nodes],
  );
  const stepLabel = (nodeId: string) => {
    const number = view.numbering.get(nodeId) ?? "";
    return number
      ? t("adminJourneys.issuesList.step", { number })
      : t("adminJourneys.issuesList.stepDetached");
  };

  if (!result.ok) {
    const issues: JourneyIssue[] = result.errors.map((error) => ({
      code: error.code,
      severity: "blocker",
      ...(error.nodeId
        ? { nodeId: error.nodeId, number: view.numbering.get(error.nodeId) ?? "" }
        : {}),
      labelKey: journeyLabelKey(
        "graphIssue",
        error.code as GraphIssueCode | JourneySqlGraphIssueCode,
      ),
      params: {},
    }));
    return (
      <div role="alert" className="space-y-2">
        <p className="m-0 text-sm text-destructive">{t("adminJourneys.simulateDialog.rejected")}</p>
        <JourneyIssuesList issues={issues} onFocusNode={onFocusNode} headingLevel={3} />
      </div>
    );
  }

  const sent = result.emails.filter((email) => email.verdict === "ok").length;

  return (
    <section aria-labelledby={headingId} className="space-y-2" data-testid="journey-simulation">
      <h3 id={headingId} className="m-0 text-sm font-semibold">
        {t("adminJourneys.simulateDialog.resultTitle")}
      </h3>
      <p role="status" className="m-0 text-sm">
        {t("adminJourneys.simulateDialog.emailsSummary", {
          sent,
          total: result.emails.length,
        })}
        {result.endedAt
          ? ` ${t("adminJourneys.simulateDialog.ended", { step: stepLabel(result.endedAt) })}`
          : null}
      </p>
      {highlighted ? (
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminJourneys.simulateDialog.highlightHint")}
        </p>
      ) : null}
      <ol className="m-0 list-none space-y-1.5 p-0">
        {result.path.map((step, index) => (
          <SimulationStepRow
            key={`${step.nodeId}:${index}`}
            step={step}
            node={nodes.get(step.nodeId) ?? null}
            draft={draft}
            subject={subjects?.[step.nodeId] ?? null}
            label={stepLabel(step.nodeId)}
            onFocusNode={onFocusNode}
            number={view.numbering.get(step.nodeId) ?? ""}
          />
        ))}
      </ol>
    </section>
  );
}

function SimulationStepRow({
  step,
  node,
  draft,
  subject,
  label,
  number,
  onFocusNode,
}: {
  step: JourneySimulationStep;
  node: JourneyNode | null;
  draft: JourneyDraft;
  subject: string | null;
  label: string;
  number: string;
  onFocusNode?: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const type = KNOWN_TYPES.has(step.type) ? (step.type as JourneyNodeType) : null;
  const Icon = (type && STEP_ICON[type]) || Workflow;
  const description = node
    ? translateSummary(t, describeNode(node, { subject, settings: draft.settings }))
    : type
      ? t(journeyLabelKey("nodeType", type))
      : step.type;
  const isEmail = type === "send_email";
  const verdict = isEmail && step.note && SEND_VERDICTS.has(step.note) ? step.note : null;
  const note = !isEmail && step.note && SIMULATION_NOTES.has(step.note) ? step.note : null;
  const outcome =
    step.outcome && KNOWN_OUTCOMES.has(step.outcome) && !LINEAR_OUTCOMES.has(step.outcome)
      ? (step.outcome as JourneyStepOutcome)
      : null;

  return (
    <li
      data-node-id={step.nodeId}
      className="flex flex-wrap items-start gap-2 rounded-[6px] border border-border p-2 text-sm"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="m-0 text-xs text-muted-foreground">{label}</p>
        <p className="m-0">{description}</p>
        {outcome ? (
          <p className="m-0 font-medium">
            {t("adminJourneys.simulateDialog.branch", {
              branch: t(journeyLabelKey("stepOutcome", outcome)),
            })}
          </p>
        ) : null}
        {verdict ? (
          <p className="m-0 flex items-center gap-1.5">
            {verdict === "ok" ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
            )}
            {t("adminJourneys.simulateDialog.verdict", {
              verdict: t(journeyLabelKey("sendVerdict", verdict as JourneySendVerdict)),
            })}
          </p>
        ) : null}
        {note ? (
          <p className="m-0 text-xs text-muted-foreground">
            {t(journeyLabelKey("simulationNote", note as JourneySimulationNote))}
          </p>
        ) : null}
        {type === "if_else" && node ? <PredicateList node={node} /> : null}
      </div>
      {onFocusNode && node ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0"
          onClick={() => onFocusNode(step.nodeId)}
        >
          {number
            ? t("adminJourneys.issuesList.goToStep", { number })
            : t("adminJourneys.issuesList.goToDetached")}
        </Button>
      ) : null}
    </li>
  );
}

/** Kryteria warunku z oznaczeniem tych, które symulacja liczy jako fałsz. */
function PredicateList({ node }: { node: JourneyNode }) {
  const { t } = useTranslation();
  const parsed = NODE_PARAMS_SCHEMAS.if_else.safeParse(node.params ?? {});
  if (!parsed.success) return null;
  const { match, predicates } = parsed.data;
  return (
    <div className="space-y-0.5 pt-0.5">
      <p className="m-0 text-xs text-muted-foreground">
        {match === "any"
          ? t("adminJourneys.simulateDialog.matchAny")
          : t("adminJourneys.simulateDialog.matchAll")}
      </p>
      <ul className="m-0 list-disc space-y-0.5 pl-5 text-xs">
        {predicates.map((predicate, index) => (
          <li key={`${predicate.kind}:${index}`}>
            {t(journeyLabelKey("predicate", predicate.kind))}
            {HISTORY_KINDS.has(predicate.kind)
              ? ` - ${t("adminJourneys.simulateDialog.predicateHistory")}`
              : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
