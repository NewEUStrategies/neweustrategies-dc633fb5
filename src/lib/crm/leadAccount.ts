// Konto członka powiązane z leadem CRM - jedno źródło prawdy dla kart leada,
// które czytają dane członka rolą serwisową (metering, członkostwo, profil).
//
// DLACZEGO NIE PO E-MAILU. `crm_leads.email` edytuje staff (polityka
// "Staff update leads"). Dopasowanie lead -> profil po e-mailu pozwalało
// wpisać w leadzie adres dowolnego członka i odczytać rolą serwisową jego
// profil, CV, subskrypcje i licznik artykułów. Powiązanie bierzemy więc
// WYŁĄCZNIE z `crm_leads.user_id`: zapisują je funkcje bazy z prawami
// właściciela (profil, synchronizacja członka, backfill), a zmianę z roli
// sesji blokuje wyzwalacz `tg_crm_leads_user_id_guard`. Dodatkowo profil
// musi należeć do najemcy leada - konto z innego najemcy nigdy nie wychodzi.

/** Wiersz leada widoczny pod RLS sesji (najemca z sesji, rola admin/editor). */
export interface LeadAccountRow {
  readonly user_id: string | null;
  readonly tenant_id: string;
}

/** Zweryfikowane powiązanie: konto członka w najemcy leada. */
export interface LeadAccountLink {
  readonly userId: string;
  readonly tenantId: string;
}

export interface LeadAccountReaders {
  /** Odczyt leada klientem SESJI (RLS) - nie rolą serwisową. */
  readonly readLead: (leadId: string) => Promise<LeadAccountRow | null>;
  /** Czy profil `userId` należy do najemcy `tenantId`. */
  readonly profileInTenant: (userId: string, tenantId: string) => Promise<boolean>;
}

export async function resolveLeadAccount(
  readers: LeadAccountReaders,
  leadId: string,
): Promise<LeadAccountLink | null> {
  const lead = await readers.readLead(leadId);
  if (!lead?.user_id || !lead.tenant_id) return null;
  const inTenant = await readers.profileInTenant(lead.user_id, lead.tenant_id);
  return inTenant ? { userId: lead.user_id, tenantId: lead.tenant_id } : null;
}
