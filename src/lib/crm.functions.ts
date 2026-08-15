// CRM server functions. To avoid TanStack Start's strict structural serializer
// rejecting Supabase `unknown` (inet/jsonb) columns, deep results are returned
// as a JSON string in `json` and parsed on the client (see lib/crm.client.ts).
import { createServerFn } from "@tanstack/react-start";
import { requireCrmStaff } from "@/integrations/supabase/require-staff";
import { withCommandIdempotency, type RpcClient } from "@/lib/http/idempotency";
import { DEFAULT_SCORING_WEIGHTS } from "@/lib/crm/scoring";
import { csvDocument } from "@/lib/crm/csv";
import {
  CONSENT_LOG_TIMELINE_SELECT,
  consentExcerpt,
  type ConsentLogTimelineRow,
} from "@/lib/crm/consentLog";
import { z } from "zod";
import {
  looseClient,
  looseTable,
  rowsOf,
  fetchRows,
  type LooseQuery,
} from "@/lib/supabase/looseQuery";

const STAGE_ENUM = z.enum(["new", "contacted", "qualified", "proposal", "won", "lost", "archived"]);

// Sortowanie serwerowe: przy paginacji porządek MUSI liczyć się w SQL (strona
// posortowana klientem kłamałaby o kolejności globalnej). Klucze odpowiadają
// LeadSortSchema (lib/crm/leadViews.ts).
const SORT_ENUM = z.enum([
  "activity",
  "score",
  "created",
  "followUp",
  "company",
  "country",
  "stage",
  "name",
]);
type SortKey = z.infer<typeof SORT_ENUM>;

const SORT_COLUMNS: Record<SortKey, string> = {
  activity: "last_activity_at",
  score: "score",
  created: "created_at",
  followUp: "follow_up_at",
  company: "company",
  country: "country",
  stage: "stage",
  name: "first_name",
};

const ListInput = z.object({
  search: z.string().trim().max(200).optional(),
  stage: STAGE_ENUM.optional(),
  scope: z.enum(["tenant", "all"]).default("tenant"),
  // Paginacja serwerowa: limit = rozmiar strony, page liczona od 1. Odpowiedź
  // niesie total z count:"exact", więc admin zawsze widzi pełny rozmiar zbioru.
  limit: z.number().int().min(1).max(500).default(200),
  page: z.number().int().min(1).max(10_000).default(1),
  sort: SORT_ENUM.default("activity"),
  sort_dir: z.enum(["asc", "desc"]).default("desc"),
  band: z.enum(["hot", "warm", "cool", "cold"]).optional(),
  // Rozszerzone filtry: wybór właściciela (multi), tagi (multi, overlaps),
  // przedział score (0-100), kraj (dokładne dopasowanie po dwuznakowym kodzie
  // lub nazwie), zakres last_activity_at oraz created_at (ISO). Zostawiamy
  // pola opcjonalne, żeby nie łamać istniejących wywołań i saved_views.
  owner_ids: z.array(z.string().uuid()).max(50).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  score_min: z.number().int().min(0).max(100).optional(),
  score_max: z.number().int().min(0).max(100).optional(),
  country: z.string().trim().max(120).optional(),
  company: z.string().trim().max(200).optional(),
  newsletter_status: z.string().trim().max(40).optional(),
  consent_only: z.boolean().optional(),
  // Źródło jak w LeadFilterSchema: newsletter (status niepusty), form
  // (zgłoszenia formularzy bez newslettera), import (reszta).
  source: z.enum(["form", "newsletter", "import"]).optional(),
  activity_from: z.string().datetime().optional(),
  activity_to: z.string().datetime().optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
});
type ListParams = z.infer<typeof ListInput>;

const j = (v: unknown): string => JSON.stringify(v ?? null);

// Wspólna aplikacja filtrów listy leadów - jedno źródło prawdy dla listy
// (paginowanej) i eksportu CSV, żeby eksport zawsze odpowiadał temu, co admin
// widzi po filtrach.
function applyLeadListFilters(q: LooseQuery, data: ListParams): LooseQuery {
  if (data.stage) q = q.eq("stage", data.stage);
  if (data.band) q = q.eq("score_band", data.band);
  if (data.owner_ids && data.owner_ids.length > 0) q = q.in("owner_id", data.owner_ids);
  if (data.tags && data.tags.length > 0) q = q.overlaps("tags", data.tags);
  if (typeof data.score_min === "number") q = q.gte("score", data.score_min);
  if (typeof data.score_max === "number") q = q.lte("score", data.score_max);
  if (data.country) q = q.eq("country", data.country);
  if (data.company) q = q.eq("company", data.company);
  if (data.newsletter_status) q = q.eq("newsletter_status", data.newsletter_status);
  if (data.consent_only) q = q.eq("marketing_consent", true);
  if (data.source === "newsletter") q = q.not("newsletter_status", "is", null);
  if (data.source === "form") q = q.is("newsletter_status", null).gte("source_count", 1);
  if (data.source === "import") {
    q = q.is("newsletter_status", null).or("source_count.is.null,source_count.lte.0");
  }
  if (data.activity_from) q = q.gte("last_activity_at", data.activity_from);
  if (data.activity_to) q = q.lte("last_activity_at", data.activity_to);
  if (data.created_from) q = q.gte("created_at", data.created_from);
  if (data.created_to) q = q.lte("created_at", data.created_to);
  if (data.search) {
    // Strip LIKE wildcards and PostgREST .or() metacharacters so the search
    // term can't inject extra filter conditions (RLS still scopes rows, but
    // the term must not alter the query's filter logic).
    const s = `%${data.search.toLowerCase().replace(/[%_,()"\\]/g, "")}%`;
    q = q.or(`email.ilike.${s},first_name.ilike.${s},last_name.ilike.${s},company.ilike.${s}`);
  }
  return q;
}

