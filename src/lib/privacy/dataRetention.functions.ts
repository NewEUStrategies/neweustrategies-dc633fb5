// Funkcje serwerowe karty „Retencja danych" (/admin/settings/privacy, I9c-X2).
//
// Bramka `requireAdmin` = bramka SQL (`_data_retention_admin_tenant`: admin
// albo super_admin). Najemca NIGDY nie idzie w parametrach - RPC bierze go
// z sesji (`current_tenant_id()`), a klient użytkownika (`context.supabase`)
// niesie tę sesję. Nazwy RPC są LITERAŁAMI w miejscu wywołania (bramka
// `generate:ts-sql-contract` sprawdza grant dla `authenticated`).
//
// Walidator powtarza zakresy bazy tymi samymi stałymi (`DATA_RETENTION_PERIODS`,
// `DATA_RETENTION_RULES`): wartość spoza zakresu jest ODRZUCANA przed RPC,
// a gdyby przeszła - RPC odrzuca ją jeszcze raz (`22023`), CHECK tabeli -
// trzeci raz. Nigdy nie jest przycinana.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";
import {
  DATA_RETENTION_EDITABLE_CATEGORIES,
  isRetentionPeriodAllowed,
  normalizeExtensionReason,
} from "./dataRetention";
import {
  parseCrmExtension,
  parseDataRetentionCrmDue,
  parseDataRetentionPreview,
  parseDataRetentionRunResult,
  parseDataRetentionState,
  type DataRetentionCrmDueDto,
  type DataRetentionPreviewDto,
  type DataRetentionRunResultDto,
  type DataRetentionStateDto,
} from "./dataRetentionParse";
// Kody SQL -> stan panelu: wspólne dla wszystkich funkcji serwerowych karty
// (także wygaszania newslettera, `newsletterSunset.functions.ts`).
import {
  mapDataRetentionError,
  mutation,
  readState,
  type DataRetentionMutation,
  type DataRetentionMutationError,
  type DataRetentionRead,
} from "./rpcResult";

export { mapDataRetentionError };
export type { DataRetentionMutation, DataRetentionMutationError, DataRetentionRead };

const ISO = z.string().datetime({ offset: true });

// ── Odczyty ──────────────────────────────────────────────────────────────────

export const getDataRetention = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<DataRetentionStateDto>> => {
    const { data, error } = await context.supabase.rpc("admin_data_retention_get");
    return readState(error, () => parseDataRetentionState(data));
  });

export const getDataRetentionPreview = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<DataRetentionPreviewDto>> => {
    const { data, error } = await context.supabase.rpc("admin_data_retention_preview");
    return readState(error, () => parseDataRetentionPreview(data));
  });

/** Najwięcej kontaktów na liście „do anonimizacji" (sufit RPC: 200). */
export const DATA_RETENTION_CRM_DUE_LIMIT = 50;

export const getDataRetentionCrmDue = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<DataRetentionRead<DataRetentionCrmDueDto>> => {
    const { data, error } = await context.supabase.rpc("admin_data_retention_crm_due", {
      p_limit: DATA_RETENTION_CRM_DUE_LIMIT,
    });
    return readState(error, () => parseDataRetentionCrmDue(data));
  });

// ── Zapisy ───────────────────────────────────────────────────────────────────

export const SaveCategorySchema = z
  .object({
    category: z.enum(DATA_RETENTION_EDITABLE_CATEGORIES),
    periodMonths: z.number().int(),
    enabled: z.boolean(),
    expectedUpdatedAt: ISO.nullable(),
  })
  .strict()
  .refine((input) => isRetentionPeriodAllowed(input.category, input.periodMonths), {
    message: "period_out_of_range",
    path: ["periodMonths"],
  });
export type SaveCategoryInput = z.infer<typeof SaveCategorySchema>;

export const saveDataRetentionCategory = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => SaveCategorySchema.parse(input))
  .handler(async ({ data, context }): Promise<DataRetentionMutation<DataRetentionStateDto>> => {
    const { data: raw, error } = await context.supabase.rpc("admin_data_retention_save", {
      p_category: data.category,
      p_period_months: data.periodMonths,
      p_enabled: data.enabled,
      ...(data.expectedUpdatedAt === null ? {} : { p_expected_updated_at: data.expectedUpdatedAt }),
    });
    return mutation(raw, error, parseDataRetentionState);
  });

/** Lokalny dzień „YYYY-MM-DD" (natywna wartość pola daty - bez przesunięcia doby). */
const LOCAL_DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const EnforcementSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enable_now") }).strict(),
  z.object({ action: z.literal("postpone"), until: LOCAL_DAY }).strict(),
]);
export type EnforcementInput = z.infer<typeof EnforcementSchema>;

export const setDataRetentionEnforcement = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => EnforcementSchema.parse(input))
  .handler(async ({ data, context }): Promise<DataRetentionMutation<DataRetentionStateDto>> => {
    const { data: raw, error } = await context.supabase.rpc("admin_data_retention_enforcement", {
      p_action: data.action,
      ...(data.action === "postpone" ? { p_until: data.until } : {}),
    });
    return mutation(raw, error, parseDataRetentionState);
  });

export const ExtendContactSchema = z
  .object({
    leadId: z.string().uuid(),
    // Powód po obcięciu brzegów 3-500 znaków - dłuższy jest odrzucany, nie
    // skracany (ten sam predykat co RPC i CHECK tabeli).
    reason: z.string().refine((value) => normalizeExtensionReason(value) !== null, {
      message: "reason_length",
    }),
  })
  .strict();
export type ExtendContactInput = z.infer<typeof ExtendContactSchema>;

export const extendDataRetentionContact = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) => ExtendContactSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<DataRetentionMutation<{ leadId: string; extendedUntil: string }>> => {
      const { data: raw, error } = await context.supabase.rpc("admin_data_retention_crm_extend", {
        p_lead_id: data.leadId,
        p_reason: normalizeExtensionReason(data.reason) ?? "",
      });
      return mutation(raw, error, parseCrmExtension);
    },
  );

export const runDataRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((input: unknown) =>
    z
      .object({ confirm: z.literal(true) })
      .strict()
      .parse(input),
  )
  .handler(async ({ context }): Promise<DataRetentionMutation<DataRetentionRunResultDto>> => {
    const { data: raw, error } = await context.supabase.rpc("admin_data_retention_run_now", {
      p_confirm: true,
    });
    return mutation(raw, error, parseDataRetentionRunResult);
  });
