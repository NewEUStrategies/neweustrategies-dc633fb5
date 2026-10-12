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
// GRANICA ZAUFANIA (audyt INV-10). Moduł biegnie kluczem serwisowym, a nazwę
// firmy i NIP członek wpisuje sam. Wcześniej oba kierunki dopasowywały
// kartotekę PO NAZWIE: „Pobierz z CRM" oddawał NIP, e-mail i telefon cudzej
// firmy o tej samej nazwie, a „Zapisz w CRM" nadpisywał jej NIP, adres
// i kontakt. Podmieniony NIP zasilał potem `_event_invoice_crm_link`, który
// przypina faktury wydarzeń do kartoteki właśnie po NIP-ie. Teraz:
//   * odczyt zwraca WYŁĄCZNIE kartotekę powiązaną z profilem
//     (`current_company_id`) albo tę o NIP-ie podanym przez członka w danych
//     do faktury - nigdy firmę znalezioną po samej nazwie;
//   * zapis tylko UZUPEŁNIA puste rubryki, tak jak SQL przy wystawieniu
//     faktury (`COALESCE(NULLIF(btrim(c.x), ''), nowa)`);
//   * firma o tej nazwie, ale z INNYM niepustym NIP-em to inny podmiot - nie
//     dotykamy jej, tylko zakładamy osobną kartotekę z NIP-em członka.
//
// Moduł jest server-only (klient service_role).
import { normalizeTaxId } from "@/lib/billing/nip";
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

/**
 * `tax_id_conflict` - w kartotece jest już firma o tej nazwie z INNYM NIP-em,
 * a unikat nazwy w tenancie nie pozwala założyć obok niej osobnej. Cudzej
 * kartoteki nie zmieniamy; o rozdzieleniu decyduje zespół.
 */
export type InvoiceCrmError = "no_tenant" | "no_company" | "no_billing_data" | "tax_id_conflict";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Kolumny kartoteki czytane przez oba kierunki wymiany. */
const COMPANY_COLUMNS = "id, name, tax_id, address, city, postal_code, country, email, phone";

