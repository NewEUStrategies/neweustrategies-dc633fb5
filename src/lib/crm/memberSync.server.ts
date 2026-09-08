// Synchronizacja członków z CRM - osoby (crm_leads) i firmy (crm_companies).
//
// PRZYCZYNA ŹRÓDŁOWA. Członkostwo i CRM opisują tę samą osobę w dwóch
// tabelach. Dopóki ręczne nadanie planu nie dotykało CRM, lejek pokazywał
// „nowy kontakt" dla kogoś, kto od miesiąca ma plan Pro - a firma tej osoby
// nie istniała w katalogu firm, więc raporty per organizacja były niepełne.
//
// ZASADA. Profil jest źródłem prawdy o osobie (imię, nazwisko, stanowisko,
// firma), CRM jest jego odbiciem. Synchronizacja jest idempotentna: dedup
// osoby po `email_norm`, dedup firmy po znormalizowanej nazwie w tenancie.
//
// ODPORNOŚĆ. Funkcje nigdy nie rzucają - nieudany zapis do CRM nie może cofnąć
// nadania planu, które już zapisało się w `membership_grants`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

export interface MemberCrmSnapshot {
  leadId: string | null;
  stage: string | null;
  companyId: string | null;
  companyName: string | null;
}

/** Nazwa firmy sprowadzona do postaci porównywalnej (dedup w obrębie tenanta). */
export function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, "")
    .replace(/\b(sp\.? ?z ?o\.? ?o\.?|s\.?a\.?|ltd|llc|inc|gmbh)\b/g, "")
    .trim();
}

/** Zwraca id firmy w CRM, tworząc ją przy pierwszym wystąpieniu. */
export async function ensureCrmCompany(
  supabaseAdmin: Admin,
  tenantId: string,
  rawName: string | null,
  createdBy: string | null,
): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;
  const normalized = normalizeCompanyName(name);
  if (!normalized) return null;

  const { data: candidates } = await supabaseAdmin
    .from("crm_companies")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .ilike("name", `%${normalized.slice(0, 40).replace(/[%_]/g, " ")}%`)
    .limit(20);

  const hit = (candidates ?? []).find((row) => normalizeCompanyName(row.name) === normalized);
  if (hit) return hit.id;

  const { data: created, error } = await supabaseAdmin
    .from("crm_companies")
    .insert({ tenant_id: tenantId, name, created_by: createdBy })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

interface SyncInput {
  userId: string;
  tenantId: string;
  /** Warstwa po zmianie; `null` = nadanie cofnięte. */
  tierKey: string | null;
  actorId: string | null;
  /** Skąd wynika zmiana - trafia do tagów kontaktu. */
  reason: "manual_grant" | "manual_revoke" | "backfill";
}

/**
 * Odbija stan członkostwa w CRM: kontakt (osoba) + firma, tagi planu i etap.
 * Nigdy nie rzuca.
 */
export async function syncMemberToCrm(
  supabaseAdmin: Admin,
  input: SyncInput,
): Promise<MemberCrmSnapshot | null> {
  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select(
        "email, first_name, last_name, display_name, job_title, current_company, linkedin_url, phone, tenant_id",
      )
      .eq("id", input.userId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();

    const email = profile?.email?.trim().toLowerCase();
    if (!email) return null;

    const companyId = await ensureCrmCompany(
      supabaseAdmin,
      input.tenantId,
      profile?.current_company ?? null,
      input.actorId,
    );

    const planTag = input.tierKey ? `plan:${input.tierKey}` : null;
    const now = new Date().toISOString();

    const { data: lead } = await supabaseAdmin
      .from("crm_leads")
      .select("id, tags, stage, company_id")
      .eq("tenant_id", input.tenantId)
      .eq("email_norm", email)
      .maybeSingle();

    // Tagi planu są rozłączne: przy zmianie warstwy stary `plan:*` znika, żeby
    // segmentacja nie pokazywała jednej osoby w dwóch planach naraz.
    // Uzupełnianie danych (backfill) nie zmienia etapu ani tagów planu - to
    // odświeżenie profilu osoby i firmy, a nie zdarzenie sprzedażowe.
    const keptTags =
      input.reason === "backfill"
        ? (lead?.tags ?? [])
        : (lead?.tags ?? []).filter(
            (tag) => !tag.startsWith("plan:") && tag !== "membership:manual",
          );
    const tags = Array.from(
      new Set([...keptTags, ...(planTag ? [planTag, "membership:manual"] : [])]),
    );

    const shared = {
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      position: profile?.job_title ?? null,
      company: profile?.current_company ?? null,
      company_id: companyId ?? lead?.company_id ?? null,
      linkedin_url: profile?.linkedin_url ?? null,
      phone: profile?.phone ?? null,
      tags,
      last_activity_at: now,
    };

    if (lead) {
      const stage =
        input.reason === "manual_grant"
          ? "won"
          : input.reason === "manual_revoke" && lead.stage === "won"
            ? "qualified"
            : lead.stage;
      await supabaseAdmin
        .from("crm_leads")
        .update({ ...shared, stage })
        .eq("id", lead.id);
      return {
        leadId: lead.id,
        stage,
        companyId: shared.company_id,
        companyName: profile?.current_company ?? null,
      };
    }

    const { data: created } = await supabaseAdmin
      .from("crm_leads")
      .insert({
        ...shared,
        tenant_id: input.tenantId,
        email,
        email_norm: email,
        stage: input.reason === "manual_grant" ? "won" : "new",
        // Zbiór dozwolonych wartości pilnuje CHECK w bazie.
        source_type: "other",
      })
      .select("id, stage")
      .maybeSingle();

    return {
      leadId: created?.id ?? null,
      stage: created?.stage ?? null,
      companyId: shared.company_id,
      companyName: profile?.current_company ?? null,
    };
  } catch (err) {
    console.error("[members] crm sync failed", err);
    return null;
  }
}
