// CRM follow-upy/zadania + wsadowy import leadów z CSV.
//
// Ta sama doktryna co crm.functions.ts: requireCrmStaff (rola + step-up MFA)
// nad klientem user-scoped (RLS jest drugą warstwą egzekucji), głębokie
// wyniki jako JSON string w `json` (serializer TanStacka), idempotencja
// zapisu przez command_idempotency. Przypomnienia NIE żyją tutaj - robi je
// skaner run_crm_task_reminders (migracja 20260721120000) przez pg_cron /
// jobs-tick / community-cron.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { looseClient, looseTable, rowsOf } from "@/lib/supabase/looseQuery";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { withCommandIdempotency, type RpcClient } from "@/lib/http/idempotency";
import { CRM_TAG_MAX } from "@/lib/crm/lifecycle";
import { IMPORT_MAX_TAGS, LEAD_IMPORT_VALUE_MAX } from "@/lib/crm/importMapping";

const j = (v: unknown): string => JSON.stringify(v ?? null);

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
  /**
   * Kto utworzył zadanie (S4): `manual` (panel), `workflow`, `journey`,
   * `billing`, `system`. Kolumna chroniona grantami kolumnowymi - panel jej
   * nie ustawia, więc ręczne zadanie zawsze ma domyślne `manual`.
   */
  source?: string;
  /** Klucz idempotencji zadania z automatu (np. `retention:canceled:<id>`). */
  origin_ref?: string | null;
}

/** Zadanie z panelu "do zrobienia" - z dołączoną wizytówką leada. */
export interface CrmDueTaskRow extends CrmTaskRow {
  lead: { id: string; email: string; first_name: string | null; last_name: string | null } | null;
}

const LeadTasksInput = z.object({ lead_id: z.string().uuid() });

