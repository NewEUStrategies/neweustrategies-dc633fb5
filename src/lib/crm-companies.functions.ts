// CRM Companies server functions. Zwracamy dane w formie JSON string, aby
// uniknąć problemów z serializacją Supabase (jsonb) — analogicznie do
// crm.functions.ts. Wszystkie fetche jadą przez `requireCrmStaff`, więc RLS
// (tenant_id = current_tenant_id()) obowiązuje automatycznie.
import { createServerFn } from "@tanstack/react-start";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { z } from "zod";
import { looseClient, looseTable, rowsOf, type LooseQuery } from "@/lib/supabase/looseQuery";

const j = (v: unknown): string => JSON.stringify(v ?? null);

/** Wiersz agregatu z `crm_companies_aggregates` - liczby bywają napisami. */
interface CompanyAggregate {
  readonly company_id: string;
  readonly leads_count: number | string;
  readonly last_lead_activity_at: string | null;
  readonly contacts_count: number | string;
}

function isCompanyAggregate(row: unknown): row is CompanyAggregate {
  return (
    row !== null &&
    typeof row === "object" &&
    typeof (row as { company_id?: unknown }).company_id === "string"
  );
}

/** Wiersz z identyfikatorem - minimum, jakiego potrzebuje agregacja po firmach. */
function hasId(row: unknown): row is { id: string } {
  return (
    row !== null && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
  );
}

/** Lead w feedzie aktywności firmy - pola czytane niżej przy budowie etykiet. */
interface CompanyLeadRow {
  readonly id: string;
  readonly email: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly created_at: string;
  readonly last_activity_at: string | null;
  readonly stage: string;
}

function isCompanyLead(row: unknown): row is CompanyLeadRow {
  if (row === null || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.email === "string";
}

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  country: z.string().trim().max(120).optional(),
  branch: z.string().trim().max(200).optional(),
  updated_from: z.string().datetime().optional(),
  updated_to: z.string().datetime().optional(),
});

export const listCrmCompanies = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    let q = looseTable(context, "crm_companies")
      .select(
        "id, name, domain, country, branch, city, website, phone, address, postal_code, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.country) q = q.eq("country", data.country);
    if (data.branch) q = q.eq("branch", data.branch);
    if (data.updated_from) q = q.gte("updated_at", data.updated_from);
    if (data.updated_to) q = q.lte("updated_at", data.updated_to);
    if (data.search) {
      const s = `%${data.search.toLowerCase().replace(/[%_,()"\\]/g, "")}%`;
      q = q.or(`name.ilike.${s},domain.ilike.${s},city.ilike.${s},country.ilike.${s}`);
    }
    const listed = await q;
    if (listed.error) throw new Error(listed.error.message);
    const list = rowsOf(listed).filter(hasId);
    const ids = list.map((r) => r.id);

    // Jedno wywołanie RPC agreguje leady + kontakty po stronie bazy
    // (zamiast pobierania do 5000 wierszy z crm_leads i profiles).
    const leadsAgg: Record<string, { total: number; lastActivity: string | null }> = {};
    const contactsAgg: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: aggRows, error: aggError } = await looseClient(context).rpc(
        "crm_companies_aggregates",
        { _company_ids: ids },
      );
      if (aggError) throw new Error(aggError.message);
      for (const r of (Array.isArray(aggRows) ? aggRows : []).filter(isCompanyAggregate)) {
        leadsAgg[r.company_id] = {
          total: Number(r.leads_count) || 0,
          lastActivity: r.last_lead_activity_at ?? null,
        };
        contactsAgg[r.company_id] = Number(r.contacts_count) || 0;
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
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: company, error } = await looseTable(context, "crm_companies")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!company) throw new Error("not_found");

    const fetchAll = async (query: LooseQuery): Promise<unknown[]> => rowsOf(await query);

    const [profiles, leads] = await Promise.all([
      fetchAll(
        looseTable(context, "profiles")
          .select(
            "id, display_name, first_name, last_name, avatar_url, job_title, location, slug, contact_email, discoverable",
          )
          .eq("current_company_id", data.id)
          .order("updated_at", { ascending: false })
          .limit(200),
      ),
      fetchAll(
        looseTable(context, "crm_leads")
          .select(
            "id, email, first_name, last_name, phone, position, stage, tags, score, score_band, last_activity_at, created_at",
          )
          .eq("company_id", data.id)
          .order("last_activity_at", { ascending: false })
          .limit(200),
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
  logo_url: z.string().trim().url().max(1000).nullable().optional(),
});

export const updateCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await looseTable(context, "crm_companies").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    try {
      await looseTable(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.company.update",
        entity_type: "crm_company",
        entity_id: id,
        metadata: { fields: Object.keys(patch) },
      });
    } catch {
      /* noop - audyt nie może blokować sukcesu mutacji */
    }
    return { ok: true };
  });

