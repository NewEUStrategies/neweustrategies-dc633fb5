// JSONB RPC ścieżek -> DTO (`dto.ts`), pole po polu.
//
// PARSER RZUCA, A NIE ZERUJE (jak `revenue/funnel/parse.ts`): zero jest
// wynikiem („0 otwarć"), a `null` znaczy „nie da się policzyć". Zły kształt to
// rozjazd kontraktu SQL <-> TS - ma być głośny, a nie wyglądać jak cisza.
// `bigint` z `count(*)` bywa napisem cyfr - przyjmujemy go, nic poza tym.
import { JOURNEY_STATUSES, type JourneyStatus } from "@/lib/revenue/search";
import {
  JOURNEY_CATEGORIES,
  JOURNEY_ENGINE_PHASES,
  JOURNEY_ENROLLMENT_STATUSES,
  JOURNEY_EXIT_REASONS,
  type JourneyCategory,
  type JourneyEnginePhase,
  type JourneyEnrollmentStatus,
  type JourneyExitReason,
} from "./limits";
import type {
  JourneyEmailStats,
  JourneyEngineHealthDto,
  JourneyEnrollmentRow,
  JourneyEnrollmentsPage,
  JourneyLeadEnrollment,
  JourneyListItem,
  JourneyMutationResult,
  JourneyNodeStats,
  JourneyPublishResult,
  JourneySeriesPoint,
  JourneySettingsDto,
  JourneySimulationDto,
  JourneyStatsDto,
  JourneyTriggerEstimate,
  JourneyVariantStats,
} from "./dto";

/** Rozjazd kontraktu RPC: ścieżka pola i powód. */
export class JourneyShapeError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`journeys RPC: ${path} - ${reason}`);
    this.name = "JourneyShapeError";
    this.path = path;
  }
}

type Bag = Readonly<Record<string, unknown>>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, reason: string): never {
  throw new JourneyShapeError(path, reason);
}

function bag(value: unknown, path: string): Bag {
  if (!isBag(value)) fail(path, "oczekiwano obiektu");
  return value;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "oczekiwano tablicy");
  return value;
}

function has(source: Bag, path: string, key: string): unknown {
  if (!(key in source)) fail(`${path}${key}`, "brak pola");
  return source[key];
}

function count(source: Bag, path: string, key: string): number {
  const value = has(source, path, key);
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    fail(`${path}${key}`, "oczekiwano liczby całkowitej >= 0");
  return parsed;
}

function nullableCount(source: Bag, path: string, key: string): number | null {
  return has(source, path, key) === null ? null : count(source, path, key);
}

function ratio(source: Bag, path: string, key: string, max: number | null): number | null {
  const value = has(source, path, key);
  if (value === null) return null;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || (max !== null && parsed > max)) {
    fail(
      `${path}${key}`,
      max === null ? "oczekiwano liczby >= 0 albo null" : "oczekiwano ułamka w [0, 1] albo null",
    );
  }
  return parsed;
}

function signedNumber(source: Bag, path: string, key: string): number | null {
  const value = has(source, path, key);
  if (value === null) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) fail(`${path}${key}`, "oczekiwano liczby albo null");
  return parsed;
}

function text(source: Bag, path: string, key: string): string {
  const value = has(source, path, key);
  if (typeof value !== "string") fail(`${path}${key}`, "oczekiwano napisu");
  return value;
}

function nullableText(source: Bag, path: string, key: string): string | null {
  const value = has(source, path, key);
  if (value === null) return null;
  if (typeof value !== "string") fail(`${path}${key}`, "oczekiwano napisu albo null");
  return value;
}

function instant(source: Bag, path: string, key: string): string {
  const value = text(source, path, key);
  if (Number.isNaN(Date.parse(value))) fail(`${path}${key}`, "oczekiwano znacznika czasu ISO");
  return value;
}

function nullableInstant(source: Bag, path: string, key: string): string | null {
  return has(source, path, key) === null ? null : instant(source, path, key);
}

function bool(source: Bag, path: string, key: string): boolean {
  const value = has(source, path, key);
  if (typeof value !== "boolean") fail(`${path}${key}`, "oczekiwano boolean");
  return value;
}

