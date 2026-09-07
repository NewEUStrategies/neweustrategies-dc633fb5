// Dwukierunkowa wymiana danych do faktury między panelem członka a kartoteką
// firm w CRM.
//
// PRZYCZYNA. Dane nabywcy żyły w dwóch miejscach: `billing_profiles` (co
// użytkownik wpisał w checkoucie) i `crm_companies` (co zespół utrzymuje w
// CRM). Rozjazd kończył się fakturą z nieaktualnym adresem albo kartoteką bez
// NIP-u.
//
// ZASADA. Żadna strona nie nadpisuje drugiej po cichu - użytkownik (albo
// administrator) świadomie decyduje o kierunku: „pobierz z CRM" albo „zapisz w
// CRM". Obie operacje są idempotentne i zamknięte w tenancie właściciela.
//
// Moduł jest server-only (klient service_role).
import { ensureCrmCompany, normalizeCompanyName } from "@/lib/crm/memberSync.server";

export interface CrmCompanyBillingData {
  companyId: string;
  name: string;
  taxId: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null
  email: string | null;
  phone: string | null;
}

export type InvoiceCrmError = "no_tenant" | "no_company" | "no_billing_data";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

interface Owner {
  tenantId: string;
  companyId: string | null;
  companyName: string | null;
}

async function loadOwner(userId: string): Promise<Owner | null> {
  const supabase = await admin();
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id, current_company_id, current_company")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.tenant_id) return null;
  return {
    tenantId: data.tenant_id,
    companyId: data.current_company_id ?? null,
    companyName: clean(data.current_company),
  };
}

/**
 * Kartoteka firmy powiązanej z użytkownikiem. Gdy profil nie ma relacji,
 * próbujemy dopasować po nazwie firmy wpisanej w profilu albo w danych do
 * faktury - to ten sam dedup, którego używa synchronizacja członków.
 */
export async function loadCrmCompanyForUser(
  userId: string,
): Promise<{ ok: true; company: CrmCompanyBillingData } | { ok: false; error: InvoiceCrmError }> {
  const owner = await loadOwner(userId);
  if (!owner) return { ok: false, error: "no_tenant" };
  const supabase = await admin();

  const columns = "id, name, tax_id, address, city, postal_code, country, email, phone";
  let row: Record<string, unknown> | null = null;

  if (owner.companyId) {
    const { data } = await supabase
      .from("crm_companies")
      .select(columns)
      .eq("id", owner.companyId)
      .eq("tenant_id", owner.tenantId)
      .maybeSingle();
    row = data ?? null;
  }

  if (!row) {
    const { data: billing } = await supabase
      .from("billing_profiles")
      .select("company")
      .eq("user_id", userId)
      .eq("tenant_id", owner.tenantId)
      .maybeSingle();
    const name = owner.companyName ?? clean(billing?.company);
    if (!name) return { ok: false, error: "no_company" };
    const normalized = normalizeCompanyName(name);
    const { data: candidates } = await supabase
      .from("crm_companies")
      .select(columns)
      .eq("tenant_id", owner.tenantId)
      .limit(200);
    row =
      (candidates ?? []).find(
        (candidate) => normalizeCompanyName(String(candidate.name)) === normalized,
      ) ?? null;
  }

  if (!row) return { ok: false, error: "no_company" };
  return {
    ok: true,
    company: {
      companyId: String(row.id),
      name: String(row.name ?? ""),
      taxId: clean(row.tax_id as string | null),
      addressLine1: clean(row.address as string | null),
      city: clean(row.city as string | null),
      postalCode: clean(row.postal_code as string | null),
      country: clean(row.country as string | null),
      email: clean(row.email as string | null),
      phone: clean(row.phone as string | null),
    },
  };
}

/**
 * CRM -> dane do faktury. Nadpisujemy wyłącznie pola, które CRM faktycznie ma
 * wypełnione: pusta rubryka w kartotece nie może skasować adresu, który
 * użytkownik podał w checkoucie.
 */