interface CompanyRow {
  id: string;
  name: string;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Rubryki, które „Zapisz w CRM" może UZUPEŁNIĆ. Bez `name`: kartoteka ma ten
 * sam klucz nazwy (dopasowana albo założona pod tą nazwą), a jej zapis
 * utrzymuje zespół. Zmiana samej pisowni („ACME Sp. z o.o." -> „acme")
 * psułaby katalog i mogła trafić na unikat (tenant_id, name_norm) innej
 * kartoteki.
 */
type FillableColumn = "tax_id" | "address" | "city" | "postal_code" | "country" | "email" | "phone";

/** Kod naruszenia unikatu w PostgreSQL. */
const UNIQUE_VIOLATION = "23505";

/**
 * Strona skanu kandydatów. Poniżej domyślnego `max-rows` PostgREST (1000):
 * krótsza strona znaczy wtedy „koniec wyników", a nie „serwer przyciął".
 */
const CANDIDATE_PAGE = 500;

/**
 * Ile razy ponawiamy uzupełnienie, gdy kartoteka zmieniła się między naszym
 * odczytem a zapisem (patrz `fillEmptyFields`).
 */
const FILL_ATTEMPTS = 3;

/**
 * Klucz porównania NIP-u - lustro `_event_invoice_tax_key` (SQL): bez
 * separatorów, wielkie litery, polski NIP bez prefiksu „PL". Kartoteka trzyma
 * NIP wolnym tekstem („PL 526-025-02-74"), więc porównanie surowych napisów
 * uznałoby tę samą firmę za dwie różne - a różne klucze muszą znaczyć to samo
 * co przy wystawianiu faktur, inaczej panel i SQL przypięłyby nabywcę do
 * różnych kartotek.
 */
function taxIdKey(raw: string | null | undefined): string {
  const normalized = normalizeTaxId(raw ?? "");
  return /^PL\d{10}$/.test(normalized) ? normalized.slice(2) : normalized;
}

/**
 * Niepusty NIP kartoteki wskazuje INNY podmiot niż NIP członka. Pusty NIP
 * po którejkolwiek stronie nie jest konfliktem - jest luką do uzupełnienia.
 */
function conflictingTaxId(company: CompanyRow, memberTaxKey: string): boolean {
  const companyKey = taxIdKey(company.tax_id);
  return memberTaxKey !== "" && companyKey !== "" && companyKey !== memberTaxKey;
}

/**
 * Wzorzec ILIKE przepuszczający KAŻDY zapis NIP-u o danym kluczu.
 * `taxIdKey` tylko usuwa znaki (spacje, kropki, myślniki, prefiks „PL")
 * i zmienia wielkość liter, więc litery i cyfry klucza występują w surowym
 * zapisie w tej samej kolejności - choć niekoniecznie obok siebie
 * („526-025-02-74" -> „5260250274"). Dlatego wzorzec to podciąg `%5%2%6%...%`,
 * a ostateczne porównanie kluczy robi JS. Inne znaki pomijamy: nie trzeba ich
 * escapować. `null`, gdy klucz nie ma ani litery, ani cyfry - taki wzorzec
 * przepuściłby cały tenant.
 */
function taxIdPrefilter(key: string): string | null {
  const characters = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return characters ? `%${characters.split("").join("%")}%` : null;
}

/**
 * Kraj w CRM to wolny tekst („Polska", „Niemcy"), a `billing_profiles.country_code`
 * to kod ISO-2: od niego zależy suma kontrolna NIP-u, walidacja nabywcy
 * i kraj na fakturze. Przyjmujemy więc wyłącznie dwuliterowy kod.
 */
function isoCountryCode(value: string | null): string | null {
  return value && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

function toBillingData(row: CompanyRow): CrmCompanyBillingData {
  return {
    companyId: row.id,
    name: row.name,
    taxId: clean(row.tax_id),
    addressLine1: clean(row.address),
    city: clean(row.city),
    postalCode: clean(row.postal_code),
    country: clean(row.country),
    email: clean(row.email),
    phone: clean(row.phone),
  };
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
 * Kartoteka po id - zawsze w tenancie właściciela. Błąd odczytu przerywa
 * operację: „nie udało się przeczytać" potraktowane jak „nie ma" kazałoby
 * zapisowi szukać dalej i założyć duplikat istniejącej firmy.
 */
async function readCompany(tenantId: string, companyId: string): Promise<CompanyRow | null> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("crm_companies")
    .select(COMPANY_COLUMNS)
    .eq("id", companyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Najstarsza kartoteka tenanta o danym kluczu NIP-u - ta sama, którą wybiera
 * `_event_invoice_crm_link` (`ORDER BY created_at, id LIMIT 1`). Baza odsiewa
 * kandydatów wzorcem, a strony idą po (created_at, id), więc w dużym tenancie
 * firma nie „znika" za pierwszą porcją wierszy.
 */
async function findCompanyByTaxKey(tenantId: string, key: string): Promise<CompanyRow | null> {
  const pattern = taxIdPrefilter(key);
  if (!pattern) return null;
  const supabase = await admin();
  for (let from = 0; ; from += CANDIDATE_PAGE) {
    const { data, error } = await supabase
      .from("crm_companies")
      .select(COMPANY_COLUMNS)
      .eq("tenant_id", tenantId)
      .ilike("tax_id", pattern)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CANDIDATE_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    const hit = page.find((candidate) => taxIdKey(candidate.tax_id) === key);
    if (hit || page.length < CANDIDATE_PAGE) return hit ?? null;
  }
}

/**
 * Kartoteka firmy, z którą użytkownik jest POWIĄZANY: relacja z profilu
 * (`current_company_id` - firma wybrana z katalogu albo przypięta przez
 * import/zapis), a bez niej firma o NIP-ie z jego danych do faktury.
 *
 * DLACZEGO NIE PO NAZWIE (INV-10). Nazwy firm widzi w katalogu każdy członek,
 * a dedup nazw zdejmuje formę prawną - „Globex" i „Globex Sp. z o.o." to dla
 * niego ta sama firma. Odczyt po nazwie wpisanej przez członka oddawał więc
 * NIP, e-mail i telefon cudzej kartoteki, a import kopiował je do jego
 * faktury. NIP identyfikuje podmiot i jest tym samym kluczem, po którym SQL
 * przypina faktury wydarzeń do kartoteki.
 */
export async function loadCrmCompanyForUser(
  userId: string,
): Promise<{ ok: true; company: CrmCompanyBillingData } | { ok: false; error: InvoiceCrmError }> {
  const owner = await loadOwner(userId);
  if (!owner) return { ok: false, error: "no_tenant" };
  const supabase = await admin();

  let row = owner.companyId ? await readCompany(owner.tenantId, owner.companyId) : null;

  if (!row) {
    const { data: billing } = await supabase
      .from("billing_profiles")
      .select("tax_id")
      .eq("user_id", userId)
      .eq("tenant_id", owner.tenantId)
      .maybeSingle();
    const key = taxIdKey(billing?.tax_id);
    if (!key) return { ok: false, error: "no_company" };
    row = await findCompanyByTaxKey(owner.tenantId, key);
  }

  if (!row) return { ok: false, error: "no_company" };
  return { ok: true, company: toBillingData(row) };
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

  // Relacja profil -> kartoteka, żeby kolejny odczyt nie szukał po NIP-ie.
  await supabase
    .from("profiles")
    .update({ current_company_id: company.companyId, current_company: company.name })
    .eq("id", userId)
    .eq("tenant_id", owner.tenantId);

  return { ok: true, company };
}

/**
 * Uzupełnia WYŁĄCZNIE puste rubryki kartoteki - lustro SQL-owego
 * `COALESCE(NULLIF(btrim(c.x), ''), nowa)` z `_event_invoice_crm_link`.
 *
 * DLACZEGO WARUNKOWY ZAPIS. PostgREST nie ma `COALESCE` w UPDATE, więc pustość
 * sprawdzamy na odczycie. Zwykły UPDATE po odczycie nadpisałby jednak adres,
 * który zespół wpisał W MIĘDZYCZASIE. Dlatego UPDATE trafia tylko wtedy, gdy
 * każda uzupełniana kolumna ma wciąż wartość z naszego odczytu (NULL albo te
 * same białe znaki). Brak trafienia = ktoś zmienił kartotekę: czytamy ją
 * ponownie i liczymy uzupełnienie od nowa.
 *
 * `null`, gdy zapis się nie udał albo kartoteka zniknęła.
 */
async function fillEmptyFields(
  tenantId: string,
  company: CompanyRow,
  incoming: Record<FillableColumn, string | null>,
): Promise<CompanyRow | null> {
  const supabase = await admin();
  let current = company;
  for (let attempt = 1; ; attempt += 1) {
    const fill: Partial<Record<FillableColumn, string>> = {};
    for (const column of Object.keys(incoming) as FillableColumn[]) {
      const value = incoming[column];
      // Puste pole w danych do faktury nie kasuje niczego, a wypełnionej
      // rubryki kartoteki nie nadpisujemy - utrzymuje ją zespół.
      if (value !== null && clean(current[column]) === null) fill[column] = value;
    }
    const columns = Object.keys(fill) as FillableColumn[];
    if (columns.length === 0) return current;

    let update = supabase
      .from("crm_companies")
      .update({ ...fill, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("tenant_id", tenantId);
    for (const column of columns) {
      const before = current[column];
      update = before === null ? update.is(column, null) : update.eq(column, before);
    }
    const { data: updated, error } = await update.select(COMPANY_COLUMNS).maybeSingle();
    if (error) return null;
    if (updated) return updated;
    if (attempt >= FILL_ATTEMPTS) return null;
    const reread = await readCompany(tenantId, current.id);
    if (!reread) return null;
    current = reread;
  }
}

/**
 * Dane do faktury -> CRM. Kolejność dopasowania kartoteki jak w SQL
 * (`_event_invoice_crm_link`): relacja, potem NIP, potem nazwa - i wyłącznie
 * uzupełnianie pustych rubryk. Firmy brakującej w kartotece nie zgubimy:
 * zakłada ją ten sam dedup, którego używa synchronizacja członków.
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

  const taxKey = taxIdKey(billing.tax_id);
  const incoming: Record<FillableColumn, string | null> = {
    tax_id: clean(billing.tax_id),
    address: clean(billing.address_line1),
    city: clean(billing.city),
    postal_code: clean(billing.postal_code),
    country: clean(billing.country_code),
    email: clean(billing.email),
    phone: clean(billing.phone),
  };

  // 1. Relacja z profilu. Firmę w profilu członek wybiera z katalogu, więc
  // jedną kartotekę dzieli wiele osób. Powiązanej używamy tylko wtedy, gdy to
  // TEN SAM podmiot co w danych do faktury: ta sama nazwa i NIP, który jej nie
  // przeczy - inaczej członek fakturujący np. na własną działalność dopisałby
  // się do firmy zespołu.
  let target: CompanyRow | null = null;
  if (owner.companyId) {
    const linked = await readCompany(owner.tenantId, owner.companyId);
    if (
      linked &&
      normalizeCompanyName(linked.name) === normalizeCompanyName(name) &&
      !conflictingTaxId(linked, taxKey)
    ) {
      target = linked;
    }
  }

  // 2. NIP przed nazwą (jak SQL): identyfikuje podmiot jednoznacznie, a nazwę
  // ta sama firma potrafi mieć w kartotece zapisaną inaczej niż w checkoucie.
  if (!target && taxKey) target = await findCompanyByTaxKey(owner.tenantId, taxKey);

  // 3. Nazwa - dedup synchronizacji członków (zakłada firmę, gdy jej nie ma).
  if (!target) {
    const companyId = await ensureCrmCompany(supabase, owner.tenantId, name, userId);
    if (!companyId) return { ok: false, error: "no_company" };
    const named = await readCompany(owner.tenantId, companyId);
    if (!named) return { ok: false, error: "no_company" };
    if (conflictingTaxId(named, taxKey)) {
      // Dedup nazw zdejmuje formę prawną, więc „Globex" z NIP-em A trafia do
      // „Globex Sp. z o.o." z NIP-em B. Firma z INNYM niepustym NIP-em to inny
      // podmiot: zakładamy osobną kartotekę z nazwą i danymi członka (jak SQL).
      // Unikat (tenant_id, name_norm) odrzuci ją tylko przy IDENTYCZNEJ nazwie
      // - wtedy odmawiamy, zamiast scalać dwa podmioty w jedną kartotekę.
      const { data: created, error } = await supabase
        .from("crm_companies")
        .insert({ tenant_id: owner.tenantId, name, created_by: userId, ...incoming })
        .select(COMPANY_COLUMNS)
        .single();
      if (error?.code === UNIQUE_VIOLATION) return { ok: false, error: "tax_id_conflict" };
      if (error) throw error;
      target = created;
    } else {
      target = named;
    }
  }

  const saved = await fillEmptyFields(owner.tenantId, target, incoming);
  if (!saved) return { ok: false, error: "no_company" };

  // Profil niesie nazwę z kartoteki - tak samo jak przy wyborze firmy
  // z katalogu (`link_current_company`) i przy „Pobierz z CRM".
  await supabase
    .from("profiles")
    .update({ current_company_id: saved.id, current_company: saved.name })
    .eq("id", userId)
    .eq("tenant_id", owner.tenantId);

  return { ok: true, company: toBillingData(saved) };
}
