// Synchronizacja kartoteki firmy CRM z członkami platformy.
//
// PRZYCZYNA ŹRÓDŁOWA. Firma żyje w `crm_companies`, a przynależność członka w
// `profiles.current_company_id` + tekstowym `profiles.current_company` oraz w
// `crm_leads.company_id` / `crm_leads.company`. Zmiana nazwy firmy w CRM nie
// docierała do tych kopii, więc katalog członków pokazywał starą nazwę, a po
// usunięciu firmy zostawały osierocone wskazania.
//
// ZASADA. Kartoteka firmy jest źródłem prawdy o nazwie. Po każdej mutacji
// (utworzenie, edycja, usunięcie) odbijamy stan na członkach - idempotentnie i
// w granicach tenanta. Funkcje nigdy nie rzucają: nieudana synchronizacja nie
// może cofnąć zapisu, który już wylądował w CRM.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeCompanyName } from "./memberSync.server";

type Admin = SupabaseClient<Database>;

export interface CompanySyncResult {
  /** Profile członków, których dane firmowe odświeżono. */
  profiles: number;
  /** Kontakty CRM, których dane firmowe odświeżono. */
  leads: number;
  /** Profile dopięte do kartoteki po zgodnej nazwie. */
  linked: number;
}

const EMPTY: CompanySyncResult = { profiles: 0, leads: 0, linked: 0 };

/**
 * Odświeża nazwę firmy u wszystkich powiązanych członków i kontaktów oraz
 * dopina profile, które mają tę samą nazwę wpisaną ręcznie (bez relacji).
 */
export async function syncCompanyToMembers(
  supabaseAdmin: Admin,
  input: { tenantId: string; companyId: string; name: string },
): Promise<CompanySyncResult> {
  const name = input.name.trim();
  if (!name) return EMPTY;
  const normalized = normalizeCompanyName(name);
  const result: CompanySyncResult = { profiles: 0, leads: 0, linked: 0 };

  try {
    const { data: linkedProfiles } = await supabaseAdmin
      .from("profiles")
      .update({ current_company: name })
      .eq("tenant_id", input.tenantId)
      .eq("current_company_id", input.companyId)
      .select("id");
    result.profiles = linkedProfiles?.length ?? 0;

    const { data: linkedLeads } = await supabaseAdmin
      .from("crm_leads")
      .update({ company: name })
      .eq("tenant_id", input.tenantId)
      .eq("company_id", input.companyId)
      .select("id");
    result.leads = linkedLeads?.length ?? 0;

    // Dopięcie po nazwie: profile z ręcznie wpisaną firmą, ale bez relacji.
    if (normalized) {
      const { data: candidates } = await supabaseAdmin
        .from("profiles")
        .select("id, current_company")
        .eq("tenant_id", input.tenantId)
        .is("current_company_id", null)
        .not("current_company", "is", null)
        .limit(500);
      const toLink = (candidates ?? [])
        .filter((row) => normalizeCompanyName(row.current_company ?? "") === normalized)
        .map((row) => row.id);
      if (toLink.length > 0) {
        const { data: updated } = await supabaseAdmin
          .from("profiles")
          .update({ current_company_id: input.companyId, current_company: name })
          .in("id", toLink)
          .select("id");
        result.linked = updated?.length ?? 0;
      }
    }
  } catch {
    /* noop - synchronizacja jest best-effort */
  }

  return result;
}

/**
 * Odpina członków i kontakty od kartoteki przed jej usunięciem. Nazwa firmy
 * zostaje na profilu jako tekst, żeby nie kasować danych wpisanych przez
 * użytkownika - znika tylko relacja do usuwanego rekordu.
 */
export async function detachCompanyFromMembers(
  supabaseAdmin: Admin,
  input: { tenantId: string; companyIds: readonly string[] },
): Promise<{ profiles: number; leads: number }> {
  const ids = [...new Set(input.companyIds)].filter(Boolean);
  if (ids.length === 0) return { profiles: 0, leads: 0 };
  let profiles = 0;
  let leads = 0;
  try {
    const { data: p } = await supabaseAdmin
      .from("profiles")
      .update({ current_company_id: null })
      .eq("tenant_id", input.tenantId)
      .in("current_company_id", ids)
      .select("id");
    profiles = p?.length ?? 0;

    const { data: l } = await supabaseAdmin
      .from("crm_leads")
      .update({ company_id: null })
      .eq("tenant_id", input.tenantId)
      .in("company_id", ids)
      .select("id");
    leads = l?.length ?? 0;
  } catch {
    /* noop */
  }
  return { profiles, leads };
}