export async function importCrmCompanyToBillingProfile(
  userId: string,
): Promise<{ ok: true; company: CrmCompanyBillingData } | { ok: false; error: InvoiceCrmError }> {
  const loaded = await loadCrmCompanyForUser(userId);
  if (!loaded.ok) return loaded;
  const owner = await loadOwner(userId);
  if (!owner) return { ok: false, error: "no_tenant" };
  const supabase = await admin();
  const company = loaded.company;

  const { data: existing } = await supabase
    .from("billing_profiles")
    .select("*")
    .eq("user_id", userId)
    .eq("tenant_id", owner.tenantId)
    .maybeSingle();

  const patch = {
    user_id: userId,
    tenant_id: owner.tenantId,
    is_company: true,
    company: company.name,
    full_name: existing?.full_name ?? null,
    tax_id: company.taxId ?? existing?.tax_id ?? null,
    address_line1: company.addressLine1 ?? existing?.address_line1 ?? null,
    address_line2: existing?.address_line2 ?? null,
    city: company.city ?? existing?.city ?? null,
    postal_code: company.postalCode ?? existing?.postal_code ?? null,
    country_code: company.country ?? existing?.country_code ?? "PL",
    email: company.email ?? existing?.email ?? null,
    phone: company.phone ?? existing?.phone ?? null,
    region: existing?.region ?? null,
  };

  const { error } = await supabase
    .from("billing_profiles")
    .upsert(patch, { onConflict: "user_id,tenant_id" });
  if (error) return { ok: false, error: "no_billing_data" };

  // Relacja profil -> kartoteka, żeby kolejny odczyt nie szukał po nazwie.
  await supabase
    .from("profiles")
    .update({ current_company_id: company.companyId, current_company: company.name })
    .eq("id", userId)
    .eq("tenant_id", owner.tenantId);

  return { ok: true, company };
}

/**
 * Dane do faktury -> CRM. Firmy brakującej w kartotece nie zgubimy: zakłada ją
 * ten sam dedup, którego używa synchronizacja członków.
 */
export async function pushBillingProfileToCrm(
  userId: string,
): Promise<{ ok: true; company: CrmCompanyBillingData } | { ok: false; error: InvoiceCrmError }> {
  const owner = await loadOwner(userId);
  if (!owner) return { ok: false, error: "no_tenant" };
  const supabase = await admin();

  const { data: billing } = await supabase
    .from("billing_profiles")
    .select("company, tax_id, address_line1, city, postal_code, country_code, email, phone")
    .eq("user_id", userId)
    .eq("tenant_id", owner.tenantId)
    .maybeSingle();
  const name = clean(billing?.company) ?? owner.companyName;
  if (!billing || !name) return { ok: false, error: "no_billing_data" };

  const companyId =
    owner.companyId ?? (await ensureCrmCompany(supabase, owner.tenantId, name, userId));
  if (!companyId) return { ok: false, error: "no_company" };

  const patch: Record<string, string | null> = {
    name,
    tax_id: clean(billing.tax_id),
    address: clean(billing.address_line1),
    city: clean(billing.city),
    postal_code: clean(billing.postal_code),
    country: clean(billing.country_code),
    email: clean(billing.email),
    phone: clean(billing.phone),
  };
  // Pustych pól nie wysyłamy: użytkownik, który zostawił rubrykę pustą, nie
  // chciał skasować danych utrzymywanych przez zespół w CRM.
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete patch[key];
  }

  const { error } = await supabase
    .from("crm_companies")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", companyId)
    .eq("tenant_id", owner.tenantId);
  if (error) return { ok: false, error: "no_company" };

  await supabase
    .from("profiles")
    .update({ current_company_id: companyId, current_company: name })
    .eq("id", userId)
    .eq("tenant_id", owner.tenantId);

  const reloaded = await loadCrmCompanyForUser(userId);
  return reloaded;
}