function applyLeadListSort(q: LooseQuery, data: ListParams): LooseQuery {
  const ascending = data.sort_dir === "asc";
  // nullsFirst: false trzyma puste follow-upy/firmy na końcu niezależnie od
  // kierunku; id jako tiebreaker daje deterministyczne okna paginacji.
  q = q.order(SORT_COLUMNS[data.sort], { ascending, nullsFirst: false });
  if (data.sort === "name") q = q.order("last_name", { ascending, nullsFirst: false });
  return q.order("id", { ascending: true });
}

export const listCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const view = data.scope === "all" ? "crm_leads_all" : "crm_leads";
    const from = (data.page - 1) * data.limit;
    let q = looseTable(context, view).select("*", { count: "exact" });
    q = applyLeadListFilters(q, data);
    q = applyLeadListSort(q, data).range(from, from + data.limit - 1);
    const { data: leads, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      json: j(leads ?? []),
      total: count ?? 0,
      page: data.page,
      pageSize: data.limit,
    };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const getCrmLead = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: lead, error } = await looseTable(context, "crm_leads")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Lead not found");
    const L = lead as { email: string; tenant_id: string; id: string };

    const [messages, subs, consents, notes] = await Promise.all([
      fetchRows(
        looseTable(context, "contact_messages")
          .select(
            // `form_id` + `custom` niosą warstwę rekrutacyjną (rola, dział,
            // poziom, termin, LinkedIn, CV), a osadzone `career_applications`
            // dokłada etap procesu - bez nich moduł „Rekrutacja" na karcie
            // kontaktu nie ma z czego się zrenderować.
            "id, form_type, form_id, form_name, subject, message, lang, source, page_url, referer, ip, consents, newsletter_opt_in, consent, custom, created_at, career_applications(id, stage, stage_changed_at, stage_note, rating, rejection_reason, next_step_at, owner_id)",
          )
          .ilike("email", L.email)
          .eq("tenant_id", L.tenant_id)
          .order("created_at", { ascending: false })
          .limit(100),
      ),
      fetchRows(
        looseTable(context, "newsletter_subscribers")
          .select(
            "id, status, source, source_form_id, source_form_name, language, ip, consents, confirmed_at, created_at, updated_at",
          )
          .ilike("email", L.email)
          .eq("tenant_id", L.tenant_id)
          .order("created_at", { ascending: false })
          .limit(50),
      ),
      fetchRows(
        looseTable(context, "crm_consent_log")
          .select("*")
          .ilike("email", L.email)
          .eq("tenant_id", L.tenant_id)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
      fetchRows(
        looseTable(context, "crm_lead_notes")
          .select("id, body, author_id, created_at")
          .eq("lead_id", L.id)
          .order("created_at", { ascending: false }),
      ),
    ]);

    // Zaczytaj avatar_url z profiles po e-mailu (email lub contact_email),
    // żeby w widoku szczegółów pokazać zdjęcie profilowe użytkownika.
    let profile_avatar_url: string | null = null;
    try {
      const email = L.email?.toLowerCase() ?? "";
      if (email) {
        const { data: prof } = (await looseTable(context, "profiles")
          .select("avatar_url, email, contact_email")
          .or(`email.ilike.${email},contact_email.ilike.${email}`)
          .eq("tenant_id", L.tenant_id)
          .limit(1)
          .maybeSingle()) as { data: { avatar_url: string | null } | null };
        profile_avatar_url = prof?.avatar_url ?? null;
      }
    } catch {
      profile_avatar_url = null;
    }

    return {
      json: j({ lead, messages, subscriptions: subs, consents, notes, profile_avatar_url }),
    };
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  stage: STAGE_ENUM.optional(),
  owner_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(40).optional(),
  follow_up_at: z.string().datetime().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  position: z.string().max(200).nullable().optional(),
  country: z.string().max(120).nullable().optional(),
  linkedin_url: z
    .string()
    .max(400)
    .nullable()
    .optional()
    .refine((v) => v == null || v === "" || /^https?:\/\//i.test(v), {
      message: "linkedin_url must start with http(s)://",
    }),
});

