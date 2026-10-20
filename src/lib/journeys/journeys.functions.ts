// Server fn ścieżek komunikacji (S5, kontrakt §5.2) - RPC panelu gotowe pod
// UI S8. Wymóg właściciela: KAŻDY przełącznik silnika jest w panelu admina
// (włączenie per najemca, limit D-03, cisza nocna, nadawca, pauza ścieżki,
// wyjście kontaktu, test na żywo) - żadnego ustawienia tylko z SQL albo env.
//
// Bramki: odczyt, szkic, treść, test i wyjście kontaktu - `requireCrmStaff`
// (admin/editor + aal2), publikacja, status, ustawienia i pominięcie czekania
// - `requireAdmin`. To lustro bramek SQL (`_journey_staff_tenant`): middleware
// odcina wcześniej, baza i tak sprawdza drugi raz. Najemca NIGDY w
// parametrach - RPC bierze go z sesji (`current_tenant_id()`).
//
// Nazwy RPC są LITERAŁAMI w miejscu wywołania (bramka
// `generate:ts-sql-contract` czyta je ze źródła i sprawdza grant). Odczyty
// zwracają STAN (`forbidden`/`unavailable`) zamiast wyjątku; zapisy - wynik
// z kodem błędu (`conflict`, `graph_invalid`…), który panel tłumaczy.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin, requireCrmStaff } from "@/integrations/supabase/require-staff";
import { parseEmailDoc } from "@/lib/newsletter/emailDoc";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";
import { JOURNEY_STATUSES } from "@/lib/revenue/search";
import type {
  JourneyEngineHealthDto,
  JourneyEnrollmentsPage,
  JourneyLeadEnrollment,
  JourneyListItem,
  JourneyMutationResult,
  JourneyPublishResult,
  JourneyRead,
  JourneySettingsDto,
  JourneySimulationDto,
  JourneyTriggerEstimate,
} from "./dto";
import { JOURNEY_SENDER_LIMITS } from "./dto";
import { JourneyDraftSchema, JourneySettingsSchema, validateJourneyGraph } from "./graph";
import { JOURNEY_CATEGORIES, JOURNEY_ENROLLMENT_STATUSES, JOURNEY_LIMITS } from "./limits";
import {
  parseEngineHealth,
  parseJourneyEnrollments,
  parseJourneyList,
  parseJourneySettings,
  parseLeadEnrollments,
  parseMutation,
  parsePublish,
  parseSimulation,
  parseTriggerEstimate,
} from "./parse";
import { ConditionSchema } from "./predicates";
import { JOURNEY_TEMPLATE_KEYS, isTemplateAvailable, journeyTemplate } from "./templates";

type RpcError = { message: string; code?: string; details?: string } | null;

/** „Funkcji jeszcze nie ma w tej bazie" - okno wdrożenia, nie awaria. */
const MISSING_SOURCE = new Set(["42883", "PGRST202"]);

/** Awaryjny wyłącznik środowiska - widoczny w panelu przez zdrowie silnika. */
export function journeysKillSwitch(): boolean {
  return process.env.JOURNEYS_ENGINE_DISABLED === "1";
}

function readState<T>(error: RpcError, ready: () => T): JourneyRead<T> {
  if (error) {
    if (error.code === "42501") return { state: "forbidden" };
    if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return { state: "unavailable" };
    throw new Error(error.message);
  }
  return { state: "ready", data: ready() };
}

export type JourneyMutationErrorCode =
  | "forbidden"
  | "conflict"
  | "not_found"
  | "duplicate"
  | "limit_exceeded"
  | "invalid"
  | "unavailable"
  | "template_unavailable";

export type JourneyMutation<T> =
  | { ok: true; data: T }
  | { ok: false; error: JourneyMutationErrorCode; reason: string | null; detail: string | null };

/** Kod SQL -> kod panelu; `reason` = komunikat RPC (`graph_invalid`, `key_taken`…). */
export function mapMutationError(error: NonNullable<RpcError>): JourneyMutation<never> {
  const reason = error.message.split(":")[0]?.trim() || null;
  const detail = error.details ?? null;
  const code: JourneyMutationErrorCode = (() => {
    switch (error.code) {
      case "42501":
        return "forbidden";
      case "40001":
        return "conflict";
      case "P0002":
        return "not_found";
      case "23505":
        return "duplicate";
      case "23514":
        return "limit_exceeded";
      case "22023":
      case "22P02":
        return "invalid";
      default:
        if (error.code !== undefined && MISSING_SOURCE.has(error.code)) return "unavailable";
        throw new Error(error.message);
    }
  })();
  return { ok: false, error: code, reason, detail };
}

