// CRM Companies server functions. Zwracamy dane w formie JSON string, aby
// uniknąć problemów z serializacją Supabase (jsonb) — analogicznie do
// crm.functions.ts. Wszystkie fetche jadą przez `requireStaff`, więc RLS
// (tenant_id = current_tenant_id()) obowiązuje automatycznie.
import { createServerFn } from "@tanstack/react-start";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { z } from "zod";

type AnyQuery = {
  select: (s: string, opts?: { count?: "exact"; head?: boolean }) => AnyQuery;
  order: (c: string, o: { ascending: boolean }) => AnyQuery;
  limit: (n: number) => AnyQuery;
  eq: (c: string, v: unknown) => AnyQuery;
  in: (c: string, v: unknown[]) => AnyQuery;
  or: (f: string) => AnyQuery;
  ilike: (c: string, v: string) => AnyQuery;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then: <R>(fn: (r: { data: unknown; error: { message: string } | null }) => R) => Promise<R>;
};
const tbl = (ctx: { supabase: unknown }, name: string): AnyQuery =>
  (ctx.supabase as { from: (t: string) => AnyQuery }).from(name);

// Wrapper do zapisów - zwraca `from()` z klienta Supabase bez zawężania
// typu do AnyQuery (który nie eksponuje `insert`/`update`).
const write = (
  ctx: { supabase: unknown },
  name: string,
): {
  insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
} =>
  (
    ctx.supabase as {
      from: (t: string) => {
        insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
      };
    }
  ).from(name);

const j = (v: unknown): string => JSON.stringify(v ?? null);

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const listCrmCompanies = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    let q = tbl(context, "crm_companies")
      .select(
        "id, name, domain, country, branch, city, website, phone, address, postal_code, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.search) {
      const s = `%${data.search.toLowerCase().replace(/[%_,()"\\]/g, "")}%`;
      q = q.or(`name.ilike.${s},domain.ilike.${s},city.ilike.${s},country.ilike.${s}`);
    }
    const { data: rows, error } = await (q as unknown as Promise<{
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    const ids = list.map((r) => r.id);

    // Aggregacja leadów i profili po stronie serwera (jednorazowe pobrania).
    let leadsAgg: Record<string, { total: number; lastActivity: string | null }> = {};
    let contactsAgg: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: leadRows } = (await tbl(context, "crm_leads")
        .select("company_id, last_activity_at")
        .in("company_id", ids)
        .limit(5000)) as unknown as {
        data: Array<{ company_id: string | null; last_activity_at: string | null }> | null;
      };
      for (const r of leadRows ?? []) {
        if (!r.company_id) continue;
        const agg = leadsAgg[r.company_id] ?? { total: 0, lastActivity: null };
        agg.total += 1;
        if (r.last_activity_at && (!agg.lastActivity || r.last_activity_at > agg.lastActivity)) {
          agg.lastActivity = r.last_activity_at;
        }
        leadsAgg[r.company_id] = agg;
      }
      const { data: profileRows } = (await tbl(context, "profiles")
        .select("current_company_id")
        .in("current_company_id", ids)
        .limit(5000)) as unknown as {
        data: Array<{ current_company_id: string | null }> | null;
      };
      for (const r of profileRows ?? []) {
        if (!r.current_company_id) continue;
        contactsAgg[r.current_company_id] = (contactsAgg[r.current_company_id] ?? 0) + 1;
      }
    }

    const enriched = list.map((r) => ({
      ...r,
      leads_count: leadsAgg[r.id]?.total ?? 0,
      last_lead_activity_at: leadsAgg[r.id]?.lastActivity ?? null,
      contacts_count: contactsAgg[r.id] ?? 0,
    }));
    return { json: j(enriched) };
  });


const IdInput = z.object({ id: z.string().uuid() });

export const getCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: company, error } = await tbl(context, "crm_companies")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!company) throw new Error("not_found");

    const fetchAll = async <T>(p: Promise<{ data: unknown }>): Promise<T> =>
      ((await p).data ?? []) as T;

    const [profiles, leads] = await Promise.all([
      fetchAll(
        tbl(context, "profiles")
          .select(
            "id, display_name, first_name, last_name, avatar_url, job_title, location, slug, contact_email, discoverable",
          )
          .eq("current_company_id", data.id)
          .order("updated_at", { ascending: false })
          .limit(200) as unknown as Promise<{ data: unknown }>,
      ),
      fetchAll(
        tbl(context, "crm_leads")
          .select(
            "id, email, first_name, last_name, phone, position, stage, tags, score, score_band, last_activity_at, created_at",
          )
          .eq("company_id", data.id)
          .order("last_activity_at", { ascending: false })
          .limit(200) as unknown as Promise<{ data: unknown }>,
      ),
    ]);

    return { json: j({ company, profiles, leads }) };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  branch: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  postal_code: z.string().trim().max(20).nullable().optional(),
  website: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
});

export const updateCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const supa = context.supabase as unknown as {
      from: (t: string) => {
        update: (v: unknown) => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await supa.from("crm_companies").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    try {
      await write(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.company.update",
        entity_type: "crm_company",
        entity_id: id,
        metadata: { fields: Object.keys(patch) },
      } as unknown as never);
    } catch {
      /* noop - audyt nie może blokować sukcesu mutacji */
    }
    return { ok: true };
  });

// ---- Dodawanie kontaktu (lead) powiązanego z firmą ----------------------
const CreateContactInput = z.object({
  company_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  first_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().max(100).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  position: z.string().trim().max(200).optional().nullable(),
});