export const updateCrmLead = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => UpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;

    // Tenant isolation: read the lead first, then restrict the update to that
    // tenant. Also validate any company_id change belongs to the same tenant.
    const { data: lead } = (await looseTable(context, "crm_leads")
      .select("id, tenant_id")
      .eq("id", id)
      .maybeSingle()) as { data: { id: string; tenant_id: string } | null };
    if (!lead) throw new Error("lead_not_found");

    if (patch.company_id) {
      const { data: company } = (await looseTable(context, "crm_companies")
        .select("id, tenant_id")
        .eq("id", patch.company_id)
        .maybeSingle()) as { data: { id: string; tenant_id: string } | null };
      if (!company || company.tenant_id !== lead.tenant_id) {
        throw new Error("company_tenant_mismatch");
      }
    }

    const res = await looseTable(context, "crm_leads")
      .update({ ...patch, tenant_id: lead.tenant_id })
      .eq("id", id)
      .eq("tenant_id", lead.tenant_id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

// Metering: ile bezpłatnych artykułów zużył użytkownik powiązany z leadem
// w bieżącym miesiącu kalendarzowym. Dopasowanie po e-mailu (email/contact_email)
// w obrębie tenanta. Widoczne wyłącznie dla staff (requireCrmStaff).
export const getCrmLeadMonthlyMetering = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: lead } = (await looseTable(context, "crm_leads")
      .select("email, tenant_id")
      .eq("id", data.id)
      .maybeSingle()) as { data: { email: string; tenant_id: string } | null };
    if (!lead?.email) return { json: j(null) };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = looseClient({ supabase: supabaseAdmin });
    const emailLc = lead.email.toLowerCase().replace(/[%_,()"\\]/g, "");
    const profRes = await admin
      .from("profiles")
      .select("id")
      .or(`email.ilike.${emailLc},contact_email.ilike.${emailLc}`)
      .eq("tenant_id", lead.tenant_id)
      .limit(1)
      .returns<{ id: string }>();
    const userId = profRes.data?.[0]?.id ?? null;
    if (!userId) return { json: j(null) };

    const period = new Date();
    period.setUTCDate(1);
    period.setUTCHours(0, 0, 0, 0);
    const periodStr = period.toISOString().slice(0, 10);

    const [msRes, mvRes] = await Promise.all([
      admin
        .from("metering_settings")
        .select("member_monthly_limit, enabled")
        .eq("tenant_id", lead.tenant_id)
        .returns<{ member_monthly_limit: number | null; enabled: boolean | null }>()
        .maybeSingle(),
      admin
        .from("metered_views")
        .select("id")
        .eq("tenant_id", lead.tenant_id)
        .eq("user_id", userId)
        .eq("period_month", periodStr)
        .limit(1000),
    ]);
    const ms = msRes.data;
    const monthly_limit = ms?.member_monthly_limit ?? 5;
    const used = rowsOf(mvRes).length;
    return {
      json: j({
        used,
        monthly_limit,
        remaining: Math.max(monthly_limit - used, 0),
        period_month: periodStr,
        enabled: ms?.enabled ?? true,
        user_id: userId,
      }),
    };
  });

