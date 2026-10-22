// RUNNER ŚCIEŻEK KOMUNIKACJI (S5) - jeden tick silnika: skrzynka -> pobranie
// -> wykonanie -> maile -> zdarzenie statystyk.
//
// DLACZEGO TS, A NIE pg_cron. Krok bazy (warunki, akcje CRM, czekania) robi
// SQL, ale mail wymaga renderu, podpisów HMAC i kolejki poczty - to jest
// warstwa aplikacji. Runner wpina I9 w istniejący harmonogram (`jobs-tick`,
// SPEC §4.6: po zadaniach uczestnika, PRZED drenem kolejki maili), bez nowego
// crona.
//
// KOLEJNOŚĆ (SPEC §5.6): ingest -> claim -> advance -> (zaległość kolejki
// > 120 ⇒ maile odłożone o 5 min) -> maile (≤ 20 na tick, bramka reputacji
// RAZ na najemcę) -> domknięcie kroku -> `journey.stats_changed.v1`.
// Termin ticku: 3 s (`JOURNEYS_DEADLINE_MS`) - runner kończy czysto, a zapisy
// pod dzierżawą wracają po jej wygaśnięciu (120 s), nigdy nie giną.
//
// IDEMPOTENCJA: klucz kolejki `journey:{zapis}:{węzeł}` = `message_id`
// (`deterministicMessageId`, lustro SQL `_journey_message_id`). Powtórka po
// awarii między kolejką a domknięciem kroku trafia w `skipped: "duplicate"`
// kolejki i tylko domyka krok - mail nie wychodzi drugi raz.
//
// AWARYJNY WYŁĄCZNIK: `JOURNEYS_ENGINE_DISABLED=1` -> `{ error: "disabled" }`
// BEZ dostępu do bazy (incydent: silnik stoi, nic nie czyta ani nie pisze).
// Stan wyłącznika widać w panelu (`getJourneyEngineHealth.killSwitch`).
// Przełącznik NAJEMCY (`journey_settings.enabled`, domyślnie false) działa
// w SQL - wyłączony najemca nie ma zapisów do wykonania (poza testem na żywo).
//
// ZAKRES NAJEMCY. Runner jest czytnikiem service-role (rejestr
// `SERVICE_ROLE_READERS`), ale nie czyta tabel - wyłącznie RPC, które biorą
// najemcę Z WIERSZA (zapis, wiadomość), nigdy z parametru.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { deterministicMessageId } from "@/lib/email/messageId";
import { evaluateSendGate } from "@/lib/email/reputationGate.server";
import { enqueueRawEmail } from "@/lib/email/transactional.server";
import { publicFacingOrigin } from "@/lib/http/host";
import { JOURNEY_ENGINE_LIMITS } from "@/lib/journeys/limits";
import {
  JourneyRenderError,
  journeyUnsubscribeUrl,
  renderJourneyEmail,
  type JourneyLocale,
} from "@/lib/journeys/render.server";
import { journeyUrlVariables, type JourneyVariableValues } from "@/lib/journeys/variables";
import { measurementOptOutUrl } from "@/lib/privacy/measurementToken.server";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

type DbClient = SupabaseClient<Database>;

type RpcCallable = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

/** Termin ticku (SPEC §4.6). */
export const JOURNEYS_DEADLINE_MS = 3_000;
/** Odłożenie maili przy zaległości kolejki poczty. */
export const JOURNEYS_BACKLOG_DEFER_MINUTES = 5;
/** Odłożenie maili ponad sufit ticku - następny tick je weźmie. */
export const JOURNEYS_CAP_DEFER_MINUTES = 1;
/** Odłożenie maili najemcy z zablokowaną reputacją domeny. */
export const JOURNEYS_REPUTATION_DEFER_MINUTES = 60;
/** Bezpiecznik kroków bazy w jednym wykonaniu zapisu. */
export const JOURNEYS_MAX_STEPS = 25;