function oneOf<T extends string>(source: Bag, path: string, key: string, allowed: readonly T[]): T {
  const value = has(source, path, key);
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`${path}${key}`, `oczekiwano jednej z: ${allowed.join(", ")}`);
  }
  return value as T;
}

function nullableOneOf<T extends string>(
  source: Bag,
  path: string,
  key: string,
  allowed: readonly T[],
): T | null {
  return has(source, path, key) === null ? null : oneOf(source, path, key, allowed);
}

function countMap<K extends string>(
  value: unknown,
  path: string,
  allowed: readonly K[] | null,
): Partial<Record<K, number>> {
  const source = bag(value, path);
  const out: Partial<Record<K, number>> = {};
  for (const key of Object.keys(source)) {
    if (allowed !== null && !(allowed as readonly string[]).includes(key))
      fail(`${path}.${key}`, "nieznany klucz");
    out[key as K] = count(source, `${path}.`, key);
  }
  return out;
}

export function parseJourneyList(raw: unknown): JourneyListItem[] {
  return list(raw, "$").map((entry, i) => {
    const p = `[${i}].`;
    const row = bag(entry, p);
    return {
      id: text(row, p, "id"),
      key: text(row, p, "key"),
      name: text(row, p, "name"),
      description: nullableText(row, p, "description"),
      status: oneOf<JourneyStatus>(row, p, "status", JOURNEY_STATUSES),
      category: oneOf<JourneyCategory>(row, p, "category", JOURNEY_CATEGORIES),
      templateKey: nullableText(row, p, "template_key"),
      publishedVersionId: nullableText(row, p, "published_version_id"),
      version: nullableCount(row, p, "version"),
      triggerEventType: nullableText(row, p, "trigger_event_type"),
      createdAt: instant(row, p, "created_at"),
      updatedAt: instant(row, p, "updated_at"),
      active: count(row, p, "active"),
      enrolled30d: count(row, p, "enrolled_30d"),
      goalReached30d: count(row, p, "goal_reached_30d"),
    };
  });
}

function enrollmentRow(entry: unknown, p: string): JourneyEnrollmentRow {
  const row = bag(entry, p);
  return {
    id: text(row, p, "id"),
    leadId: text(row, p, "lead_id"),
    leadEmail: text(row, p, "lead_email"),
    leadName: nullableText(row, p, "lead_name"),
    status: oneOf<JourneyEnrollmentStatus>(row, p, "status", JOURNEY_ENROLLMENT_STATUSES),
    currentNodeId: nullableText(row, p, "current_node_id"),
    enteredAt: instant(row, p, "entered_at"),
    finishedAt: nullableInstant(row, p, "finished_at"),
    nextRunAt: nullableInstant(row, p, "next_run_at"),
    exitReason: nullableOneOf<JourneyExitReason>(row, p, "exit_reason", JOURNEY_EXIT_REASONS),
    isTest: bool(row, p, "is_test"),
    version: count(row, p, "version"),
  };
}

export function parseJourneyEnrollments(raw: unknown): JourneyEnrollmentsPage {
  const root = bag(raw, "$");
  return {
    total: count(root, "", "total"),
    page: count(root, "", "page"),
    pageSize: count(root, "", "page_size"),
    rows: list(root.rows, "rows").map((entry, i) => enrollmentRow(entry, `rows[${i}].`)),
  };
}

export function parseLeadEnrollments(raw: unknown): JourneyLeadEnrollment[] {
  return list(raw, "$").map((entry, i) => {
    const p = `[${i}].`;
    const row = bag(entry, p);
    return {
      enrollmentId: text(row, p, "enrollment_id"),
      journeyId: text(row, p, "journey_id"),
      journeyName: text(row, p, "journey_name"),
      category: oneOf<JourneyCategory>(row, p, "category", JOURNEY_CATEGORIES),
      status: oneOf<JourneyEnrollmentStatus>(row, p, "status", JOURNEY_ENROLLMENT_STATUSES),
      currentNodeId: nullableText(row, p, "current_node_id"),
      enteredAt: instant(row, p, "entered_at"),
      finishedAt: nullableInstant(row, p, "finished_at"),
      exitReason: nullableOneOf<JourneyExitReason>(row, p, "exit_reason", JOURNEY_EXIT_REASONS),
      isTest: bool(row, p, "is_test"),
      version: count(row, p, "version"),
    };
  });
}