// Członkostwo leada: dopasowanie lead → profil po e-mailu (email/contact_email)
// w obrębie tenanta, potem te same źródła co RPC current_membership_tier
// (aktywne subskrypcje płatne, nadania poza planem, miejsca w organizacjach),
// rozstrzygnięte czystą funkcją resolveLeadMembership (lib/crm/membershipSummary).
// Sprzedaż widzi przy leadzie realny status członkowski - jedno źródło prawdy
// z /pricing i profilem, bez osobnej kolumny do desynchronizacji.
export const getCrmLeadMembership = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: lead } = (await looseTable(context, "crm_leads")
      .select("email, tenant_id")
      .eq("id", data.id)
      .maybeSingle()) as { data: { email: string; tenant_id: string } | null };
    if (!lead?.email) return { json: j(null) };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = looseClient({ supabase: supabaseAdmin });
    const emailLc = lead.email.toLowerCase().replace(/[%_,()"\\]/g, "");
    const profRes = await admin
      .from("profiles")
      .select("id")
      .or(`email.ilike.${emailLc},contact_email.ilike.${emailLc}`)
      .eq("tenant_id", lead.tenant_id)
      .limit(1)
      .returns<{ id: string }>();
    const userId = profRes.data?.[0]?.id ?? null;
    if (!userId) return { json: j(null) };

    const { resolveLeadMembership } = await import("@/lib/crm/membershipSummary");
    const [tiersRes, subsRes, grantsRes, seatsRes] = await Promise.all([
      admin
        .from("membership_tiers")
        .select("key, rank, name_pl, name_en, is_default")
        .eq("tenant_id", lead.tenant_id)
        .eq("active", true)
        .returns<{
          key: string;
          rank: number;
          name_pl: string;
          name_en: string;
          is_default: boolean;
        }>(),
      admin
        .from("user_subscriptions")
        .select(
          "id, status, started_at, current_period_end, canceled_at, plan:access_plans(id, name_pl, name_en, interval, tier_key)",
        )
        .eq("tenant_id", lead.tenant_id)
        .eq("user_id", userId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(20)
        .returns<{
          id: string;
          status: string;
          started_at: string;
          current_period_end: string | null;
          canceled_at: string | null;
          plan: {
            id: string;
            name_pl: string;
            name_en: string;
            interval: string;
            tier_key: string | null;
          } | null;
        }>(),
      admin
        .from("membership_grants")
        .select("tier_key, source, starts_at, expires_at, revoked_at")
        .eq("tenant_id", lead.tenant_id)
        .eq("user_id", userId)
        .limit(50)
        .returns<{
          tier_key: string;
          source: string;
          starts_at: string;
          expires_at: string | null;
          revoked_at: string | null;
        }>(),
      admin
        .from("organization_seats")
        .select(
          "claimed_at, org:member_organizations(id, name, tier_key, status, starts_at, expires_at)",
        )
        .eq("tenant_id", lead.tenant_id)
        .eq("user_id", userId)
        .limit(20)
        .returns<{
          claimed_at: string | null;
          org: {
            id: string;
            name: string;
            tier_key: string;
            status: string;
            starts_at: string;
            expires_at: string | null;
          } | null;
        }>(),
    ]);

    const summary = resolveLeadMembership({
      now: new Date(),
      userId,
      tiers: tiersRes.data ?? [],
      subscriptions: subsRes.data ?? [],
      grants: grantsRes.data ?? [],
      orgSeats: seatsRes.data ?? [],
    });
    return { json: j(summary) };
  });

// Profile sync: dopasowuje lead → profil po e-mailu (email/contact_email),
// zwraca podstawowe dane profilu + doświadczenie, umiejętności, aktualne CV,
// nagrody i wykształcenie. RLS experiences/skills jest owner-only, więc staff
// (po requireCrmStaff) używa admina.
//
// RODO: wyniki testu osobowości (Big5) CELOWO NIE są tu zwracane. Migracja
// 20260711120000 usunęła je z widoczności nawet dla adminów tenanta jako dane
// psychometryczne; odczyt service-rolem w CRM obchodziłby tę decyzję bez zgody
// i bez celu przetwarzania (audyt RODO). Do CRM nie są potrzebne.
const ProfileSyncInput = z.object({ lead_id: z.string().uuid() });
export const getCrmLeadProfileSync = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ProfileSyncInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: lead } = (await looseTable(context, "crm_leads")
      .select("email, tenant_id")
      .eq("id", data.lead_id)
      .maybeSingle()) as { data: { email: string; tenant_id: string } | null };
    if (!lead?.email) return { json: j(null) };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = looseClient({ supabase: supabaseAdmin });

    const emailLc = lead.email.toLowerCase().replace(/[%_,()"\\]/g, "");
    const profileRes = (await admin
      .from("profiles")
      .select(
        "id, tenant_id, display_name, first_name, last_name, avatar_url, cover_url, job_title, current_company, current_company_id, location, phone, slug, bio_pl, bio_en, linkedin_url, twitter_url, website_url, discoverable, verified_at, contact_email, email",
      )
      .or(`email.ilike.${emailLc},contact_email.ilike.${emailLc}`)
      .eq("tenant_id", lead.tenant_id)
      .limit(1)) as { data: Array<Record<string, unknown>> | null };
    const profile = profileRes.data?.[0] ?? null;
    if (!profile) return { json: j({ matched: false }) };

    const userId = profile.id as string;
    const tenantId = profile.tenant_id as string;

    const [expRes, skillsRes, cvRes, awardsRes, eduRes] = await Promise.all([
      admin
        .from("profile_experiences")
        .select(
          "id, role_title, company, location, start_date, end_date, is_current, description, logo_url",
        )
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .limit(50),
      admin
        .from("profile_skills")
        .select("id, name, level, endorsements_count")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .order("sort_order", { ascending: true })
        .limit(100),
      admin
        .from("profile_cv_files")
        .select("id, file_url, file_name, mime_type, size_bytes, version, uploaded_at")
        .eq("user_id", userId)
        .eq("is_current", true)
        .maybeSingle(),
      admin
        .from("profile_awards")
        .select("id, title, issuer, issued_on, description")
        .eq("user_id", userId)
        .order("issued_on", { ascending: false })
        .limit(20),
      admin
        .from("profile_education")
        .select("id, school, degree, field, start_date, end_date, description")
        .eq("user_id", userId)
        .order("start_date", { ascending: false })
        .limit(20),
    ]);

    return {
      json: j({
        matched: true,
        profile,
        experiences: (expRes as { data: unknown }).data ?? [],
        skills: (skillsRes as { data: unknown }).data ?? [],
        cv: (cvRes as { data: unknown }).data ?? null,
        awards: (awardsRes as { data: unknown }).data ?? [],
        education: (eduRes as { data: unknown }).data ?? [],
      }),
    };
  });