export interface JourneysTickOptions {
  deadlineAt?: number;
  ingestLimit?: number;
  claimLimit?: number;
}

export interface JourneysTickCounts {
  ingested: number;
  enrolled: number;
  advanced: number;
  emailsQueued: number;
  deferred: number;
  failed: number;
  journeysTouched: number;
  /**
   * Baza bez migracji silnika (PGRST202/42883 już przy skrzynce): runner nie
   * ma czego wykonać, a tick ma to zapisać jako zaplanowane pominięcie, nie
   * jako `failed` co minutę (okno „kod przed migracją", jak retencja I9c).
   */
  skipped?: "migration_pending";
}

export type JourneysTickResult = JourneysTickCounts | { error: string };

interface PendingEmail {
  enrollmentId: string;
  lockToken: string;
  nodeId: string;
  tenantId: string;
  journeyId: string;
  category: "marketing" | "service";
  isTest: boolean;
}

type JourneyCounts = Record<
  string,
  { enrolled: number; advanced: number; finished: number; emails_queued: number }
>;

const FINISHED = new Set(["completed", "goal_reached", "exited", "failed", "dead"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Wynik `journey_advance`/`journey_complete_email_step` z mailem do złożenia. */
function pendingFrom(result: unknown): PendingEmail | null {
  if (!isRecord(result) || result.status !== "email") return null;
  const enrollmentId = str(result.enrollment_id);
  const lockToken = str(result.lock_token);
  const nodeId = str(result.node_id);
  const tenantId = str(result.tenant_id);
  const journeyId = str(result.journey_id);
  if (!enrollmentId || !lockToken || !nodeId || !tenantId || !journeyId) return null;
  return {
    enrollmentId,
    lockToken,
    nodeId,
    tenantId,
    journeyId,
    category: result.category === "service" ? "service" : "marketing",
    isTest: result.is_test === true,
  };
}

/** Kolejka transakcyjna ponad próg = maile ścieżek czekają (SPEC §5.6). */
export function queueBacklogged(depth: unknown): boolean {
  if (!isRecord(depth)) return false;
  return int(depth.transactional_emails) > JOURNEY_ENGINE_LIMITS.queueBacklogMax;
}

/**
 * Adresy serwisu najemcy - jedyne zmienne dozwolone w linkach maila. Jedna
 * definicja w liściu `variables.ts` (Z-S5-08: podgląd edytora S8 składa te same
 * ścieżki z originu karty); re-eksport zostaje dla dotychczasowych importów.
 */
export { journeyUrlVariables };

/**
 * Prefiks tematu maila z „Testuj na sobie” (SPEC §6.3, Integrator S8). Ten sam
 * w PL i EN - to znacznik dla skrzynki, nie zdanie. Dokładany PO renderze:
 * pusty temat ma dalej zatrzymać wysyłkę (`JourneyRenderError`), zamiast
 * przejść walidację jako sam „[TEST] ”.
 */
export const JOURNEY_TEST_SUBJECT_PREFIX = "[TEST] ";

/** Temat maila zapisu testowego - prefiks raz, także przy ponowieniu kroku. */
export function journeyTestSubject(subject: string): string {
  return subject.startsWith(JOURNEY_TEST_SUBJECT_PREFIX)
    ? subject
    : `${JOURNEY_TEST_SUBJECT_PREFIX}${subject}`;
}

function formatDate(value: unknown, locale: JourneyLocale): string | null {
  const text = str(value);
  if (!text) return null;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(at));
}

export async function runJourneysTick(
  supabaseAdmin: DbClient,
  opts: JourneysTickOptions = {},
): Promise<JourneysTickResult> {
  if (process.env.JOURNEYS_ENGINE_DISABLED === "1") return { error: "disabled" };

  const db = supabaseAdmin as unknown as RpcCallable;
  const deadlineAt = opts.deadlineAt ?? Date.now() + JOURNEYS_DEADLINE_MS;
  const overDeadline = () => Date.now() > deadlineAt;
  const counts: JourneysTickCounts = {
    ingested: 0,
    enrolled: 0,
    advanced: 0,
    emailsQueued: 0,
    deferred: 0,
    failed: 0,
    journeysTouched: 0,
  };
  const perJourney: JourneyCounts = {};
  const touch = (journeyId: string) => {
    perJourney[journeyId] ??= { enrolled: 0, advanced: 0, finished: 0, emails_queued: 0 };
    return perJourney[journeyId];
  };

  // ── 1. Skrzynka -> zapisy ──
  const ingest = await db.rpc("journey_ingest_inbox", { p_limit: opts.ingestLimit ?? 200 });
  if (ingest.error && isMigrationPending(ingest.error)) {
    // Pierwsze RPC silnika nie istnieje = cała migracja S5 jeszcze nie weszła;
    // kolejne wywołania dałyby ten sam błąd, więc kończymy od razu.
    return { ...counts, skipped: "migration_pending" };
  }
  if (ingest.error) {
    counts.failed += 1;
    console.error("[journeys] ingest failed", ingest.error.message);
  } else if (isRecord(ingest.data)) {
    counts.ingested = int(ingest.data.ingested);
    counts.enrolled = int(ingest.data.enrolled);
    counts.failed += int(ingest.data.failed);
    if (isRecord(ingest.data.journeys)) {
      for (const [journeyId, n] of Object.entries(ingest.data.journeys))
        touch(journeyId).enrolled += int(n);
    }
  }

  // ── 2. Pobranie z dzierżawą ──
  const pending: PendingEmail[] = [];
  if (!overDeadline()) {
    const claim = await db.rpc("journey_claim_due", {
      p_limit: opts.claimLimit ?? 50,
      p_lease_seconds: JOURNEY_ENGINE_LIMITS.claimLeaseSeconds,
    });
    if (claim.error) {
      counts.failed += 1;
      console.error("[journeys] claim failed", claim.error.message);
    }
    const claimed = Array.isArray(claim.data) ? claim.data.filter(isRecord) : [];

    // ── 3. Wykonanie węzłów bazy ──
    for (const row of claimed) {
      if (overDeadline()) break;
      const enrollmentId = str(row.enrollment_id);
      const lockToken = str(row.lock_token);
      if (!enrollmentId || !lockToken) continue;
      const advance = await db.rpc("journey_advance", {
        p_enrollment_id: enrollmentId,
        p_lock_token: lockToken,
        p_max_steps: JOURNEYS_MAX_STEPS,
      });
      if (advance.error) {
        counts.failed += 1;
        console.error("[journeys] advance failed", enrollmentId, advance.error.message);
        continue;
      }
      counts.advanced += 1;
      const result = isRecord(advance.data) ? advance.data : {};
      const journeyId = str(result.journey_id) ?? str(row.journey_id);
      if (journeyId) {
        const j = touch(journeyId);
        j.advanced += 1;
        if (FINISHED.has(String(result.status))) j.finished += 1;
      }
      if (result.status === "retry" || result.status === "dead") counts.failed += 1;
      const email = pendingFrom(result);
      if (email) pending.push(email);
    }
  }

  // ── 4. Maile ──
  if (pending.length > 0) {
    const depth = await db.rpc("email_queue_depth");
    const backlog = !depth.error && queueBacklogged(depth.data);
    const gateByTenant = new Map<string, boolean>();

    const complete = async (
      email: PendingEmail,
      result: string,
      extra: Record<string, unknown> = {},
    ) => {
      const done = await db.rpc("journey_complete_email_step", {
        p_enrollment_id: email.enrollmentId,
        p_lock_token: email.lockToken,
        p_node_id: email.nodeId,
        p_result: result,
        p_message_id: extra.messageId ?? null,
        p_variant: extra.variant ?? null,
        p_locale: extra.locale ?? null,
        p_detail: extra.detail ?? {},
      });
      if (done.error) {
        counts.failed += 1;
        console.error("[journeys] complete failed", email.enrollmentId, done.error.message);
        return;
      }
      if (isRecord(done.data) && done.data.status === "deferred") counts.deferred += 1;
      if (isRecord(done.data) && FINISHED.has(String(done.data.status)))
        touch(email.journeyId).finished += 1;
      // Ścieżka idzie dalej w tej samej dzierżawie - kolejny mail tego zapisu.
      const next = pendingFrom(done.data);
      if (next) pending.push(next);
    };

    for (let i = 0; i < pending.length; i += 1) {
      const email = pending[i];
      if (overDeadline()) break; // dzierżawa wygaśnie, zapis wróci w kolejnym ticku
      if (backlog) {
        await complete(email, "deferred", { detail: { minutes: JOURNEYS_BACKLOG_DEFER_MINUTES } });
        continue;
      }
      if (counts.emailsQueued >= JOURNEY_ENGINE_LIMITS.emailsPerTick) {
        await complete(email, "deferred", { detail: { minutes: JOURNEYS_CAP_DEFER_MINUTES } });
        continue;
      }
      if (!gateByTenant.has(email.tenantId)) {
        const verdict = await evaluateSendGate(supabaseAdmin, email.tenantId);
        gateByTenant.set(email.tenantId, verdict.allowed);
      }
      if (gateByTenant.get(email.tenantId) === false) {
        await complete(email, "deferred", {
          detail: { minutes: JOURNEYS_REPUTATION_DEFER_MINUTES },
        });
        continue;
      }
      await sendOne(db, email, counts, touch, complete);
    }
  }

  // ── 5. Zdarzenie statystyk - raz na ścieżkę na tick ──
  const journeyIds = Object.keys(perJourney);
  counts.journeysTouched = journeyIds.length;
  if (journeyIds.length > 0) {
    const emitted = await db.rpc("journey_tick_emit_stats", {
      p_journey_ids: journeyIds,
      p_counts: perJourney,
    });
    if (emitted.error) console.error("[journeys] stats emit failed", emitted.error.message);
  }
  return counts;
}

async function sendOne(
  db: RpcCallable,
  email: PendingEmail,
  counts: JourneysTickCounts,
  touch: (journeyId: string) => JourneyCounts[string],
  complete: (email: PendingEmail, result: string, extra?: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const gate = await db.rpc("journey_can_send", {
    p_enrollment_id: email.enrollmentId,
    p_category: email.category,
  });
  if (gate.error) {
    counts.failed += 1;
    await failStep(db, email, `can_send: ${gate.error.message}`);
    return;
  }
  if (gate.data !== "ok") {
    await complete(email, String(gate.data));
    return;
  }

  const contact = await db.rpc("journey_contact_for_send", {
    p_enrollment_id: email.enrollmentId,
    p_node_id: email.nodeId,
  });
  if (contact.error || !isRecord(contact.data)) {
    counts.failed += 1;
    await failStep(db, email, `contact: ${contact.error?.message ?? "shape"}`);
    return;
  }
  const c = contact.data;
  if (c.ready !== true) {
    await complete(email, "delivery_not_ready", {
      detail: { reason: str(c.reason) ?? "not_ready" },
    });
    return;
  }

  const locale: JourneyLocale = c.locale === "en" ? "en" : "pl";
  const origin = publicFacingOrigin(str(c.site_domain));
  const idempotencyKey = `journey:${email.enrollmentId}:${email.nodeId}`;
  const messageId = await deterministicMessageId(idempotencyKey);
  const vars = isRecord(c.vars) ? c.vars : {};
  const values: JourneyVariableValues = {
    first_name: str(c.first_name),
    last_name: str(c.last_name),
    site_name: str(c.site_name),
    plan_name: str(vars.plan_name),
    event_title: str(vars.event_title),
    club_name: str(vars.club_name),
    trial_ends_at: formatDate(vars.trial_ends_at, locale),
    ...journeyUrlVariables(origin),
  };
  // Wypis jednym kliknięciem tylko dla marketingu; usługa z podstawą prawną
  // nie jest wysyłką za zgodą (RFC 8058 dotyczy poczty masowej).
  const unsubscribeUrl =
    email.category === "marketing" ? journeyUnsubscribeUrl(origin, messageId) : null;
  // Pomiar (I9d-Y2): baza liczy `measurement` = wspólny przełącznik najemcy
  // ORAZ zgoda kontaktu na pomiar. Link „Nie mierz moich otwarć i kliknięć"
  // stoi w KAŻDYM mailu marketingowym (decyzja właściciela - także bez zgody,
  // wtedy prowadzi do „pomiar jest wyłączony") i w każdym mierzonym mailu
  // usługowym. Token niesie kontakt CRM, nie adres.
  const measured = c.measurement === true;
  const leadId = str(c.lead_id);
  const optOutUrl =
    leadId && (email.category === "marketing" || measured)
      ? measurementOptOutUrl(origin, { kind: "lead", leadId }, locale)
      : null;

  let rendered;
  try {
    rendered = renderJourneyEmail({
      doc: c.doc,
      subject: str(c.subject) ?? "",
      preheader: str(c.preheader),
      locale,
      vars: values,
      origin,
      messageId,
      unsubscribeUrl,
      // Piksel i linki z identyfikatorem tylko jawnym `true` z bazy (zgoda na
      // pomiar i przełącznik najemcy, 20261020162400); brak pola = bez pomiaru.
      openTracking: c.open_tracking === true,
      linkTracking: c.link_tracking === true,
      measurementOptOutUrl: optOutUrl,
    });
  } catch (err) {
    if (err instanceof JourneyRenderError) {
      await complete(email, "delivery_not_ready", { detail: { reason: err.code } });
      return;
    }
    throw err;
  }

  const label = email.isTest
    ? "journey_test"
    : email.category === "service"
      ? "journey_service"
      : "journey";
  const sent = await enqueueRawEmail({
    to: str(c.email) ?? "",
    // Zapis testowy („Testuj na sobie”) dostaje „[TEST] ” - panel testu to
    // obiecuje (`adminJourneys.testPanel.prefix`), a skrzynka odróżnia próbę.
    subject: email.isTest ? journeyTestSubject(rendered.subject) : rendered.subject,
    html: rendered.html,
    text: rendered.text,
    label,
    category: label === "journey" ? "bulk" : "transactional",
    idempotencyKey,
    tenantId: email.tenantId,
    unsubscribeUrl,
    fromName: str(c.sender_name),
    replyTo: str(c.reply_to),
  });

  if (sent.ok) {
    // Duplikat = ten sam klucz już w kolejce (powtórka po awarii między
    // kolejką a domknięciem kroku): domykamy krok, ale nie liczymy drugi raz.
    if (sent.skipped !== "duplicate") {
      counts.emailsQueued += 1;
      touch(email.journeyId).emails_queued += 1;
    }
    await complete(email, "queued", {
      messageId,
      variant: str(c.variant),
      locale,
      detail: { fallback_locale: c.fallback_locale === true },
    });
    return;
  }
  if (sent.skipped === "suppressed") {
    await complete(email, "suppressed");
    return;
  }
  if (sent.skipped === "no_recipient") {
    await complete(email, "delivery_not_ready", { detail: { reason: "no_recipient" } });
    return;
  }
  counts.failed += 1;
  await failStep(db, email, `enqueue: ${sent.error ?? "unknown"}`);
}

async function failStep(db: RpcCallable, email: PendingEmail, error: string): Promise<void> {
  const res = await db.rpc("journey_fail_step", {
    p_enrollment_id: email.enrollmentId,
    p_lock_token: email.lockToken,
    p_node_id: email.nodeId,
    p_error: error.slice(0, 2000),
    p_phase: "email",
  });
  if (res.error)
    console.error("[journeys] fail_step failed", email.enrollmentId, res.error.message);
}