function mutation<T>(
  data: unknown,
  error: RpcError,
  parse: (raw: unknown) => T,
): JourneyMutation<T> {
  if (error) return mapMutationError(error);
  return { ok: true, data: parse(data) };
}

const UUID = z.string().uuid();
const ISO = z.string().datetime({ offset: true });
const NODE_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// ── Odczyty ──────────────────────────────────────────────────────────────────

export const listJourneys = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) =>
    z.object({ status: z.enum(JOURNEY_STATUSES).nullable().default(null) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<JourneyRead<JourneyListItem[]>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_list",
      { p_status: data.status },
    );
    return readState(error, () => parseJourneyList(raw));
  });

const EnrollmentsInput = z.object({
  journeyId: UUID,
  nodeId: NODE_ID.nullable().default(null),
  status: z.enum(JOURNEY_ENROLLMENT_STATUSES).nullable().default(null),
  page: z.number().int().min(0).max(10_000).default(0),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export const getJourneyEnrollments = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => EnrollmentsInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyRead<JourneyEnrollmentsPage>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_enrollments",
      {
        p_journey_id: data.journeyId,
        p_node_id: data.nodeId,
        p_status: data.status,
        p_page: data.page,
        p_page_size: data.pageSize,
      },
    );
    return readState(error, () => parseJourneyEnrollments(raw));
  });

export const getLeadJourneys = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => z.object({ leadId: UUID }).parse(input))
  .handler(async ({ data, context }): Promise<JourneyRead<JourneyLeadEnrollment[]>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_lead_enrollments",
      { p_lead_id: data.leadId },
    );
    return readState(error, () => parseLeadEnrollments(raw));
  });

export const getJourneySettings = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<JourneyRead<JourneySettingsDto>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_settings_get",
    );
    return readState(error, () => parseJourneySettings(raw));
  });

export const getJourneyEngineHealth = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }): Promise<JourneyRead<JourneyEngineHealthDto>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_engine_health",
    );
    return readState(error, () => parseEngineHealth(raw, journeysKillSwitch()));
  });

export const estimateJourneyTrigger = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) =>
    z
      .object({
        eventType: z.string().regex(JOURNEY_LIMITS.triggerEventTypePattern),
        condition: ConditionSchema.default({}),
        days: z.number().int().min(1).max(90).default(30),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<JourneyRead<JourneyTriggerEstimate>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_trigger_estimate",
      { p_event_type: data.eventType, p_condition: data.condition, p_days: data.days },
    );
    return readState(error, () => parseTriggerEstimate(raw));
  });

export const simulateJourney = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) =>
    z
      .object({ journeyId: UUID, leadId: UUID, draft: JourneyDraftSchema.nullable().default(null) })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<JourneyRead<JourneySimulationDto>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_simulate",
      { p_journey_id: data.journeyId, p_lead_id: data.leadId, p_draft: data.draft },
    );
    return readState(error, () => parseSimulation(raw));
  });

// ── Zapisy: ścieżka ──────────────────────────────────────────────────────────

const CreateInput = z
  .object({
    key: z.string().regex(JOURNEY_LIMITS.keyPattern),
    name: z.string().trim().min(JOURNEY_LIMITS.nameMin).max(JOURNEY_LIMITS.nameMax),
    category: z.enum(JOURNEY_CATEGORIES).default("marketing"),
    legalBasis: z.string().trim().max(JOURNEY_LIMITS.legalBasisMax).nullable().default(null),
    description: z.string().trim().max(JOURNEY_LIMITS.descriptionMax).nullable().default(null),
  })
  .refine((v) => v.category === "marketing" || Boolean(v.legalBasis), {
    message: "legal_basis_required",
  });

export const createJourney = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyMutation<JourneyMutationResult>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_create",
      {
        p_key: data.key,
        p_name: data.name,
        p_category: data.category,
        p_legal_basis: data.legalBasis,
        p_description: data.description,
        p_template_key: null,
        p_draft: null,
      },
    );
    return mutation(raw, error, parseMutation);
  });

const InstallInput = z.object({
  templateKey: z.enum(JOURNEY_TEMPLATE_KEYS),
  key: z.string().regex(JOURNEY_LIMITS.keyPattern),
  name: z.string().trim().min(JOURNEY_LIMITS.nameMin).max(JOURNEY_LIMITS.nameMax),
  locale: z.enum(["pl", "en"]).default("pl"),
});

/**
 * Instalacja szablonu = szkic u najemcy (graf, ustawienia) + treść każdego
 * maila (wariant A). Szablon niedostępny (czeka na zdarzenie szyny) odmawia,
 * zanim cokolwiek powstanie.
 */