const NoteInput = z.object({
  lead_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  idempotency_key: z.string().trim().min(8).max(120).optional(),
});

export const addCrmNote = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => NoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const insertNote = async () => {
      const { error } = await looseTable(context, "crm_lead_notes").insert({
        lead_id: data.lead_id,
        body: data.body,
        author_id: userId,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    };
    // Idempotencja end-to-end (command_idempotency): retry HTTP / podwójne
    // wysłanie z tym samym kluczem dostaje zapamiętany wynik zamiast
    // zdublowanej notatki.
    if (data.idempotency_key) {
      const outcome = await withCommandIdempotency(context.supabase as unknown as RpcClient, {
        key: data.idempotency_key,
        command: "crm.add_note",
        run: insertNote,
      });
      return outcome.result;
    }
    return insertNote();
  });

export const deleteCrmNote = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const res = await looseTable(context, "crm_lead_notes").delete().eq("id", data.id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const exportCrmLeadsCsv = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const view = data.scope === "all" ? "crm_leads_all" : "crm_leads";
    let q = looseTable(context, view).select("*");
    // Eksport = dokładnie ten sam zestaw filtrów i porządek co lista (bez
    // paginacji, z twardym sufitem wierszy).
    q = applyLeadListFilters(q, data);
    q = applyLeadListSort(q, data).limit(5000);
    // Eksport CSV czyta kolumny po nazwie ze `cols`, więc wiersz opisujemy jako
    // słownik - nie znamy pełnego kształtu widoku, a i tak bierzemy z niego
    // tylko wymienione niżej pola.
    const { data: rows, error } = await q.returns<Record<string, unknown>>();
    if (error) throw new Error(error.message);
    const cols = [
      "email",
      "first_name",
      "last_name",
      "phone",
      "company",
      "stage",
      "score",
      "score_band",
      "tags",
      "newsletter_status",
      "marketing_consent",
      "source_count",
      "follow_up_at",
      "last_activity_at",
      "created_at",
    ];
    // Ucieczka i neutralizacja formuł: `lib/crm/csv`. Escaper stał tu wklejony
    // (i drugi raz w eksporcie kroniki niżej), a trzeci eksport CRM - lista firm
    // - miał własną wersję BEZ neutralizacji. Jedna reguła bezpieczeństwa
    // w trzech kopiach o trzech różnych poziomach ochrony; teraz jedna, testowana.
    return {
      csv: csvDocument(
        cols,
        (rows ?? []).map((r) => cols.map((c) => r[c])),
      ),
      count: rows?.length ?? 0,
    };
  });

// ============ Integrations: partnerzy CRM (multi-endpoint) ============
//
// Konfiguracja partnerów żyje w integration_endpoints (transport + sekret w
// Vault) i crm_webhook_endpoints (profil CRM: auth_kind, forward_stages,
// consent_mapping) - migracja 20260802131000. CRUD idzie klientem pod RLS
// (jak /admin/integrations); tutaj tylko ręczny push leada, który zamiast
// synchronicznego fetch-a ląduje w outboxie integration_deliveries (retry +
// backoff + status dead), a potem opportunistycznie budzi dispatcher.

const PushInput = z.object({
  lead_id: z.string().uuid(),
  endpoint_id: z.string().uuid().optional(),
});

export type PushLeadResult = {
  ok: boolean;
  enqueued: number;
  delivered: number;
  failed: number;
  error?: string;
};

export const pushLeadToPartners = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => PushInput.parse(d))
  .handler(async ({ data, context }): Promise<PushLeadResult> => {
    const rpc = rpcOf(context);
    const { data: enqueued, error } = await rpc("crm_enqueue_lead_push", {
      p_lead_id: data.lead_id,
      p_endpoint_id: data.endpoint_id ?? null,
    });
    if (error) throw new Error(error.message);
    const queued = Number(enqueued ?? 0);
    if (queued === 0) {
      return { ok: false, enqueued: 0, delivered: 0, failed: 0, error: "no_active_endpoints" };
    }
    // Natychmiastowy tick dispatchera, żeby ręczny push miał efekt od ręki;
    // gdy tick padnie, dostawa i tak zostaje w outboxie i pójdzie retry-em.
    const { runIntegrationDispatch } = await import("@/lib/integrations/dispatch.functions");
    try {
      const summary = await runIntegrationDispatch(Math.min(Math.max(queued * 2, 5), 20));
      return { ok: true, enqueued: queued, delivered: summary.delivered, failed: summary.failed };
    } catch {
      return { ok: true, enqueued: queued, delivered: 0, failed: 0 };
    }
  });