export const listCrmLeadTasks = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => LeadTasksInput.parse(d))
  .handler(async ({ data, context }) => {
    const result = await looseTable(context, "crm_tasks")
      .select("*")
      .eq("lead_id", data.lead_id)
      .order("status", { ascending: true })
      .order("due_at", { ascending: true })
      .limit(200);
    if (result.error) throw new Error(result.error.message);
    return { json: j(rowsOf(result)) };
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
  .middleware([requireCrmStaff])
  .validator((d) => DueTasksInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const horizon = new Date(Date.now() + data.horizon_hours * 3_600_000).toISOString();
    const result = await looseTable(context, "crm_tasks")
      .select("*, lead:crm_leads!crm_tasks_lead_id_fkey(id,email,first_name,last_name)")
      .eq("status", "open")
      .lte("due_at", horizon)
      .order("due_at", { ascending: true })
      .limit(data.limit);
    if (result.error) throw new Error(result.error.message);
    return { json: j(rowsOf(result)) };
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
  .middleware([requireCrmStaff])
  .validator((d) => CreateTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    // Lead i zadanie muszą mieszkać w tym samym tenantcie; bierzemy tenant_id
    // z leada, żeby nie polegać wyłącznie na domyślnej wartości kolumny.
    const { data: lead } = await looseTable(context, "crm_leads")
      .select("tenant_id")
      .eq("id", data.lead_id)
      .maybeSingle();
    const leadTenantId = (lead as { tenant_id?: string } | null)?.tenant_id;
    if (!leadTenantId) throw new Error("lead_not_found");

    const insertTask = async () => {
      const { error } = await looseTable(context, "crm_tasks").insert({
        tenant_id: leadTenantId,
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
  .middleware([requireCrmStaff])
  .validator((d) => UpdateTaskInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const res = await looseTable(context, "crm_tasks").update(patch).eq("id", id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const deleteCrmTask = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const res = await looseTable(context, "crm_tasks").delete().eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

// ── Naprawa zbiorcza: zadania bez osoby (P24) ────────────────────────────────
//
// Zadania z automatów sprzed S4 powstawały bez `assignee_id`, a skaner
// przypomnień nie ma do kogo ich wysłać - follow-up po prostu ginął.
// Naprawa przypisuje każde OTWARTE zadanie bez osoby do właściciela leada,
// a resztę (lead bez właściciela) do wskazanej osoby z zespołu. Reguła
// diagnostyki huba (S7) liczy takie zadania i woła tę funkcję.

const AssignUnassignedInput = z.object({
  /** Osoba dla zadań, których lead nie ma właściciela (tylko zespół CRM). */
  fallback_assignee_id: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});

export interface AssignUnassignedResult {
  assigned_to_owner: number;
  assigned_to_fallback: number;
  /** Zadania bez osoby, których nie dało się przypisać (brak właściciela i osoby). */
  remaining: number;
}

/** Podział zadań bez osoby: właściciel leada albo pula „bez właściciela". */
export function planUnassignedTaskFix(
  rows: ReadonlyArray<{ id: string; lead: { owner_id: string | null } | null }>,
): { byOwner: Map<string, string[]>; orphans: string[] } {
  const byOwner = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const row of rows) {
    const owner = row.lead?.owner_id ?? null;
    if (owner) byOwner.set(owner, [...(byOwner.get(owner) ?? []), row.id]);
    else orphans.push(row.id);
  }
  return { byOwner, orphans };
}

export const assignUnassignedCrmTasks = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => AssignUnassignedInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AssignUnassignedResult> => {
    const userId = (context as { userId: string }).userId;
    // Odczyt i zapis klientem użytkownika: RLS zawęża do najemcy z sesji.
    const result = await looseTable(context, "crm_tasks")
      .select("id, lead:crm_leads!crm_tasks_lead_id_fkey(owner_id)")
      .eq("status", "open")
      .is("assignee_id", null)
      .limit(data.limit);
    if (result.error) throw new Error(result.error.message);
    const rows = rowsOf(result) as Array<{ id: string; lead: { owner_id: string | null } | null }>;
    const { byOwner, orphans } = planUnassignedTaskFix(rows);

    let fallback: string | null = null;
    if (data.fallback_assignee_id && orphans.length > 0) {
      // Osoba spoza zespołu najemcy nie dostanie cudzych zadań: rola
      // sprawdzana w najemcy wołającego (profil pod RLS, role rolą serwisową,
      // ta sama granica co picker właściciela `listStaffUsers`).
      const { data: me, error: meError } = await looseTable(context, "profiles")
        .select("tenant_id")
        .eq("id", userId)
        .maybeSingle();
      if (meError) throw new Error(meError.message);
      const tenantId = (me as { tenant_id?: string } | null)?.tenant_id;
      if (!tenantId) throw new Error("tenant_unresolved");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const roles = await looseClient({ supabase: supabaseAdmin })
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("user_id", data.fallback_assignee_id)
        .in("role", ["admin", "editor", "super_admin"])
        .limit(1);
      if (roles.error) throw new Error(roles.error.message);
      if (rowsOf(roles).length === 0) throw new Error("assignee_not_staff");
      fallback = data.fallback_assignee_id;
    }

    let assignedToOwner = 0;
    for (const [owner, ids] of byOwner) {
      // `is(assignee_id, null)` w zapisie: zadanie przypisane w międzyczasie
      // ręcznie nie zostanie nadpisane naprawą.
      const res = await looseTable(context, "crm_tasks")
        .update({ assignee_id: owner })
        .in("id", ids)
        .is("assignee_id", null);
      if (res.error) throw new Error(res.error.message);
      assignedToOwner += ids.length;
    }
    let assignedToFallback = 0;
    if (fallback && orphans.length > 0) {
      const res = await looseTable(context, "crm_tasks")
        .update({ assignee_id: fallback })
        .in("id", orphans)
        .is("assignee_id", null);
      if (res.error) throw new Error(res.error.message);
      assignedToFallback = orphans.length;
    }
    return {
      assigned_to_owner: assignedToOwner,
      assigned_to_fallback: assignedToFallback,
      remaining: orphans.length - assignedToFallback,
    };
  });

// ── Import CSV z dedupem ─────────────────────────────────────────────────────

/** Porcja per wywołanie RPC - crm_import_leads odrzuca większe (timeouty). */
export const CRM_IMPORT_CHUNK_SIZE = 500;

// Limity pól z JEDNEGO źródła z mapowaniem pliku (`importMapping.ts`, I9
// Z-I9b-15): dialog zgłasza wartość ponad limit z numerem wiersza i blokuje
// import, więc serwer nie wywraca całej porcji na wartości, której klient
// nie znał - i nikt niczego nie przycina.
const ImportRowInput = z.object({
  email: z.string().trim().min(3).max(LEAD_IMPORT_VALUE_MAX.email),
  first_name: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.first_name).optional(),
  last_name: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.last_name).optional(),
  phone: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.phone).optional(),
  company: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.company).optional(),
  position: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.position).optional(),
  linkedin_url: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.linkedin_url).optional(),
  country: z.string().trim().max(LEAD_IMPORT_VALUE_MAX.country).optional(),
  tags: z.array(z.string().trim().min(1).max(CRM_TAG_MAX)).max(IMPORT_MAX_TAGS).optional(),
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
  .middleware([requireCrmStaff])
  .validator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }): Promise<CrmImportSummary> => {
    // Cała praca (dedup po email_norm, merge przez crm_upsert_from_form, unia
    // tagów) dzieje się w JEDNEJ transakcji RPC - guard is_staff + tenant
    // w środku (obrona w głąb obok requireCrmStaff).
    const { data: result, error } = await looseClient(context).rpc("crm_import_leads", {
      p_rows: data.rows,
      p_source: data.source,
    });
    if (error) throw new Error(error.message);
    return parseImportSummary(result);
  });
