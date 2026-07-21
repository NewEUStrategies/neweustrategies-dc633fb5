// CRM follow-upy/zadania + wsadowy import leadów z CSV.
//
// Ta sama doktryna co crm.functions.ts: requireStaff (rola + step-up MFA)
// nad klientem user-scoped (RLS jest drugą warstwą egzekucji), głębokie
// wyniki jako JSON string w `json` (serializer TanStacka), idempotencja
// zapisu przez command_idempotency. Przypomnienia NIE żyją tutaj - robi je
// skaner run_crm_task_reminders (migracja 20260721120000) przez pg_cron /
// jobs-tick / community-cron.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { withCommandIdempotency, type RpcClient } from "@/lib/http/idempotency";

const j = (v: unknown): string => JSON.stringify(v ?? null);

type AnyQuery = {
  select: (s: string) => AnyQuery;
  order: (c: string, o: { ascending: boolean; nullsFirst?: boolean }) => AnyQuery;
  limit: (n: number) => AnyQuery;
  eq: (c: string, v: unknown) => AnyQuery;
  lte: (c: string, v: unknown) => AnyQuery;
  insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
  update: (v: unknown) => AnyQuery;
  delete: () => AnyQuery;
  then: <R>(fn: (r: { data: unknown; error: { message: string } | null }) => R) => Promise<R>;
};
const tbl = (ctx: { supabase: unknown }, name: string): AnyQuery =>
  (ctx.supabase as { from: (t: string) => AnyQuery }).from(name);

const TASK_STATUSES = ["open", "done", "cancelled"] as const;
export type CrmTaskStatus = (typeof TASK_STATUSES)[number];

export interface CrmTaskRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  title: string;
  note: string | null;
  due_at: string;
  status: CrmTaskStatus;
  assignee_id: string | null;
  created_by: string | null;
  reminded_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Zadanie z panelu "do zrobienia" - z dołączoną wizytówką leada. */
export interface CrmDueTaskRow extends CrmTaskRow {
  lead: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
}

const LeadTasksInput = z.object({ lead_id: z.string().uuid() });

export const listCrmLeadTasks = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => LeadTasksInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (tbl(context, "crm_tasks")
      .select("*")
      .eq("lead_id", data.lead_id)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true })
      .limit(200) as unknown as Promise<{
      data: unknown[];
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);
    return { json: j(rows ?? []) };
  });

const DueTasksInput = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  /** Horyzont w godzinach - panel pokazuje zaległe + nadchodzące w oknie. */
  horizon_hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
});

export const listCrmDueTasks = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => DueTasksInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const horizon = new Date(Date.now() + data.horizon_hours * 3_600_000).toISOString();
    const { data: rows, error } = await (tbl(context, "crm_tasks")
      .select("*, lead:crm_leads!crm_tasks_lead_id_fkey(id,email,first_name,last_name)")
      .eq("status", "open")
      .lte("due_at", horizon)
      .order("due_at", { ascending: true })
      .limit(data.limit) as unknown as Promise<{
      data: unknown[];
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);
    return { json: j(rows ?? []) };
  });

const CreateTaskInput = z.object({
  lead_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
  due_at: z.string().datetime(),
  assignee_id: z.string().uuid().nullable().optional(),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
});

export const createCrmTask = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => CreateTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const insertTask = async () => {
      const { error } = await tbl(context, "crm_tasks").insert({
        lead_id: data.lead_id,
        title: data.title,
        note: data.note && data.note.length > 0 ? data.note : null,
        due_at: data.due_at,
        // Bez jawnego przypisania follow-up trafia do autora - skaner
        // przypomnień i tak ma fallback assignee -> owner leada -> autor.
        assignee_id: data.assignee_id ?? userId,
        created_by: userId,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    };
    if (data.idempotency_key) {
      const outcome = await withCommandIdempotency(context.supabase as unknown as RpcClient, {
        key: data.idempotency_key,
        command: "crm.add_task",
        run: insertTask,
      });
      return outcome.result;
    }
    return insertTask();
  });

const UpdateTaskInput = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  due_at: z.string().datetime().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
});

export const updateCrmTask = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => UpdateTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const res = await (tbl(context, "crm_tasks").update(patch).eq("id", id) as unknown as Promise<{
      error: { message: string } | null;
    }>);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const deleteCrmTask = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const res = await (tbl(context, "crm_tasks").delete().eq("id", data.id) as unknown as Promise<{
      error: { message: string } | null;
    }>);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

// ── Import CSV z dedupem ─────────────────────────────────────────────────────

/** Porcja per wywołanie RPC - crm_import_leads odrzuca większe (timeouty). */
export const CRM_IMPORT_CHUNK_SIZE = 500;

const ImportRowInput = z.object({
  email: z.string().trim().min(3).max(320),
  first_name: z.string().trim().max(100).optional(),
  last_name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(200).optional(),
  position: z.string().trim().max(150).optional(),
  linkedin_url: z.string().trim().max(300).optional(),
  country: z.string().trim().max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export type CrmImportRow = z.infer<typeof ImportRowInput>;

const ImportInput = z.object({
  rows: z.array(ImportRowInput).min(1).max(CRM_IMPORT_CHUNK_SIZE),
  source: z.string().trim().min(1).max(60).default("import"),
});

export interface CrmImportSummary {
  imported: number;
  merged: number;
  skipped: number;
  errors: { email: string; reason: string }[];
}

function parseImportSummary(raw: unknown): CrmImportSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const errors = Array.isArray(r.errors)
    ? r.errors.flatMap((e) => {
        if (typeof e !== "object" || e === null) return [];
        const rec = e as Record<string, unknown>;
        return [
          {
            email: typeof rec.email === "string" ? rec.email : "",
            reason: typeof rec.reason === "string" ? rec.reason : "unknown",
          },
        ];
      })
    : [];
  return { imported: num(r.imported), merged: num(r.merged), skipped: num(r.skipped), errors };
}

export const importCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }): Promise<CrmImportSummary> => {
    // Cała praca (dedup po email_norm, merge przez crm_upsert_from_form, unia
    // tagów) dzieje się w JEDNEJ transakcji RPC - guard is_staff + tenant
    // w środku (obrona w głąb obok requireStaff).
    const rpc = context.supabase as unknown as {
      rpc: (
        fn: "crm_import_leads",
        args: { p_rows: unknown; p_source: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: result, error } = await rpc.rpc("crm_import_leads", {
      p_rows: data.rows,
      p_source: data.source,
    });
    if (error) throw new Error(error.message);
    return parseImportSummary(result);
  });