export const createCrmContactForCompany = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => CreateContactInput.parse(d))
  .handler(async ({ data, context }) => {
    const supa = context.supabase as unknown as {
      from: (t: string) => {
        insert: (v: unknown) => {
          select: (s: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        };
      };
    };
    const { data: row, error } = await supa
      .from("crm_leads")
      .insert({
        company_id: data.company_id,
        email: data.email,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        phone: data.phone ?? null,
        position: data.position ?? null,
        stage: "new",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("duplicate_email");
      throw new Error(error.message);
    }
    try {
      await write(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.contact.create",
        entity_type: "crm_lead",
        entity_id: row?.id ?? null,
        metadata: { company_id: data.company_id, email: data.email },
      } as unknown as never);
    } catch {
      /* noop */
    }
    return { ok: true, id: row?.id ?? null };
  });

// ---- Notatka na poziomie firmy (przez audit_log, brak dedykowanej tabeli) ---
const NoteInput = z.object({
  company_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const addCrmCompanyNote = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => NoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await write(context, "audit_log").insert({
      actor_id: (context as { userId: string }).userId,
      action: "crm.company.note",
      entity_type: "crm_company",
      entity_id: data.company_id,
      metadata: { body: data.body },
    } as unknown as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Feed aktywności firmy (audit_log + notatki + leady) ----------------
export const getCrmCompanyActivity = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: leadRows } = (await tbl(context, "crm_leads")
      .select("id, email, first_name, last_name, created_at, last_activity_at, stage")
      .eq("company_id", data.id)
      .order("last_activity_at", { ascending: false })
      .limit(200)) as unknown as {
      data: Array<{
        id: string;
        email: string;
        first_name: string | null;
        last_name: string | null;
        created_at: string;
        last_activity_at: string | null;
        stage: string;
      }> | null;
    };
    const leads = leadRows ?? [];
    const leadIds = leads.map((l) => l.id);
    const leadLabel: Record<string, string> = {};
    for (const l of leads) {
      leadLabel[l.id] =
        [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.id.slice(0, 6);
    }

    const auditCompanyP = tbl(context, "audit_log")
      .select("id, action, entity_type, entity_id, metadata, actor_id, created_at")
      .eq("entity_type", "crm_company")
      .eq("entity_id", data.id)
      .order("created_at", { ascending: false })
      .limit(50) as unknown as Promise<{ data: unknown }>;
    const auditLeadsP =
      leadIds.length > 0
        ? (tbl(context, "audit_log")
            .select("id, action, entity_type, entity_id, metadata, actor_id, created_at")
            .in("entity_id", leadIds)
            .order("created_at", { ascending: false })
            .limit(100) as unknown as Promise<{ data: unknown }>)
        : Promise.resolve({ data: [] as unknown[] });
    const notesP =
      leadIds.length > 0
        ? (tbl(context, "crm_lead_notes")
            .select("id, body, lead_id, author_id, created_at")
            .in("lead_id", leadIds)
            .order("created_at", { ascending: false })
            .limit(50) as unknown as Promise<{ data: unknown }>)
        : Promise.resolve({ data: [] as unknown[] });

    const [a1, a2, notes] = await Promise.all([auditCompanyP, auditLeadsP, notesP]);
    const audit = [
      ...((a1.data as Array<Record<string, unknown>>) ?? []),
      ...((a2.data as Array<Record<string, unknown>>) ?? []),
    ];

    type Event = {
      id: string;
      kind: "audit" | "note" | "lead_created";
      action: string;
      created_at: string;
      actor_id: string | null;
      lead_id: string | null;
      lead_label: string | null;
      body?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const events: Event[] = [];
    for (const a of audit) {
      const entityType = String(a.entity_type ?? "");
      const entityId = (a.entity_id as string | null) ?? null;
      const action = String(a.action ?? "unknown");
      const meta = (a.metadata as Record<string, unknown> | null) ?? null;
      const isCompanyNote = action === "crm.company.note";
      events.push({
        id: `a:${a.id as string}`,
        kind: isCompanyNote ? "note" : "audit",
        action,
        created_at: String(a.created_at ?? ""),
        actor_id: (a.actor_id as string | null) ?? null,
        lead_id: entityType === "crm_lead" ? entityId : null,
        lead_label:
          entityType === "crm_lead" && entityId ? leadLabel[entityId] ?? null : null,
        body: isCompanyNote ? (meta?.body as string | null) ?? null : undefined,
        metadata: meta,
      });
    }
    for (const n of (notes.data as Array<Record<string, unknown>>) ?? []) {
      const leadId = (n.lead_id as string) ?? null;
      events.push({
        id: `n:${n.id as string}`,
        kind: "note",
        action: "crm.note.add",
        created_at: String(n.created_at ?? ""),
        actor_id: (n.author_id as string | null) ?? null,
        lead_id: leadId,
        lead_label: leadId ? leadLabel[leadId] ?? null : null,
        body: (n.body as string | null) ?? null,
      });
    }
    for (const l of leads) {
      events.push({
        id: `lc:${l.id}`,
        kind: "lead_created",
        action: "crm.lead.created",
        created_at: l.created_at,
        actor_id: null,
        lead_id: l.id,
        lead_label: leadLabel[l.id] ?? null,
      });
    }
    events.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
    return { json: j(events.slice(0, 100)) };
  });
