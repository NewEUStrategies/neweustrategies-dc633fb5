// LIMITY I SŁOWNIKI ŚCIEŻEK KOMUNIKACJI - lustro CHECK-ów z migracji
// 20261020090300 (rdzeń ścieżek) i 20261020090400 (wiadomości).
//
// Te same liczby czytają schematy zod (graf, server fns), liczniki znaków
// w edytorze i komunikaty błędów. AGENTS: za długa wartość jest ODRZUCANA,
// nigdy przycinana - licznik w UI musi znać limit, który egzekwuje baza.
// Rozjazd pilnuje `journeyLimitsParity.test.ts` (parsuje CHECK-i z migracji).
//
// Statusy ścieżki (`JOURNEY_STATUSES`) mieszkają w `lib/revenue/search.ts`,
// bo są też parametrem adresu huba (`?status=`) - jedna lista, zero dryfu.

import { CRM_TAG_MAX } from "@/lib/crm/lifecycle";

export const JOURNEY_LIMITS = {
  /** `journey_definitions.key` - klucz techniczny ścieżki. */
  keyPattern: /^[a-z0-9_-]{3,64}$/,
  nameMin: 1,
  nameMax: 160,
  descriptionMax: 2000,
  /** Podstawa prawna ścieżki serwisowej (wymagana poza kategorią `marketing`). */
  legalBasisMax: 500,
  /** Typ zdarzenia wyzwalacza (`journey_versions.trigger_event_type`): `obszar.akcja.vN`. */
  triggerEventTypePattern: /^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$/,
  subjectMin: 1,
  subjectMax: 200,
  preheaderMax: 200,
  taskTitleMax: 200,
  staffMessageMax: 500,
  /** Tag kontaktu - ta sama stała co panel CRM i pisarz tagów (Z-S5-02). */
  tagMax: CRM_TAG_MAX,
  nodesMax: 60,
  /** Wariant maila w teście A/B (`journey_email_contents.variant`). */
  variantPattern: /^[A-E]$/,
  /**
   * Ramiona testu A/B dostępne w edytorze. CHECK w bazie zna pięć liter
   * (A-E), żeby poszerzenie było zmianą tej liczby, a nie migracją; do tego
   * czasu dwa ramiona to wszystko, co pokazuje analiza istotności (SPEC N11).
   */
  abVariantsMax: 2,
  waitMinutesMin: 5,
  waitMinutesMax: 525_600,
  untilEventTimeoutMaxMinutes: 43_200,
  taskDueDaysMax: 60,
  cooldownDaysMin: 1,
  cooldownDaysMax: 730,
  /** Limit maili marketingowych na kontakt w 7 dni (`journey_settings`). */
  capPer7dMin: 1,
  capPer7dMax: 20,
  capPer7dDefault: 3,
  /** Otwarcie szybsze niż N sekund od wysyłki = otwarcie maszynowe (proxy). */
  machineOpenSecondsMin: 0,
  machineOpenSecondsMax: 30,
  machineOpenSecondsDefault: 2,
} as const;

/** Stałe operacyjne silnika (nie CHECK-i - przepustowość jednego ticku). */
export const JOURNEY_ENGINE_LIMITS = {
  emailsPerTick: 20,
  queueBacklogMax: 120,
  enrollmentsPerTenantPerTick: 20,
  claimLeaseSeconds: 120,
} as const;

export const JOURNEY_CATEGORIES = ["marketing", "service"] as const;
export type JourneyCategory = (typeof JOURNEY_CATEGORIES)[number];

/** Polityka ponownego wejścia kontaktu (`journey_versions.reentry`). */
export const JOURNEY_REENTRY = ["never", "after_exit", "cooldown"] as const;
export type JourneyReentry = (typeof JOURNEY_REENTRY)[number];

/** Rola trasy zdarzenia (`journey_event_routes.role`). */
export const JOURNEY_ROUTE_ROLES = ["enroll", "goal", "exit", "wake"] as const;
export type JourneyRouteRole = (typeof JOURNEY_ROUTE_ROLES)[number];

/** Stan zapisu kontaktu (`journey_enrollments.status`). */
export const JOURNEY_ENROLLMENT_STATUSES = [
  "active",
  "waiting",
  "completed",
  "goal_reached",
  "exited",
  "failed",
] as const;
export type JourneyEnrollmentStatus = (typeof JOURNEY_ENROLLMENT_STATUSES)[number];

/** Powód zakończenia zapisu (`journey_enrollments.exit_reason`). */
export const JOURNEY_EXIT_REASONS = [
  "completed",
  "goal",
  "exit_event",
  "consent",
  "unsubscribed",
  "suppressed",
  "manual",
  "journey_archived",
  "error",
  "entry_filter",
  // RODO (I9b-A2): konto usunięte - zapis w toku kończy wyzwalacz usunięcia
  // konta, bo podstawa ścieżki związanej z kontem wygasła razem z nim.
  "account_deleted",
] as const;
export type JourneyExitReason = (typeof JOURNEY_EXIT_REASONS)[number];

/** Stan wykonania kroku (`journey_step_runs.status`). */
export const JOURNEY_STEP_STATUSES = ["running", "succeeded", "skipped", "failed", "dead"] as const;
export type JourneyStepStatus = (typeof JOURNEY_STEP_STATUSES)[number];

/** Wyjście kroku (`journey_step_runs.outcome`): gałąź, wariant albo powód pominięcia. */
export const JOURNEY_STEP_OUTCOMES = [
  "next",
  "yes",
  "no",
  "A",
  "B",
  "C",
  "D",
  "E",
  "event",
  "timeout",
  "capped",
  "quiet",
  "no_consent",
  "precedence",
  "skipped",
  "delivery_not_ready",
] as const;
export type JourneyStepOutcome = (typeof JOURNEY_STEP_OUTCOMES)[number];

/** Zdarzenie śledzenia wiadomości (`journey_message_events.kind`). */
export const JOURNEY_MESSAGE_EVENT_KINDS = ["open", "click", "unsubscribe"] as const;
export type JourneyMessageEventKind = (typeof JOURNEY_MESSAGE_EVENT_KINDS)[number];

/** Faza silnika w dzienniku błędów (`journey_engine_errors.phase`). */
export const JOURNEY_ENGINE_PHASES = ["route", "ingest", "advance", "email", "tracking"] as const;
export type JourneyEnginePhase = (typeof JOURNEY_ENGINE_PHASES)[number];
