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
  country: string | null;
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

/**
 * Strona skanu kandydatów. Poniżej domyślnego `max-rows` PostgREST (1000):
 * krótsza strona znaczy wtedy „koniec wyników", a nie „serwer przyciął".
 */
const CANDIDATE_PAGE = 500;

/**
 * Wzorzec ILIKE przepuszczający KAŻDĄ nazwę o danym kluczu dedupu.
 * `normalizeCompanyName` tylko usuwa znaki (kropki, przecinki, formę prawną,
 * nadmiar spacji) i zmienia wielkość liter, więc litery i cyfry ASCII klucza
 * występują w oryginalnej nazwie w tej samej kolejności - choć niekoniecznie
 * obok siebie („A.C.M.E." -> „acme"). Dlatego wzorzec to podciąg `%a%c%m%e%`,
 * a ostateczne porównanie kluczy robi JS. Inne znaki pomijamy: nie trzeba ich
 * escapować, a ich wielkość liter w bazie zależy od collation.
 */
function companyNamePrefilter(normalized: string): string {
  const letters = normalized.replace(/[^a-z0-9]/g, "");
  return `%${letters.split("").join("%")}%`;
}

/**
 * Kraj w CRM to wolny tekst („Polska", „Niemcy"), a `billing_profiles.country_code`
 * to kod ISO-2: od niego zależy suma kontrolna NIP-u, walidacja nabywcy
 * i kraj na fakturze. Przyjmujemy więc wyłącznie dwuliterowy kod.
 */
function isoCountryCode(value: string | null): string | null {
  return value && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

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
    // Sama forma prawna („Sp. z o.o.") to nie firma - `ensureCrmCompany` też
    // jej nie zakłada, więc nie dopasowujemy jej do innej „firmy-widma".
    if (!normalized) return { ok: false, error: "no_company" };
    // Wcześniej brane było DOWOLNE 200 firm tenanta (bez filtra nazwy, bez
    // ORDER BY): w większym tenancie istniejąca firma dawała „brak firmy",
    // a przy duplikatach wynik zależał od kolejności, w jakiej baza oddała
    // wiersze. Teraz baza odsiewa kandydatów wzorcem, a strony idą po
    // (created_at, id) - tą samą kolejnością, którą `crm_ensure_member_company`
    // wybiera firmę, więc odczyt i „Zapisz w CRM" wskazują tę samą kartotekę.
    const pattern = companyNamePrefilter(normalized);
    for (let from = 0; ; from += CANDIDATE_PAGE) {
      const { data: candidates } = await supabase
        .from("crm_companies")
        .select(columns)
        .eq("tenant_id", owner.tenantId)
        .ilike("name", pattern)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + CANDIDATE_PAGE - 1);
      const page = candidates ?? [];
      row =
        page.find((candidate) => normalizeCompanyName(String(candidate.name)) === normalized) ??
        null;
      if (row || page.length < CANDIDATE_PAGE) break;
    }
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
    country_code: isoCountryCode(company.country) ?? existing?.country_code ?? "PL",
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

  // Firmę w profilu członek wybiera z katalogu, więc jedną kartotekę dzieli
  // wiele osób. Powiązanej używamy tylko wtedy, gdy to TA SAMA firma co
  // w danych do faktury - inaczej członek fakturujący np. na własną
  // działalność przemianowałby firmę zespołu i podmienił jej NIP i adres.
  let companyId: string | null = null;
  if (owner.companyId) {
    const { data: linked } = await supabase
      .from("crm_companies")
      .select("id, name")
      .eq("id", owner.companyId)
      .eq("tenant_id", owner.tenantId)
      .maybeSingle();
    if (linked && normalizeCompanyName(linked.name) === normalizeCompanyName(name)) {
      companyId = linked.id;
    }
  }
  companyId ??= await ensureCrmCompany(supabase, owner.tenantId, name, userId);
  if (!companyId) return { ok: false, error: "no_company" };

  // Bez `name`: kartoteka ma ten sam klucz nazwy (dopasowana albo założona
  // pod tą nazwą), a jej zapis utrzymuje zespół. Zmiana samej pisowni
  // („ACME Sp. z o.o." -> „acme") psułaby katalog i mogła trafić na unikat
  // (tenant_id, name_norm) innej kartoteki.
  const patch: Record<string, string | null> = {
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

  const { data: updated, error } = await supabase
    .from("crm_companies")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", companyId)
    .eq("tenant_id", owner.tenantId)
    .select("name")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: "no_company" };

  // Profil niesie nazwę z kartoteki - tak samo jak przy wyborze firmy
  // z katalogu (`link_current_company`) i przy „Pobierz z CRM".
  await supabase
    .from("profiles")
    .update({ current_company_id: companyId, current_company: updated.name })
    .eq("id", userId)
    .eq("tenant_id", owner.tenantId);

  const reloaded = await loadCrmCompanyForUser(userId);
  return reloaded;
}