export const installJourneyTemplate = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => InstallInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyMutation<JourneyMutationResult>> => {
    const template = journeyTemplate(data.templateKey);
    if (!template || !isTemplateAvailable(template)) {
      return { ok: false, error: "template_unavailable", reason: data.templateKey, detail: null };
    }
    const rpc = context.supabase as unknown as RpcCallable;
    const { data: raw, error } = await rpc.rpc("admin_journey_create", {
      p_key: data.key,
      p_name: data.name,
      p_category: template.category,
      p_legal_basis: template.legalBasis ? template.legalBasis[data.locale] : null,
      p_description: null,
      p_template_key: template.key,
      p_draft: { graph: template.graph, settings: template.settings },
    });
    const created = mutation(raw, error, parseMutation);
    if (!created.ok) return created;
    for (const email of template.emails) {
      const { error: contentError } = await rpc.rpc("admin_journey_email_content_save", {
        p_journey_id: created.data.id,
        p_node_id: email.nodeId,
        p_variant: "A",
        p_subject_pl: email.subject.pl,
        p_subject_en: email.subject.en,
        p_preheader_pl: email.preheader.pl,
        p_preheader_en: email.preheader.en,
        p_doc: email.doc,
      });
      if (contentError) return mapMutationError(contentError);
    }
    return created;
  });

const SaveDraftInput = z.object({
  journeyId: UUID,
  expectedUpdatedAt: ISO,
  draft: z.object({ graph: z.unknown(), settings: z.unknown() }),
  name: z.string().trim().min(JOURNEY_LIMITS.nameMin).max(JOURNEY_LIMITS.nameMax).optional(),
  description: z.string().trim().max(JOURNEY_LIMITS.descriptionMax).optional(),
  category: z.enum(JOURNEY_CATEGORIES).optional(),
  legalBasis: z.string().trim().max(JOURNEY_LIMITS.legalBasisMax).optional(),
});

/**
 * Szkic może być NIEKOMPLETNY (edytor zapisuje w trakcie pracy) - kształt
 * węzłów i krawędzi musi się zgadzać, pełna walidacja grafu dopiero przy
 * publikacji. Ustawienia z błędem kształtu odrzucamy od razu.
 */
export const saveJourneyDraft = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => SaveDraftInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyMutation<JourneyMutationResult>> => {
    const draft = JourneyDraftSchema.safeParse(data.draft);
    if (!draft.success) {
      return {
        ok: false,
        error: "invalid",
        reason: "draft_invalid",
        detail: draft.error.issues[0]?.path.join(".") ?? null,
      };
    }
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_save_draft",
      {
        p_journey_id: data.journeyId,
        p_expected_updated_at: data.expectedUpdatedAt,
        p_draft: draft.data,
        p_name: data.name ?? null,
        p_description: data.description ?? null,
        p_category: data.category ?? null,
        p_legal_basis: data.legalBasis ?? null,
      },
    );
    return mutation(raw, error, parseMutation);
  });

const PublishInput = z.object({
  journeyId: UUID,
  expectedUpdatedAt: ISO,
  mode: z.enum(["drain", "exit_all"]).default("drain"),
  /** Szkic, który admin widzi - walidacja TS przed RPC daje listę błędów naraz. */
  draft: JourneyDraftSchema.optional(),
});

export const publishJourney = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => PublishInput.parse(input))
  .handler(async ({ data, context }): Promise<JourneyMutation<JourneyPublishResult>> => {
    if (data.draft) {
      const settings = JourneySettingsSchema.parse(data.draft.settings);
      const check = validateJourneyGraph(data.draft.graph, {
        triggerEventType: settings.triggerEventType,
        entryFilter: settings.entryFilter,
      });
      if (!check.ok) {
        return {
          ok: false,
          error: "invalid",
          reason: "graph_invalid",
          detail: JSON.stringify(check.errors),
        };
      }
    }
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_publish",
      {
        p_journey_id: data.journeyId,
        p_expected_updated_at: data.expectedUpdatedAt,
        p_mode: data.mode,
      },
    );
    return mutation(raw, error, parsePublish);
  });

export const setJourneyStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) =>
    z
      .object({
        journeyId: UUID,
        status: z.enum(["active", "paused", "archived"]),
        expectedUpdatedAt: ISO.nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<JourneyMutation<JourneyMutationResult>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_set_status",
      {
        p_journey_id: data.journeyId,
        p_status: data.status,
        p_expected_updated_at: data.expectedUpdatedAt,
      },
    );
    return mutation(raw, error, parseMutation);
  });

const ContentInput = z.object({
  journeyId: UUID,
  nodeId: NODE_ID,
  variant: z.string().regex(JOURNEY_LIMITS.variantPattern).default("A"),
  subjectPl: z.string().trim().min(JOURNEY_LIMITS.subjectMin).max(JOURNEY_LIMITS.subjectMax),
  subjectEn: z.string().trim().max(JOURNEY_LIMITS.subjectMax).nullable().default(null),
  preheaderPl: z.string().trim().max(JOURNEY_LIMITS.preheaderMax).nullable().default(null),
  preheaderEn: z.string().trim().max(JOURNEY_LIMITS.preheaderMax).nullable().default(null),
  doc: z.unknown(),
});