export function parseJourneySettings(raw: unknown): JourneySettingsDto {
  const s = bag(raw, "$");
  return {
    enabled: bool(s, "", "enabled"),
    marketingCapPer7d: count(s, "", "marketing_cap_per_7d"),
    quietStart: text(s, "", "quiet_start"),
    quietEnd: text(s, "", "quiet_end"),
    timezone: text(s, "", "timezone"),
    defaultTaskAssigneeId: nullableText(s, "", "default_task_assignee_id"),
    machineOpenSeconds: count(s, "", "machine_open_seconds"),
    senderName: nullableText(s, "", "sender_name"),
    replyTo: nullableText(s, "", "reply_to"),
    updatedAt: nullableInstant(s, "", "updated_at"),
    exists: bool(s, "", "exists"),
  };
}

export function parseEngineHealth(raw: unknown, killSwitch: boolean): JourneyEngineHealthDto {
  const h = bag(raw, "$");
  return {
    enabled: bool(h, "", "enabled"),
    killSwitch,
    journeysActive: count(h, "", "journeys_active"),
    inboxPending: count(h, "", "inbox_pending"),
    inboxOldestAt: nullableInstant(h, "", "inbox_oldest_at"),
    lastIngestAt: nullableInstant(h, "", "last_ingest_at"),
    dueNow: count(h, "", "due_now"),
    active: count(h, "", "active"),
    waiting: count(h, "", "waiting"),
    locked: count(h, "", "locked"),
    lastStepAt: nullableInstant(h, "", "last_step_at"),
    failed24h: count(h, "", "failed_24h"),
    deadSteps24h: count(h, "", "dead_steps_24h"),
    messages24h: count(h, "", "messages_24h"),
    errors24h: countMap<JourneyEnginePhase>(
      has(h, "", "errors_24h"),
      "errors_24h",
      JOURNEY_ENGINE_PHASES,
    ),
    lastErrors: list(has(h, "", "last_errors"), "last_errors").map((entry, i) => {
      const p = `last_errors[${i}].`;
      const e = bag(entry, p);
      return {
        phase: oneOf<JourneyEnginePhase>(e, p, "phase", JOURNEY_ENGINE_PHASES),
        createdAt: instant(e, p, "created_at"),
        journeyId: nullableText(e, p, "journey_id"),
        nodeId: nullableText(e, p, "node_id"),
        error: text(e, p, "error"),
      };
    }),
  };
}

function emailStats(raw: unknown, p: string): JourneyEmailStats | null {
  if (raw === null || raw === undefined) return null;
  const e = bag(raw, p);
  const q = `${p}.`;
  return {
    queued: count(e, q, "queued"),
    sent: count(e, q, "sent"),
    suppressed: count(e, q, "suppressed"),
    bounced: count(e, q, "bounced"),
    complained: count(e, q, "complained"),
    uniqueOpens: count(e, q, "unique_opens"),
    uniqueHumanOpens: count(e, q, "unique_human_opens"),
    uniqueClicks: count(e, q, "unique_clicks"),
    ctor: ratio(e, q, "ctor", null),
    unsubscribed: count(e, q, "unsubscribed"),
    fallbackLocale: count(e, q, "fallback_locale"),
  };
}

