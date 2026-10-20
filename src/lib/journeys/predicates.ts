// WARUNKI ŚCIEŻKI (`if_else`, filtr wejścia) - schemat zod i słownik rodzajów.
//
// Interpreter żyje w SQL (`_journey_eval_predicate`, 20261020140200): warunek
// czyta CRM, subskrypcje i zdarzenia, których przeglądarka nie widzi. TS
// waliduje KSZTAŁT przed zapisem szkicu i publikacją, a test parytetu
// (`nodeTypesParity.test.ts`) pilnuje, żeby każdy rodzaj z tej listy miał
// gałąź w interpreterze - rodzaj znany edytorowi, a nieznany bazie, kończyłby
// się ponawianiem kroku do martwego zapisu.
import { z } from "zod";
import { LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { LEAD_STAGE_ORDER } from "@/lib/crm/leadListSpec";

export const JOURNEY_PREDICATE_KINDS = [
  "email_opened",
  "email_clicked",
  "plan",
  "subscription_status",
  "crm_stage",
  "lifecycle_stage",
  "consent",
  "newsletter_status",
  "has_tag",
  "score_band",
  "event_since_enrollment",
  "club_member",
  "event_registered",
  "trigger_field",
] as const;
export type JourneyPredicateKind = (typeof JOURNEY_PREDICATE_KINDS)[number];

/**
 * Warunki czytające HISTORIĘ zapisu (otwarcia, kliknięcia, zdarzenia od
 * wejścia). W filtrze wejścia i w symulacji nie ma jeszcze zapisu, więc są
 * zawsze fałszem - edytor ostrzega, symulacja pokazuje adnotację.
 */
export const HISTORY_PREDICATE_KINDS: readonly JourneyPredicateKind[] = [
  "email_opened",
  "email_clicked",
  "event_since_enrollment",
];

/** Etapy sprzedażowe CRM (enum `crm_stage`) - lista CRM, nie kopia. */
export const CRM_STAGES = LEAD_STAGE_ORDER;
export type CrmStage = (typeof CRM_STAGES)[number];

/** Statusy subskrypcji płatniczej, po których wolno rozgałęziać. */
export const PREDICATE_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
] as const;

const NODE_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const UUID = z.string().uuid();
const EVENT_TYPE = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$/);
const WITHIN_HOURS = z.number().int().min(1).max(8760);
const SHORT_TEXT = z.string().trim().min(1).max(64);
/** `payload @> condition`: płaski obiekt prostych wartości. */
export const ConditionSchema = z.record(
  z.string().regex(/^[a-z0-9_]{1,64}$/),
  z.union([z.string().max(200), z.number(), z.boolean()]),
);

export const PredicateSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("email_opened"),
        nodeId: NODE_ID,
        withinHours: WITHIN_HOURS.optional(),
        excludeMachine: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("email_clicked"),
        nodeId: NODE_ID,
        withinHours: WITHIN_HOURS.optional(),
        urlContains: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("plan"),
        op: z.enum(["has_paid", "none", "tier_at_least", "tier_in"]),
        tierKeys: z.array(SHORT_TEXT).max(20).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("subscription_status"),
        in: z.array(z.enum(PREDICATE_SUBSCRIPTION_STATUSES)).min(1),
      })
      .strict(),
    z.object({ kind: z.literal("crm_stage"), in: z.array(z.enum(CRM_STAGES)).min(1) }).strict(),
    z
      .object({ kind: z.literal("lifecycle_stage"), in: z.array(z.enum(LIFECYCLE_STAGES)).min(1) })
      .strict(),
    z.object({ kind: z.literal("consent"), marketing: z.literal(true) }).strict(),
    z
      .object({ kind: z.literal("newsletter_status"), in: z.array(SHORT_TEXT).min(1).max(10) })
      .strict(),
    // 40 = limit tagu w CRM (`run_workflow_step`, panel) - wspólny z akcjami tagów.
    z.object({ kind: z.literal("has_tag"), tag: z.string().trim().min(1).max(40) }).strict(),
    z.object({ kind: z.literal("score_band"), in: z.array(SHORT_TEXT).min(1).max(10) }).strict(),
    z
      .object({
        kind: z.literal("event_since_enrollment"),
        eventType: EVENT_TYPE,
        condition: ConditionSchema.optional(),
      })
      .strict(),
    z.object({ kind: z.literal("club_member"), clubId: UUID.optional() }).strict(),
    z.object({ kind: z.literal("event_registered"), eventId: UUID.optional() }).strict(),
    // Pole ładunku zdarzenia wejścia (`in`/`not_in`). `payload @> condition`
    // nie wyrazi zaprzeczenia - win-back startuje na wygaśnięciu, ale NIE po
    // pauzie (`reason <> 'paused'`, D13).
    z
      .object({
        kind: z.literal("trigger_field"),
        key: z.string().regex(/^[a-z0-9_]{1,64}$/),
        op: z.enum(["in", "not_in"]),
        values: z.array(z.string().min(1).max(200)).min(1).max(20),
      })
      .strict(),
  ])
  .superRefine((p, ctx) => {
    // Porównanie warstw bez listy warstw nie ma czego porównać (SQL: fałsz).
    if (
      p.kind === "plan" &&
      (p.op === "tier_at_least" || p.op === "tier_in") &&
      !p.tierKeys?.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tier_keys_required",
        path: ["tierKeys"],
      });
    }
  });
export type JourneyPredicate = z.infer<typeof PredicateSchema>;

/** Węzeł maila, do którego odwołuje się warunek (otwarcie/kliknięcie) albo `null`. */
export function predicateEmailNodeRef(predicate: JourneyPredicate): string | null {
  return predicate.kind === "email_opened" || predicate.kind === "email_clicked"
    ? predicate.nodeId
    : null;
}

export function isHistoryPredicate(predicate: JourneyPredicate): boolean {
  return HISTORY_PREDICATE_KINDS.includes(predicate.kind);
}