// ============ Timeline & exports ============

export type TimelineEvent = {
  id: string;
  type: "submit" | "consent" | "note" | "stage_change" | "webhook" | "newsletter";
  at: string;
  title: string;
  detail: string | null;
  meta: Record<string, unknown> | null;
};

async function buildLeadTimeline(
  context: { supabase: unknown },
  leadId: string,
): Promise<{ lead: Record<string, unknown>; events: TimelineEvent[] }> {
  const { data: lead, error } = await looseTable(context, "crm_leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !lead) throw new Error(error?.message ?? "Lead not found");
  const L = lead as { id: string; tenant_id: string; email: string };

  const [messages, subs, consents, notes, audits] = await Promise.all([
    fetchRows(
      looseTable(context, "contact_messages")
        .select("id, form_name, form_type, subject, message, page_url, lang, created_at")
        .ilike("email", L.email)
        .eq("tenant_id", L.tenant_id)
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<{
          id: string;
          form_name: string | null;
          form_type: string | null;
          subject: string | null;
          message: string;
          created_at: string;
          page_url: string | null;
          lang: string;
        }>(),
    ),
    fetchRows(
      looseTable(context, "newsletter_subscribers")
        .select("id, status, source_form_name, confirmed_at, created_at")
        .ilike("email", L.email)
        .eq("tenant_id", L.tenant_id)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<{
          id: string;
          status: string;
          source_form_name: string | null;
          confirmed_at: string | null;
          created_at: string;
        }>(),
    ),
    fetchRows(
      looseTable(context, "crm_consent_log")
        .select(CONSENT_LOG_TIMELINE_SELECT)
        .ilike("email", L.email)
        .eq("tenant_id", L.tenant_id)
        .order("created_at", { ascending: false })
        .limit(500)
        .returns<ConsentLogTimelineRow>(),
    ),
    fetchRows(
      looseTable(context, "crm_lead_notes")
        .select("id, body, author_id, created_at")
        .eq("lead_id", L.id)
        .order("created_at", { ascending: false })
        .returns<{ id: string; body: string; author_id: string | null; created_at: string }>(),
    ),
    fetchRows(
      looseTable(context, "audit_log")
        .select("id, action, actor_id, metadata, created_at")
        .eq("entity_type", "crm_lead")
        .eq("entity_id", L.id)
        .order("created_at", { ascending: false })
        .limit(500)
        .returns<{
          id: string;
          action: string;
          actor_id: string | null;
          metadata: Record<string, unknown> | null;
          created_at: string;
        }>(),
    ),
  ]);

  const ev: TimelineEvent[] = [];
  for (const m of messages)
    ev.push({
      id: `msg:${m.id}`,
      type: "submit",
      at: m.created_at,
      title: m.form_name ?? m.form_type ?? "contact form",
      detail: (m.subject ? `${m.subject} - ` : "") + m.message.slice(0, 280),
      meta: { lang: m.lang, page_url: m.page_url ?? null },
    });
  for (const s of subs) {
    ev.push({
      id: `sub:${s.id}`,
      type: "newsletter",
      at: s.created_at,
      title: `Newsletter: ${s.status}`,
      detail: s.source_form_name ?? null,
      meta: { status: s.status },
    });
    if (s.confirmed_at)
      ev.push({
        id: `sub-doi:${s.id}`,
        type: "newsletter",
        at: s.confirmed_at,
        title: "Newsletter: confirmed (DOI)",
        detail: s.source_form_name ?? null,
        meta: { status: "confirmed" },
      });
  }
  for (const c of consents)
    ev.push({
      id: `cns:${c.id}`,
      type: "consent",
      at: c.created_at,
      title: `${c.consent_key}: ${c.given ? "granted" : "revoked"}`,
      detail: consentExcerpt(c.consent_text),
      meta: { form: c.form_name, version: c.consent_version, given: c.given },
    });
  for (const n of notes)
    ev.push({
      id: `nt:${n.id}`,
      type: "note",
      at: n.created_at,
      title: "Note",
      detail: n.body,
      meta: { author_id: n.author_id },
    });
  for (const a of audits) {
    const t: TimelineEvent["type"] = a.action.includes("webhook") ? "webhook" : "stage_change";
    ev.push({
      id: `au:${a.id}`,
      type: t,
      at: a.created_at,
      title: a.action,
      detail: null,
      meta: a.metadata ?? null,
    });
  }
  ev.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { lead: lead as Record<string, unknown>, events: ev };
}

export const getCrmLeadTimeline = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const r = await buildLeadTimeline(context, data.id);
    return { json: j(r) };
  });

export const exportCrmLeadTimelineCsv = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { lead, events } = await buildLeadTimeline(context, data.id);
    // Ta sama wspólna serializacja, co w eksporcie listy leadów wyżej.
    const cols = ["at", "type", "title", "detail", "meta"];
    return {
      csv: csvDocument(
        cols,
        events.map((e) => [e.at, e.type, e.title, e.detail ?? "", e.meta ?? ""]),
      ),
      email: (lead as { email: string }).email,
      count: events.length,
    };
  });