export function parseJourneyStats(raw: unknown): JourneyStatsDto {
  const root = bag(raw, "$");
  const j = bag(has(root, "", "journey"), "journey");
  const nodes: JourneyNodeStats[] = list(has(root, "", "nodes"), "nodes").map((entry, i) => {
    const p = `nodes[${i}].`;
    const n = bag(entry, p);
    return {
      nodeId: text(n, p, "node_id"),
      type: nullableText(n, p, "type"),
      entered: count(n, p, "entered"),
      succeeded: count(n, p, "succeeded"),
      skipped: count(n, p, "skipped"),
      failed: count(n, p, "failed"),
      dead: count(n, p, "dead"),
      waitingNow: count(n, p, "waiting_now"),
      outcomes: countMap<string>(has(n, p, "outcomes"), `${p}outcomes`, null) as Record<
        string,
        number
      >,
      email: emailStats(n.email, `${p}email`),
    };
  });
  const variants: JourneyVariantStats[] = list(has(root, "", "variants"), "variants").map(
    (entry, i) => {
      const p = `variants[${i}].`;
      const v = bag(entry, p);
      return {
        nodeId: text(v, p, "node_id"),
        variant: oneOf(v, p, "variant", ["A", "B"] as const),
        metric: oneOf(v, p, "metric", ["goal", "click"] as const),
        entered: count(v, p, "entered"),
        uniqueClicks: count(v, p, "unique_clicks"),
        goalReached: count(v, p, "goal_reached"),
        z: signedNumber(v, p, "z"),
      };
    },
  );
  return {
    since: instant(root, "", "since"),
    until: instant(root, "", "until"),
    versionId: nullableText(root, "", "version_id"),
    source: oneOf(root, "", "source", ["raw", "rollup"] as const),
    journey: {
      enrolled: count(j, "journey.", "enrolled"),
      active: count(j, "journey.", "active"),
      waiting: count(j, "journey.", "waiting"),
      completed: count(j, "journey.", "completed"),
      goalReached: count(j, "journey.", "goal_reached"),
      failed: count(j, "journey.", "failed"),
      exited: countMap<JourneyExitReason>(
        has(j, "journey.", "exited"),
        "journey.exited",
        JOURNEY_EXIT_REASONS,
      ),
      goalRate: ratio(j, "journey.", "goal_rate", 1),
    },
    nodes,
    variants,
  };
}

export function parseJourneySeries(raw: unknown): JourneySeriesPoint[] {
  return list(raw, "$").map((entry, i) => {
    const p = `[${i}].`;
    const row = bag(entry, p);
    return {
      day: text(row, p, "day"),
      enrolled: count(row, p, "enrolled"),
      goalReached: count(row, p, "goal_reached"),
      exited: count(row, p, "exited"),
      emailsQueued: count(row, p, "emails_queued"),
      uniqueClicks: count(row, p, "unique_clicks"),
    };
  });
}

export function parseTriggerEstimate(raw: unknown): JourneyTriggerEstimate {
  const r = bag(raw, "$");
  return {
    eventType: text(r, "", "event_type"),
    days: count(r, "", "days"),
    events: count(r, "", "events"),
    contacts: count(r, "", "contacts"),
  };
}

export function parseSimulation(raw: unknown): JourneySimulationDto {
  const r = bag(raw, "$");
  return {
    ok: bool(r, "", "ok"),
    errors: list(has(r, "", "errors"), "errors").map((entry, i) => {
      const e = bag(entry, `errors[${i}]`);
      return {
        code: text(e, `errors[${i}].`, "code"),
        nodeId: typeof e.nodeId === "string" ? e.nodeId : null,
      };
    }),
    path: list(has(r, "", "path"), "path").map((entry, i) => {
      const p = `path[${i}].`;
      const s = bag(entry, p);
      return {
        nodeId: text(s, p, "nodeId"),
        type: text(s, p, "type"),
        outcome: typeof s.outcome === "string" ? s.outcome : null,
        note: typeof s.note === "string" ? s.note : null,
      };
    }),
    emails: list(has(r, "", "emails"), "emails").map((entry, i) => {
      const p = `emails[${i}].`;
      const e = bag(entry, p);
      return { nodeId: text(e, p, "nodeId"), verdict: text(e, p, "verdict") };
    }),
    endedAt: typeof r.ended_at === "string" ? r.ended_at : null,
  };
}

export function parseMutation(raw: unknown): JourneyMutationResult {
  const r = bag(raw, "$");
  return {
    id: text(r, "", "id"),
    updatedAt: instant(r, "", "updated_at"),
    status: oneOf<JourneyStatus>(r, "", "status", JOURNEY_STATUSES),
  };
}

export function parsePublish(raw: unknown): JourneyPublishResult {
  const r = bag(raw, "$");
  return {
    id: text(r, "", "id"),
    versionId: text(r, "", "version_id"),
    version: count(r, "", "version"),
    graphChecksum: text(r, "", "graph_checksum"),
    updatedAt: instant(r, "", "updated_at"),
  };
}
