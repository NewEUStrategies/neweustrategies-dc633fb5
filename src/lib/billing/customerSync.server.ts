// Synchronizacja danych klienta z operatora płatności do naszego profilu
// rozliczeniowego.
//
// Klient może zmienić e-mail, adres albo dane firmy w portalu operatora -
// bez tej synchronizacji nasze faktury, stawka podatku i korespondencja
// rozjeżdżają się z tym, co widzi operator. Wiersz `billing_profiles`
// AKTUALIZUJEMY, ale nigdy nie tworzymy: profil bez zgody użytkownika nie ma
// prawa powstać z webhooka.
//
// Moduł server-only (klient service_role).
import type { PaddleEnv } from "@/lib/paddle.server";

/** Ładunki operatora czytamy defensywnie - SDK nie typuje ich stabilnie. */
type Raw = Record<string, unknown>;

const str = (row: Raw, key: string): string | null => {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Użytkownik stojący za identyfikatorem klienta u operatora. Jedynym
 * wiarygodnym powiązaniem jest tabela `subscriptions` - to ona powstaje z
 * `custom_data.userId` przy zakupie.
 */
async function userForCustomer(customerId: string | null, env: PaddleEnv): Promise<string | null> {
  if (!customerId) return null;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id")
    .eq("paddle_customer_id", customerId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[payments] customer lookup failed", customerId, error.message);
    return null;
  }
  return data?.user_id ?? null;
}

type ProfilePatch = Partial<{
  email: string;
  full_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  region: string;
  postal_code: string;
  country_code: string;
  company: string;
  tax_id: string;
  is_company: boolean;
}>;

/** Aktualizuje istniejący profil; brak profilu = nic do zrobienia. */
async function patchProfile(userId: string, patch: ProfilePatch): Promise<boolean> {
  if (Object.keys(patch).length === 0) return false;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("billing_profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .select("id");
  if (error) {
    console.error("[payments] billing profile sync failed", userId, error.message);
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/** `customer.updated` - e-mail i nazwa klienta. */
export async function syncCustomerProfile(data: unknown, env: PaddleEnv): Promise<void> {
  const row = (data ?? {}) as Raw;
  const userId = await userForCustomer(str(row, "id"), env);
  if (!userId) return;

  const patch: ProfilePatch = {};
  const email = str(row, "email");
  const name = str(row, "name");
  if (email) patch.email = email;
  if (name) patch.full_name = name;
  await patchProfile(userId, patch);
}

/** `address.updated` - adres rozliczeniowy (wpływa na stawkę podatku). */
export async function syncCustomerAddress(data: unknown, env: PaddleEnv): Promise<void> {
  const row = (data ?? {}) as Raw;
  const userId = await userForCustomer(str(row, "customerId"), env);
  if (!userId) return;

  const patch: ProfilePatch = {};
  const line1 = str(row, "firstLine");
  const line2 = str(row, "secondLine");
  const city = str(row, "city");
  const region = str(row, "region");
  const postal = str(row, "postalCode");
  const country = str(row, "countryCode");
  if (line1) patch.address_line1 = line1;
  if (line2) patch.address_line2 = line2;
  if (city) patch.city = city;
  if (region) patch.region = region;
  if (postal) patch.postal_code = postal;
  if (country) patch.country_code = country.toUpperCase();
  await patchProfile(userId, patch);
}

/** `business.updated` - nazwa firmy i numer podatkowy (faktura B2B). */
export async function syncCustomerBusiness(data: unknown, env: PaddleEnv): Promise<void> {
  const row = (data ?? {}) as Raw;
  const userId = await userForCustomer(str(row, "customerId"), env);
  if (!userId) return;

  const patch: ProfilePatch = {};
  const company = str(row, "name");
  const taxId = str(row, "taxIdentifier");
  if (company) {
    patch.company = company;
    patch.is_company = true;
  }
  if (taxId) patch.tax_id = taxId;
  await patchProfile(userId, patch);
}
