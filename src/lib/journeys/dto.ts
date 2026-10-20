// DTO ŚCIEŻEK KOMUNIKACJI - kształty wyników RPC panelu po parsowaniu
// (`parse.ts`), wspólne dla server fn (`journeys.functions.ts`,
// `stats.functions.ts`), `queryOptions` (`queries.ts`) i UI S8.
//
// Liczniki to liczby całkowite >= 0, ułamki w [0, 1] albo `null` („nie da się
// policzyć" - to NIE jest zero), znaczniki czasu jako napis ISO. Moduł czysto
// typowy poza limitami nadawcy (lustro CHECK, test parytetu w `parse.test.ts`).
import type { JourneyStatus } from "@/lib/revenue/search";
import type {
  JourneyCategory,
  JourneyEnginePhase,
  JourneyEnrollmentStatus,
  JourneyExitReason,
} from "./limits";

/**
 * Limity pól nadawcy (`journey_settings`, 20261020140200) - ODRZUCANE, nie
 * przycinane; licznik w formularzu S8 zna ten sam limit co baza.
 */
export const JOURNEY_SENDER_LIMITS = {
  senderNameMax: 120,
  replyToMax: 254,
} as const;

/** Stan odczytu karty: dane, brak roli albo funkcji jeszcze nie wdrożono. */
export type JourneyRead<T> =
  { state: "ready"; data: T } | { state: "forbidden" } | { state: "unavailable" };

export interface JourneyListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: JourneyStatus;
  category: JourneyCategory;
  templateKey: string | null;
  publishedVersionId: string | null;
  version: number | null;
  triggerEventType: string | null;
  createdAt: string;
  updatedAt: string;
  /** Zapisy w toku (bez testowych). */
  active: number;
  enrolled30d: number;
  goalReached30d: number;
}

export interface JourneyEnrollmentRow {
  id: string;
  leadId: string;
  leadEmail: string;
  leadName: string | null;
  status: JourneyEnrollmentStatus;
  currentNodeId: string | null;
  enteredAt: string;
  finishedAt: string | null;
  nextRunAt: string | null;
  exitReason: JourneyExitReason | null;
  isTest: boolean;
  version: number;
}

export interface JourneyEnrollmentsPage {
  total: number;
  page: number;
  pageSize: number;
  rows: JourneyEnrollmentRow[];
}

export interface JourneyLeadEnrollment {
  enrollmentId: string;
  journeyId: string;
  journeyName: string;
  category: JourneyCategory;
  status: JourneyEnrollmentStatus;
  currentNodeId: string | null;
  enteredAt: string;
  finishedAt: string | null;
  exitReason: JourneyExitReason | null;
  isTest: boolean;
  version: number;
}

export interface JourneySettingsDto {
  enabled: boolean;
  marketingCapPer7d: number;
  quietStart: string;
  quietEnd: string;
  timezone: string;
  defaultTaskAssigneeId: string | null;
  machineOpenSeconds: number;
  senderName: string | null;
  replyTo: string | null;
  /** `null` = wiersza jeszcze nie ma (wartości domyślne kontraktu). */
  updatedAt: string | null;
  exists: boolean;
}

export interface JourneyEngineError {
  phase: JourneyEnginePhase;
  createdAt: string;
  journeyId: string | null;
  nodeId: string | null;
  error: string;
}

export interface JourneyEngineHealthDto {
  /** Przełącznik najemcy (`journey_settings.enabled`). */
  enabled: boolean;
  /** Awaryjny wyłącznik środowiska `JOURNEYS_ENGINE_DISABLED` (wszyscy najemcy). */
  killSwitch: boolean;
  journeysActive: number;
  inboxPending: number;
  inboxOldestAt: string | null;
  lastIngestAt: string | null;
  dueNow: number;
  active: number;
  waiting: number;
  locked: number;
  lastStepAt: string | null;
  failed24h: number;
  deadSteps24h: number;
  messages24h: number;
  errors24h: Partial<Record<JourneyEnginePhase, number>>;
  lastErrors: JourneyEngineError[];
}

export interface JourneyEmailStats {
  queued: number;
  sent: number;
  suppressed: number;
  bounced: number;
  complained: number;
  uniqueOpens: number;
  uniqueHumanOpens: number;
  uniqueClicks: number;
  /** Kliknięcia / otwarcia „ludzkie"; `null` bez otwarć. */
  ctor: number | null;
  unsubscribed: number;
  fallbackLocale: number;
}

export interface JourneyNodeStats {
  nodeId: string;
  type: string | null;
  entered: number;
  succeeded: number;
  skipped: number;
  failed: number;
  dead: number;
  waitingNow: number;
  outcomes: Record<string, number>;
  email: JourneyEmailStats | null;
}

export interface JourneyVariantStats {
  nodeId: string;
  variant: "A" | "B";
  metric: "goal" | "click";
  entered: number;
  uniqueClicks: number;
  goalReached: number;
  /** Test dwóch proporcji; `null` poniżej 100 zapisów na wariant. */
  z: number | null;
}

export interface JourneyStatsDto {
  since: string;
  until: string;
  versionId: string | null;
  source: "raw" | "rollup";
  journey: {
    enrolled: number;
    active: number;
    waiting: number;
    completed: number;
    goalReached: number;
    failed: number;
    exited: Partial<Record<JourneyExitReason, number>>;
    goalRate: number | null;
  };
  nodes: JourneyNodeStats[];
  variants: JourneyVariantStats[];
}

export interface JourneySeriesPoint {
  day: string;
  enrolled: number;
  goalReached: number;
  exited: number;
  emailsQueued: number;
  uniqueClicks: number;
}

export interface JourneyTriggerEstimate {
  eventType: string;
  days: number;
  events: number;
  contacts: number;
}

export interface JourneySimulationStep {
  nodeId: string;
  type: string;
  outcome: string | null;
  note: string | null;
}

export interface JourneySimulationDto {
  ok: boolean;
  errors: { code: string; nodeId: string | null }[];
  path: JourneySimulationStep[];
  emails: { nodeId: string; verdict: string }[];
  endedAt: string | null;
}

export interface JourneyMutationResult {
  id: string;
  updatedAt: string;
  status: JourneyStatus;
}

export interface JourneyPublishResult {
  id: string;
  versionId: string;
  version: number;
  graphChecksum: string;
  updatedAt: string;
}
