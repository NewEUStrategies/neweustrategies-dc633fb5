// KLUCZE ETYKIET SILNIKA ŚCIEŻEK (`adminJourneys.*`) - jedno miejsce, w którym
// kod unii (typ węzła, powód wyjścia, kod błędu grafu, werdykt bramki maila…)
// staje się kluczem i18n. UI S8 woła `t(journeyLabelKey("nodeType", type))`
// zamiast sklejać napisy w komponentach: literówka w sekcji albo kod spoza
// unii to błąd kompilacji, nie surowy klucz na kanwie.
//
// Słownik: `src/lib/i18n-admin-journeys.ts`; pokrycie każdego kodu (TS i SQL)
// pilnuje `__tests__/i18nJourneys.test.ts`.
//
// LIŚĆ BEZ IMPORTÓW RUNTIME (same typy) - czyta go kanwa w przeglądarce.
import type { GraphIssueCode } from "./graph";
import type { JourneyMutationErrorCode } from "./journeys.functions";
import type {
  JourneyEnginePhase,
  JourneyEnrollmentStatus,
  JourneyExitReason,
  JourneyStepOutcome,
} from "./limits";
import type { JourneyEdgeBranch, JourneyNodeFamily, JourneyNodeType } from "./nodeTypes";
import type { JourneyPredicateKind } from "./predicates";
import type { JourneyTemplateKey } from "./templates/types";
import type { TriggerGroup } from "./triggers";
import type { JourneyVariableKey } from "./variables";

/** Werdykt bramki maila (`journey_can_send`, symulacja). */
export type JourneySendVerdict =
  "ok" | "no_consent" | "unsubscribed" | "suppressed" | "capped" | "quiet";

/** Kody walidatora publikacji spoza listy TS (`journey_validate_graph`). */
export type JourneySqlGraphIssueCode =
  | "graph_shape"
  | "node_id_invalid"
  | "node_type_unknown"
  | "wait_minutes"
  | "wait_until_time"
  | "wait_until_event"
  | "wait_mode"
  | "ab_weights"
  | "if_else_empty"
  | "lifecycle_stage"
  | "crm_stage"
  | "task_params"
  | "tag_length"
  | "newsletter_list"
  | "staff_message";

/** Adnotacje kroku symulacji (`admin_journey_simulate`). */
export type JourneySimulationNote =
  | "duration"
  | "until_time"
  | "until_event"
  | "simulated_bucket"
  | "history_predicates_false"
  | "would_run";

/** Sekcja słownika -> kody, które ją adresują. */
export interface JourneyLabelCodes {
  nodeType: JourneyNodeType;
  nodeFamily: JourneyNodeFamily;
  branch: JourneyEdgeBranch;
  enrollmentStatus: JourneyEnrollmentStatus;
  exitReason: JourneyExitReason;
  stepOutcome: JourneyStepOutcome;
  enginePhase: JourneyEnginePhase;
  predicate: JourneyPredicateKind;
  triggerGroup: TriggerGroup;
  variable: JourneyVariableKey;
  sendVerdict: JourneySendVerdict;
  graphIssue: GraphIssueCode | JourneySqlGraphIssueCode;
  mutationError: JourneyMutationErrorCode;
  /** Adnotacja `send_email` w symulacji to werdykt - etykieta z `sendVerdict`. */
  simulationNote: JourneySimulationNote;
}
export type JourneyLabelSection = keyof JourneyLabelCodes;

export function journeyLabelKey<S extends JourneyLabelSection>(
  section: S,
  code: JourneyLabelCodes[S],
): string {
  return `adminJourneys.${section}.${code}`;
}

/**
 * Klucz etykiety wyzwalacza: typ bez wersji, kropki na podkreślenia
 * (`checkout.abandoned.v1` -> `checkout_abandoned`) - i18next traktuje kropkę
 * jako separator ścieżki.
 */
export function journeyTriggerI18nKey(eventType: string): string {
  return eventType.replace(/\.v\d+$/, "").replace(/\./g, "_");
}

export function journeyTriggerLabelKey(eventType: string): string {
  return `adminJourneys.trigger.${journeyTriggerI18nKey(eventType)}`;
}

export function journeyTemplateLabelKeys(key: JourneyTemplateKey): {
  name: string;
  description: string;
} {
  return {
    name: `adminJourneys.templates.${key}.name`,
    description: `adminJourneys.templates.${key}.description`,
  };
}
