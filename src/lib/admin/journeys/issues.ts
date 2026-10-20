// PROBLEMY ŚCIEŻKI (S8) - jedna lista dla paska „Sprawdź (n)”, listy problemów
// edytora, dialogu publikacji i znaczników na kanwie.
//
// TRZY POZIOMY. `blocker` blokuje publikację (graf niepoprawny, brak treści
// maila, treść skopiowana z szablonu bez zmian, marketing bez nazwy nadawcy,
// usługa bez podstawy prawnej); `warning` każe się zatrzymać, ale nie blokuje
// (nakładanie z przepisem automatyzacji, cykl wyzwalaczy, nieznana zmienna,
// wyłącznik awaryjny); `info` mówi, co się stanie (brak wersji EN = wysyłka PL,
// wyłączony silnik = nikt nie wejdzie, dopóki go nie włączysz).
//
// BLOKADY, KTÓRYCH NIE MA W SQL (dziennik S5 §20.3): baza publikuje ścieżkę
// z treścią szablonu i z domyślnym nadawcą, bo to decyzja redakcyjna, nie
// integralność danych. Panel blokuje obie, bo mail szablonu wysłany bez
// przeczytania i podpis „New European Strategies” zamiast osoby to dwa
// najczęstsze powody wypisów (wiedza Insidera: nadawca-osoba). ODCHYLENIE OD
// SPEC: „nadawca domyślny” to `journey_settings.sender_name === null` (ścieżki
// wysyłają z `noreply@SENDER_DOMAIN` z nazwą serwisu), a nie
// `onboarding@resend.dev` z tekstu SPEC - tego adresu kod S5 nie używa.
//
// KOLEJNOŚĆ: problemy całej ścieżki najpierw, potem po numerze kroku
// (`compareStepNumbers`: 2 < 4.1.1 < 4.2.1 < 10), w obrębie kroku od
// najpoważniejszego. Ta sama numeracja co kanwa i lista kroków.
import {
  JourneyDraftSchema,
  validateJourneyGraph,
  type ActiveJourneyRef,
  type GraphIssue,
} from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import type { JourneyCategory } from "@/lib/journeys/limits";
import { unknownJourneyVariables } from "@/lib/journeys/variables";
import { stableStringify } from "./hash";
import { buildJourneyView, compareStepNumbers } from "./viewModel";

export type JourneyIssueSeverity = "blocker" | "warning" | "info";

export type JourneyLocalIssueCode =
  | "draft_invalid"
  | "content_missing"
  | "subject_empty"
  | "unknown_variables"
  | "english_missing"
  | "content_from_template"
  | "sender_default"
  | "legal_basis_missing"
  | "engine_disabled"
  | "kill_switch"
  | "workflow_replace";

export interface JourneyIssue {
  /** Kod walidatora grafu (`GraphIssueCode`) albo kod panelu. */
  code: string;
  severity: JourneyIssueSeverity;
  nodeId?: string;
  /** Numer kroku z modelu widoku (pusty: krok poza przepływem). */
  number?: string;
  labelKey: string;
  params: Record<string, string | number>;
}

/** Klucze problemów panelu - jawna mapa (zakaz sklejania kluczy). */
export const JOURNEY_ISSUE_LABEL_KEY: Readonly<Record<JourneyLocalIssueCode, string>> = {
  draft_invalid: "adminJourneys.common.issue.draft_invalid",
  content_missing: "adminJourneys.common.issue.content_missing",
  subject_empty: "adminJourneys.common.issue.subject_empty",
  unknown_variables: "adminJourneys.common.issue.unknown_variables",
  english_missing: "adminJourneys.common.issue.english_missing",
  content_from_template: "adminJourneys.common.issue.content_from_template",
  sender_default: "adminJourneys.common.issue.sender_default",
  legal_basis_missing: "adminJourneys.common.issue.legal_basis_missing",
  engine_disabled: "adminJourneys.common.issue.engine_disabled",
  kill_switch: "adminJourneys.common.issue.kill_switch",
  workflow_replace: "adminJourneys.common.issue.workflow_replace",
};