// ============ Lead scoring ============
//
// Liczenie żyje w bazie (compute_crm_lead_score, migracja 20260718130000);
// poniżej tylko cienkie mostki: odczyt/zapis ustawień per tenant i wywołanie
// przeliczeń przez SECURITY DEFINER RPC (guardy ról w funkcjach SQL).

const ScoringWeightInput = z.object({
  points: z.number().int().min(0).max(1000).optional(),
  cap: z.number().int().min(0).max(1000).optional(),
});

const ScoringSettingsInput = z
  .object({
    enabled: z.boolean(),
    half_life_days: z.number().int().min(1).max(365),
    horizon_days: z.number().int().min(7).max(1095),
    hot_threshold: z.number().int().min(1).max(10000),
    warm_threshold: z.number().int().min(1).max(10000),
    cool_threshold: z.number().int().min(1).max(10000),
    weights: z.record(z.string().max(60), ScoringWeightInput).default({}),
  })
  .refine((s) => s.hot_threshold > s.warm_threshold && s.warm_threshold > s.cool_threshold, {
    message: "thresholds_must_descend",
  });

type RpcFn = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const rpcOf = (context: unknown): RpcFn =>
  (context as { supabase: { rpc: RpcFn } }).supabase.rpc.bind(
    (context as { supabase: { rpc: RpcFn } }).supabase,
  );

// Scoring to konfiguracja/akcje sztabowe - wymuszamy requireCrmStaff (rola +
// step-up MFA) obok backstopu w RPC/RLS (dwie niezależne warstwy, doktryna repo).
export const getCrmScoringSettings = createServerFn({ method: "GET" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }) => {
    // RLS: staff czyta wiersz swojego tenanta; brak wiersza = domyślne.
    const { data: row, error } = await looseTable(context, "crm_scoring_settings")
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { json: j(row ?? null) };
  });

export const upsertCrmScoringSettings = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => ScoringSettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    const userId = (context as { userId: string }).userId;
    const rpc = rpcOf(context);
    const { data: isAdmin } = await rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuper } = await rpc("is_super_admin");
    if (!isAdmin && !isSuper) throw new Error("Forbidden");
    const { data: tenantRow } = await looseTable(context, "profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = (tenantRow as { tenant_id: string } | null)?.tenant_id;
    if (!tenantId) throw new Error("no_tenant");

    // Normalizacja nadpisań wag do PEŁNYCH obiektów {points, cap}: SQL scala
    // wagi płytkim `jsonb ||`, więc częściowy override (np. samo `points`)
    // wyzerowałby `cap` do NULL → sygnał bez sufitu. Domykamy inwariant na
    // zapisie, niezależnie od klienta.
    const weights: Record<string, { points: number; cap: number }> = {};
    for (const [key, w] of Object.entries(data.weights)) {
      const base = DEFAULT_SCORING_WEIGHTS[key as keyof typeof DEFAULT_SCORING_WEIGHTS];
      weights[key] = {
        points: w?.points ?? base?.points ?? 0,
        cap: w?.cap ?? base?.cap ?? 0,
      };
    }
    const payload = { ...data, weights };

    const { data: existing } = await looseTable(context, "crm_scoring_settings")
      .select("tenant_id")
      .maybeSingle();
    const res = existing
      ? await looseTable(context, "crm_scoring_settings").update(payload).eq("tenant_id", tenantId)
      : await looseTable(context, "crm_scoring_settings").insert({
          ...payload,
          tenant_id: tenantId,
        });
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });

export const recomputeLeadScore = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const rpc = rpcOf(context);
    const { data: result, error } = await rpc("recompute_crm_lead_score", {
      p_lead_id: data.id,
    });
    if (error) throw new Error(error.message);
    return { json: j(result) };
  });

const RecomputeAllInput = z.object({
  // Rozmiar porcji; klient pętli po kursorze `after_id` aż done=true.
  limit: z.number().int().min(1).max(1000).default(500),
  after_id: z.string().uuid().nullable().optional(),
});

export const recomputeAllLeadScores = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => RecomputeAllInput.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ processed: number; lastId: string | null; done: boolean }> => {
      const rpc = rpcOf(context);
      const { data: result, error } = await rpc("recompute_crm_lead_scores", {
        p_limit: data.limit,
        p_after_id: data.after_id ?? null,
      });
      if (error) throw new Error(error.message);
      const r = (result ?? {}) as { processed?: number; last_id?: string | null; done?: boolean };
      return {
        processed: Number(r.processed ?? 0),
        lastId: r.last_id ?? null,
        done: r.done ?? true,
      };
    },
  );

// ============ Bulk operations & staff picker ============

const BulkUpdateInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  stage: STAGE_ENUM.optional(),
  owner_id: z.string().uuid().nullable().optional(),
  add_tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  remove_tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  marketing_consent: z.boolean().optional(),
});

// Zbiorcza edycja leadów. RLS + tenant scoping robi Postgres (policies na
// crm_leads); tutaj tylko przygotowujemy patch pól poza tagami i - jeśli są -
// operujemy na tagach per rekord (add_tags/remove_tags). Wartości poza
// tagami idą jednym UPDATE ... IN (...) dla wydajności.
export const bulkUpdateCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => BulkUpdateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { ids, add_tags: addTags, remove_tags: removeTags, owner_id: ownerId, ...rest } = data;

    const flatPatch: Record<string, unknown> = { ...rest };
    if (typeof ownerId !== "undefined") flatPatch.owner_id = ownerId;
    let touched = 0;

    if (Object.keys(flatPatch).length > 0) {
      const res = await looseTable(context, "crm_leads").update(flatPatch).in("id", ids);
      if (res.error) throw new Error(res.error.message);
      touched = ids.length;
    }

    if ((addTags?.length ?? 0) > 0 || (removeTags?.length ?? 0) > 0) {
      // Tagi to text[] - potrzebujemy per-rekord read-modify-write (Postgrest
      // nie udostępnia array_append/remove w PATCH bulk). Robimy w porcjach.
      const { data: rows } = await looseTable(context, "crm_leads")
        .select("id, tags")
        .in("id", ids)
        .returns<{ id: string; tags: string[] | null }>();
      for (const row of rows ?? []) {
        const current = new Set((row.tags ?? []).map((t) => t.trim()).filter(Boolean));
        for (const t of addTags ?? []) current.add(t);
        for (const t of removeTags ?? []) current.delete(t);
        const next = Array.from(current);
        const res = await looseTable(context, "crm_leads")
          .update({ tags: next.length > 0 ? next : null })
          .eq("id", row.id);
        if (res.error) throw new Error(res.error.message);
      }
      touched = Math.max(touched, (rows ?? []).length);
    }

    try {
      await looseTable(context, "audit_log").insert({
        actor_id: (context as { userId: string }).userId,
        action: "crm.lead.bulk_update",
        entity_type: "crm_lead",
        entity_id: null,
        metadata: {
          count: touched,
          fields: Object.keys(flatPatch),
          add_tags: addTags ?? [],
          remove_tags: removeTags ?? [],
        },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true, updated: touched };
  });

const BulkDeleteInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export const bulkDeleteCrmLeads = createServerFn({ method: "POST" })
  .middleware([requireCrmStaff])
  .validator((d) => BulkDeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    // Delete zarezerwowane dla adminów - staff bez roli admin/super_admin
    // dostaje odmowę. RLS może i tak zablokować, ale sprawdzamy jawnie.
    const client = looseClient(context);
    const userId = (context as { userId: string }).userId;
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      client.rpc("has_role", { _user_id: userId, _role: "admin" }),
      client.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    if (!isAdmin && !isSuper) throw new Error("forbidden");

    const res = await looseTable(context, "crm_leads").delete().in("id", data.ids);
    if (res.error) throw new Error(res.error.message);
    try {
      await looseTable(context, "audit_log").insert({
        actor_id: userId,
        action: "crm.lead.bulk_delete",
        entity_type: "crm_lead",
        entity_id: null,
        metadata: { count: data.ids.length, ids: data.ids },
      });
    } catch {
      /* audyt best-effort */
    }
    return { ok: true, deleted: data.ids.length };
  });

// Lista staffu do pickera "właściciela" - profile użytkowników z rolami
// admin/super_admin/editor/moderator w bieżącym tenancie. Używamy admina
// (RLS user_roles jest owner-only). Zwracamy minimalny zestaw pól.
export const listStaffUsers = createServerFn({ method: "GET" })
  .middleware([requireCrmStaff])
  .handler(async ({ context }) => {
    const claims = (context as { claims: { tenant_id?: string } }).claims;
    const tenantId = claims?.tenant_id ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = looseClient({ supabase: supabaseAdmin });
    const staffRoles = ["admin", "super_admin", "editor", "moderator"];
    const rolesRes = await admin
      .from("user_roles")
      .select("user_id, role")
      .in("role", staffRoles)
      .returns<{ user_id: string; role: string }>();
    const userIds = Array.from(new Set((rolesRes.data ?? []).map((r) => r.user_id)));
    if (userIds.length === 0) return { json: j([]) };
    const cols = "id, first_name, last_name, display_name, avatar_url, tenant_id";
    const profRes = tenantId
      ? await admin.from("profiles").select(cols).eq("tenant_id", tenantId).in("id", userIds)
      : await admin.from("profiles").select(cols).in("id", userIds);
    const rows = (profRes.data as Array<Record<string, unknown>>) ?? [];
    return { json: j(rows) };
  });