// ---- Tworzenie firmy ----------------------------------------------------
// `crm_companies.tenant_id` jest NOT NULL bez defaultu, a polityka INSERT
// wymaga `tenant_id = current_tenant_id() AND created_by = auth.uid()`, więc
// oba pola rozwiązujemy SERWEROWO (tenant z profilu staffu, autor z sesji) -
// klient nie ustawia tenanta. Puste stringi z formularza normalizujemy do NULL.
const CreateCompanyInput = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).optional(),
  country: z.string().trim().max(120).optional(),
  branch: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  postal_code: z.string().trim().max(20).optional(),
  website: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(60).optional(),
});

const nullIfEmpty = (v: string | undefined): string | null => {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
};

export const createCrmCompany = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => CreateCompanyInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    // Tenant z profilu bieżącego staffu (requireCrmStaff nie przekazuje go dalej).
    const { data: profile, error: profileError } = await looseTable(context, "profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    const tenantId = (profile as { tenant_id?: string } | null)?.tenant_id;
    if (!tenantId) throw new Error("tenant_unresolved");

    const { data: row, error } = await looseTable(context, "crm_companies")
      .insert({
        tenant_id: tenantId,
        created_by: userId,
        name: data.name,
        domain: nullIfEmpty(data.domain),
        country: nullIfEmpty(data.country),
        branch: nullIfEmpty(data.branch),
        city: nullIfEmpty(data.city),
        address: nullIfEmpty(data.address),
        postal_code: nullIfEmpty(data.postal_code),
        website: nullIfEmpty(data.website),
        phone: nullIfEmpty(data.phone),
      })
      .select("id")
      .single();
    if (error) {
      // Unikat (tenant_id, name_norm) - firma o tej nazwie już istnieje.
      if (error.code === "23505") throw new Error("duplicate_name");
      throw new Error(error.message);
    }
    try {
      await looseTable(context, "audit_log").insert({
        actor_id: userId,
        action: "crm.company.create",
        entity_type: "crm_company",
        entity_id: hasId(row) ? row.id : null,
        metadata: { name: data.name },
      });
    } catch {
      /* noop - audyt nie może blokować sukcesu mutacji */
    }
    return { ok: true, id: hasId(row) ? row.id : null };
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
  .middleware([requireCrmStaff])
  .validator((d) => CreateContactInput.parse(d))
  .handler(async ({ data, context }) => {
    // Resolve the company's tenant so the lead lands in the same tenant as the
    // parent company (the crm_leads RLS requires tenant_id = current_tenant_id()).
    const { data: company } = await looseTable(context, "crm_companies")
      .select("tenant_id")
      .eq("id", data.company_id)
      .maybeSingle();
    const companyTenantId = (company as { tenant_id?: string } | null)?.tenant_id;
    if (!companyTenantId) throw new Error("company_not_found");

    const { data: row, error } = await looseTable(context, "crm_leads")
      .insert({
        tenant_id: companyTenantId,
        company_id: data.company_id,
        email: data.email,
        email_norm: data.email,
        first_name: data.first_name ?? null,
        last_name: data.last_name ?? null,
        phone: data.phone ?? null,
        position: data.position ?? null,
        stage: "new",
        source_type: "manual",
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("duplicate_email");
      throw new Error(error.message);
    }
    try {
      await looseTable(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.contact.create",
        entity_type: "crm_lead",
        entity_id: hasId(row) ? row.id : null,
        metadata: { company_id: data.company_id, email: data.email },
      });
    } catch {
      /* noop */
    }
    return { ok: true, id: hasId(row) ? row.id : null };
  });

// ---- Notatka na poziomie firmy (przez audit_log, brak dedykowanej tabeli) ---
const NoteInput = z.object({
  company_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const addCrmCompanyNote = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => NoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await looseTable(context, "audit_log").insert({
      actor_id: (context as { userId: string }).userId,
      action: "crm.company.note",
      entity_type: "crm_company",
      entity_id: data.company_id,
      metadata: { body: data.body },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Feed aktywności firmy (audit_log + notatki + leady) ----------------
export const getCrmCompanyActivity = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const leadRows = await looseTable(context, "crm_leads")
      .select("id, email, first_name, last_name, created_at, last_activity_at, stage")
      .eq("company_id", data.id)
      .order("last_activity_at", { ascending: false })
      .limit(200);
    const leads = rowsOf(leadRows).filter(isCompanyLead);
    const leadIds = leads.map((l) => l.id);
    const leadLabel: Record<string, string> = {};
    for (const l of leads) {
      leadLabel[l.id] =
        [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.id.slice(0, 6);
    }

    const auditCompanyP = looseTable(context, "audit_log")
      .select("id, action, entity_type, entity_id, metadata, actor_id, created_at")
      .eq("entity_type", "crm_company")
      .eq("entity_id", data.id)
      .order("created_at", { ascending: false })
      .limit(50);
    const auditLeadsP =
      leadIds.length > 0
        ? looseTable(context, "audit_log")
            .select("id, action, entity_type, entity_id, metadata, actor_id, created_at")
            .in("entity_id", leadIds)
            .order("created_at", { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [] as unknown[] });
    const notesP =
      leadIds.length > 0
        ? looseTable(context, "crm_lead_notes")
            .select("id, body, lead_id, author_id, created_at")
            .in("lead_id", leadIds)
            .order("created_at", { ascending: false })
            .limit(50)
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
        lead_label: entityType === "crm_lead" && entityId ? (leadLabel[entityId] ?? null) : null,
        body: isCompanyNote ? ((meta?.body as string | null) ?? null) : undefined,
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
        lead_label: leadId ? (leadLabel[leadId] ?? null) : null,
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

// ============ Bulk operations ============

const BulkUpdateInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  country: z.string().trim().max(120).nullable().optional(),
  branch: z.string().trim().max(200).nullable().optional(),
});

export const bulkUpdateCrmCompanies = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => BulkUpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { ids, ...patch } = data;
    if (Object.keys(patch).length === 0) return { ok: true, updated: 0 };
    const res = await looseTable(context, "crm_companies").update(patch).in("id", ids);
    if (res.error) throw new Error(res.error.message);
    try {
      await looseTable(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.company.bulk_update",
        entity_type: "crm_company",
        entity_id: null,
        metadata: { count: ids.length, fields: Object.keys(patch) },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true, updated: ids.length };
  });

const BulkDeleteInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export const bulkDeleteCrmCompanies = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => BulkDeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const client = looseClient(context);
    const userId = (context as { userId: string }).userId;
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      client.rpc("has_role", { _user_id: userId, _role: "admin" }),
      client.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    if (!isAdmin && !isSuper) throw new Error("forbidden");

    const res = await looseTable(context, "crm_companies").delete().in("id", data.ids);
    if (res.error) throw new Error(res.error.message);
    try {
      await looseTable(context, "audit_log").insert({
        actor_id: userId,
        action: "crm.company.bulk_delete",
        entity_type: "crm_company",
        entity_id: null,
        metadata: { count: data.ids.length, ids: data.ids },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true, deleted: data.ids.length };
  });