/** Treść maila szkicu (wariant A i kolejne) - kształt z `getJourneyDetail`. */
export interface JourneyIssueContent {
  nodeId: string;
  variant: string;
  subjectPl: string;
  subjectEn: string | null;
  preheaderPl: string | null;
  preheaderEn: string | null;
  doc: unknown;
  /** Liczone na serwerze: treść identyczna z szablonem (wariant A). */
  matchesTemplate?: boolean;
}

/** Przepis automatyzacji (`workflow_definitions`) - do nakładania i zastąpienia. */
export interface JourneyIssueWorkflow {
  name: string;
  enabled: boolean;
  triggerEventType: string;
  actions: readonly string[];
  templateKey: string | null;
}

export interface JourneyIssuesInput {
  /** Surowy szkic (`journey_definitions.draft`) - może nie przejść schematu. */
  draft: unknown;
  draftValid: boolean;
  contents: readonly JourneyIssueContent[];
  definition: {
    category: JourneyCategory;
    legalBasis: string | null;
    /** Przepis zastępowany przez szablon (`replacesWorkflowTemplate`). */
    replacesWorkflowTemplate?: string | null;
  };
  /** Stan silnika i nazwa nadawcy (`journey_settings`, zdrowie silnika). */
  engine?: { enabled: boolean; killSwitch: boolean; senderName: string | null } | null;
  workflows?: readonly JourneyIssueWorkflow[];
  activeJourneys?: readonly ActiveJourneyRef[];
  /** Flagi „treść = szablon” per krok (wariant A) - nadpisują `matchesTemplate`. */
  templateMatches?: Readonly<Record<string, boolean>>;
}

const SEVERITY_RANK: Readonly<Record<JourneyIssueSeverity, number>> = {
  blocker: 0,
  warning: 1,
  info: 2,
};

/** Tekst dokumentu maila do wyszukania zmiennych (wszystkie napisy bloków). */
function docStrings(doc: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [doc];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) stack.push(...value);
    else if (typeof value === "object" && value !== null) stack.push(...Object.values(value));
  }
  return out;
}

function graphIssue(issue: GraphIssue, severity: JourneyIssueSeverity): JourneyIssue {
  return {
    code: issue.code,
    severity,
    ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
    labelKey: journeyLabelKey("graphIssue", issue.code),
    params: issue.detail ? { detail: issue.detail } : {},
  };
}

function local(
  code: JourneyLocalIssueCode,
  severity: JourneyIssueSeverity,
  nodeId?: string,
  params: Record<string, string | number> = {},
): JourneyIssue {
  return {
    code,
    severity,
    ...(nodeId ? { nodeId } : {}),
    labelKey: JOURNEY_ISSUE_LABEL_KEY[code],
    params,
  };
}