export const saveJourneyEmailContent = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => ContentInput.parse(input))
  .handler(
    async ({ data, context }): Promise<JourneyMutation<{ id: string; updatedAt: string }>> => {
      // Dokument przechodzi przez TEN SAM parser co wysyłka - zapisujemy to,
      // co renderer zrozumie (złe bloki odpadają, nie wywracają wysyłki).
      const doc = parseEmailDoc(data.doc);
      if (!doc) return { ok: false, error: "invalid", reason: "doc_invalid", detail: null };
      const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
        "admin_journey_email_content_save",
        {
          p_journey_id: data.journeyId,
          p_node_id: data.nodeId,
          p_variant: data.variant,
          p_subject_pl: data.subjectPl,
          p_subject_en: data.subjectEn,
          p_preheader_pl: data.preheaderPl,
          p_preheader_en: data.preheaderEn,
          p_doc: doc,
        },
      );
      return mutation(raw, error, (value) => {
        const row = value as { id?: unknown; updated_at?: unknown };
        if (typeof row?.id !== "string" || typeof row.updated_at !== "string") {
          throw new Error("admin_journey_email_content_save: unexpected shape");
        }
        return { id: row.id, updatedAt: row.updated_at };
      });
    },
  );

// ── Zapisy: ustawienia silnika (tylko admin) ────────────────────────────────

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Łatka ustawień - wyłącznie klucze białej listy SQL. */
export const JourneySettingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    marketing_cap_per_7d: z
      .number()
      .int()
      .min(JOURNEY_LIMITS.capPer7dMin)
      .max(JOURNEY_LIMITS.capPer7dMax),
    quiet_start: TIME,
    quiet_end: TIME,
    timezone: z.string().min(1).max(64),
    default_task_assignee_id: UUID.nullable(),
    machine_open_seconds: z
      .number()
      .int()
      .min(JOURNEY_LIMITS.machineOpenSecondsMin)
      .max(JOURNEY_LIMITS.machineOpenSecondsMax),
    sender_name: z
      .string()
      .trim()
      .min(1)
      .max(JOURNEY_SENDER_LIMITS.senderNameMax)
      .regex(/^[^<>"\r\n]+$/)
      .nullable(),
    reply_to: z.string().trim().email().max(JOURNEY_SENDER_LIMITS.replyToMax).nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch_empty" });
export type JourneySettingsPatch = z.infer<typeof JourneySettingsPatchSchema>;

export const saveJourneySettings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) =>
    z
      .object({
        patch: JourneySettingsPatchSchema,
        expectedUpdatedAt: ISO.nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<JourneyMutation<JourneySettingsDto>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_settings_save",
      { p_patch: data.patch, p_expected_updated_at: data.expectedUpdatedAt },
    );
    return mutation(raw, error, parseJourneySettings);
  });

// ── Zapisy: kontakt w ścieżce ────────────────────────────────────────────────

export const enrollJourneyTest = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => z.object({ journeyId: UUID }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<JourneyMutation<{ enrollmentId: string; leadId: string }>> => {
      const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
        "admin_journey_enroll_test",
        { p_journey_id: data.journeyId },
      );
      return mutation(raw, error, (value) => {
        const row = value as { enrollment_id?: unknown; lead_id?: unknown };
        if (typeof row?.enrollment_id !== "string" || typeof row.lead_id !== "string") {
          throw new Error("admin_journey_enroll_test: unexpected shape");
        }
        return { enrollmentId: row.enrollment_id, leadId: row.lead_id };
      });
    },
  );

export const skipJourneyWait = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => z.object({ enrollmentId: UUID }).parse(input))
  .handler(async ({ data, context }): Promise<JourneyMutation<{ enrollmentId: string }>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_enrollment_skip_wait",
      { p_enrollment_id: data.enrollmentId },
    );
    return mutation(raw, error, () => ({ enrollmentId: data.enrollmentId }));
  });

export const exitJourneyEnrollment = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((input: unknown) => z.object({ enrollmentId: UUID }).parse(input))
  .handler(async ({ data, context }): Promise<JourneyMutation<{ exited: boolean }>> => {
    const { data: raw, error } = await (context.supabase as unknown as RpcCallable).rpc(
      "admin_journey_enrollment_exit",
      { p_enrollment_id: data.enrollmentId },
    );
    return mutation(raw, error, (value) => ({
      exited: (value as { exited?: unknown })?.exited === true,
    }));
  });