export function collectJourneyIssues(input: JourneyIssuesInput): JourneyIssue[] {
  const issues: JourneyIssue[] = [];
  const parsed = JourneyDraftSchema.safeParse(input.draft);
  const draft = input.draftValid && parsed.success ? parsed.data : null;
  if (draft === null) issues.push(local("draft_invalid", "blocker"));

  const graph = draft?.graph ?? null;
  const view = buildJourneyView(graph);

  if (draft !== null) {
    const enabledWorkflows = (input.workflows ?? []).filter((wf) => wf.enabled);
    const validation = validateJourneyGraph(draft.graph, {
      triggerEventType: draft.settings.triggerEventType,
      entryFilter: draft.settings.entryFilter,
      workflows: enabledWorkflows.map((wf) => ({
        name: wf.name,
        triggerEventType: wf.triggerEventType,
        actions: wf.actions,
      })),
      activeJourneys: input.activeJourneys,
    });
    for (const error of validation.errors) issues.push(graphIssue(error, "blocker"));
    for (const warning of validation.warnings) issues.push(graphIssue(warning, "warning"));
  }

  // ── Treści maili (wariant A każdego `send_email`). ──
  const emailNodes = (graph?.nodes ?? []).filter((node) => node.type === "send_email");
  const variantA = new Map(
    input.contents.filter((c) => c.variant === "A").map((content) => [content.nodeId, content]),
  );
  for (const node of emailNodes) {
    const content = variantA.get(node.id);
    if (!content) {
      issues.push(local("content_missing", "blocker", node.id));
      continue;
    }
    if (content.subjectPl.trim() === "") issues.push(local("subject_empty", "blocker", node.id));
    const fromTemplate = input.templateMatches?.[node.id] ?? content.matchesTemplate === true;
    if (fromTemplate) issues.push(local("content_from_template", "blocker", node.id));
    if (content.subjectEn === null || content.subjectEn.trim() === "") {
      issues.push(local("english_missing", "info", node.id));
    }
  }
  for (const content of input.contents) {
    if (!emailNodes.some((node) => node.id === content.nodeId)) continue;
    const texts = [
      content.subjectPl,
      content.subjectEn ?? "",
      content.preheaderPl ?? "",
      content.preheaderEn ?? "",
      ...docStrings(content.doc),
    ];
    const unknown = [...new Set(texts.flatMap((text) => unknownJourneyVariables(text)))];
    if (unknown.length > 0) {
      issues.push(
        local("unknown_variables", "warning", content.nodeId, {
          variables: unknown.map((name) => `{{${name}}}`).join(", "),
          variant: content.variant,
        }),
      );
    }
  }

  // ── Kategoria, nadawca, silnik, przepisy. ──
  if (input.definition.category === "service" && !input.definition.legalBasis?.trim()) {
    issues.push(local("legal_basis_missing", "blocker"));
  }
  if (
    input.definition.category === "marketing" &&
    emailNodes.length > 0 &&
    input.engine &&
    (input.engine.senderName === null || input.engine.senderName.trim() === "")
  ) {
    issues.push(local("sender_default", "blocker"));
  }
  if (input.engine?.killSwitch) issues.push(local("kill_switch", "warning"));
  else if (input.engine && !input.engine.enabled) issues.push(local("engine_disabled", "info"));
  const replaces = input.definition.replacesWorkflowTemplate ?? null;
  if (replaces !== null) {
    for (const wf of input.workflows ?? []) {
      if (wf.enabled && wf.templateKey === replaces) {
        issues.push(local("workflow_replace", "warning", undefined, { name: wf.name }));
      }
    }
  }

  // ── Numery i kolejność. ──
  for (const issue of issues) {
    if (issue.nodeId) issue.number = view.nodes.get(issue.nodeId)?.number ?? "";
  }
  const deduped = new Map<string, JourneyIssue>();
  for (const issue of issues) {
    const key = stableStringify([issue.code, issue.nodeId ?? null, issue.params]);
    if (!deduped.has(key)) deduped.set(key, issue);
  }
  return [...deduped.values()].sort((a, b) => {
    const aGlobal = a.nodeId === undefined;
    const bGlobal = b.nodeId === undefined;
    if (aGlobal !== bGlobal) return aGlobal ? -1 : 1;
    const byNumber = compareStepNumbers(a.number ?? "", b.number ?? "");
    if (byNumber !== 0) return byNumber;
    return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  });
}

/** Problemy blokujące publikację. */
export function publishBlockers(issues: readonly JourneyIssue[]): JourneyIssue[] {
  return issues.filter((issue) => issue.severity === "blocker");
}

/** Liczniki do paska „Sprawdź (n)”. */
export function issueCounts(issues: readonly JourneyIssue[]): Record<JourneyIssueSeverity, number> {
  const counts: Record<JourneyIssueSeverity, number> = { blocker: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}
