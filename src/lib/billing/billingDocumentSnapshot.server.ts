// Migawka dokumentu rozliczeniowego: nabywca, sprzedawca i płaszczyzna
// rozliczeń W CHWILI ZAKUPU (`billing_documents.buyer_snapshot`,
// `seller_snapshot`, `billing_plane`).
//
// PRZYCZYNA (audyt INV-07). Kopia PDF z panelu członka czytała nabywcę
// z `billing_profiles`, sprzedawcę z `site_settings.invoice_issuer` i drukowała
// stałą notę „Podatek rozlicza operator (MoR)" - wszystko na żywo, w chwili
// pobrania. Zmiana danych w profilu albo „Pobierz z CRM" przepisywała nabywcę
// na KAŻDYM starym dokumencie, a w płaszczyźnie `merchant` (sprzedawca sam
// rozlicza podatek, `checkoutBillingPlane`) plik niósł fałszywą adnotację.
// Dokument księgowy opisuje transakcję z dnia transakcji, nie dzisiejszy profil.
//
// KIEDY POWSTAJE:
//  * webhook przy ZAŁOŻENIU dokumentu (`billingDocuments.server`) - z tych
//    samych źródeł, z których PDF czytał dotąd;
//  * wiersz bez migawki (sprzed migracji 20261012110000 albo zapisany, gdy
//    odczyt źródeł zawiódł) dostaje ją przy PIERWSZYM pobraniu PDF:
//    `UPDATE ... WHERE buyer_snapshot IS NULL`, więc dwa równoległe pobrania
//    drukują tę samą migawkę - wygrywa pierwsze, drugie czyta zapisaną.
// Raz zapisanej migawki nie zmienia już nic: pilnuje tego trigger
// `billing_documents_snapshot_write_once` i CHECK kompletności (migawka jest
// cała albo jej nie ma).
//
// Moduł server-only (klient service_role).
import type { Json } from "@/integrations/supabase/types";
import {
  CHECKOUT_SETTINGS_COLUMNS,
  checkoutBillingPlane,
  normalizeCheckoutSettings,
  type CheckoutBillingPlane,
} from "@/lib/billing/checkoutSettings";
import type { InvoiceParty } from "@/lib/billing/invoicePdf";

/**
 * Zbiór z `CHECK (billing_plane IN (...))` - te same płaszczyzny co
 * `CheckoutBillingPlane`. Parytet z migracją: `billingDocumentsDbCheck.test.ts`.
 */
export const BILLING_DOCUMENT_PLANES = [
  "managed",
  "merchant",
] as const satisfies readonly CheckoutBillingPlane[];

export interface BillingDocumentSnapshot {
  buyer: InvoiceParty;
  seller: InvoiceParty;
  plane: CheckoutBillingPlane;
}

/** Kolumny migawki w kształcie wiersza `billing_documents`. */
export interface BillingDocumentSnapshotColumns {
  buyer_snapshot: Json | null;
  seller_snapshot: Json | null;
  billing_plane: string | null;
}

const DEFAULT_SELLER_NAME = "New European Strategies";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Klient pobrany RAZ na złożenie migawki i podawany do odczytów. Równoległe
 * `import()` tego samego modułu z kilku gałęzi `Promise.all` niczego nie
 * przyspiesza, a atrapa modułu w vitest potrafi wtedy oddać jednej z gałęzi
 * moduł prawdziwy - test zobaczyłby awarię, której w produkcji nie ma.
 */
type AdminClient = Awaited<ReturnType<typeof admin>>;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Błąd odczytu źródła przerywa składanie migawki. Migawka bez NIP-u wystawcy
 * czy firmy nabywcy wygląda na poprawną, a zamrożona utrwaliłaby niekompletny
 * dokument księgowy NA ZAWSZE - lepiej, żeby panel pokazał błąd i członek
 * ponowił pobranie.
 */
function failOnReadError(table: string, error: { message: string } | null): void {
  if (error) throw new Error(`billing document snapshot: ${table} read failed: ${error.message}`);
}

/** Dane wystawcy: site_settings.invoice_issuer nadpisuje wartości domyślne. */
async function loadSeller(supabase: AdminClient, tenantId: string): Promise<InvoiceParty> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("key", "invoice_issuer")
    .maybeSingle();
  failOnReadError("site_settings", error);
  // Wartości domyślne tylko dla BRAKU wpisu - błąd odczytu rzucił wyżej.
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  return {
    name: str(raw.name) ?? DEFAULT_SELLER_NAME,
    taxId: str(raw.tax_id),
    addressLine1: str(raw.address_line1),
    addressLine2: str(raw.address_line2),
    postalCode: str(raw.postal_code),
    city: str(raw.city),
    country: str(raw.country),
    email: str(raw.email),
  };
}

/**
 * Płaszczyzna rozliczeń najemcy. Świadomie NIE `loadCheckoutSettings`: tamten
 * odczyt przy awarii schodzi na ustawienia domyślne (płatność nie może się
 * wywrócić), a tu domyślne `managed` zamroziłoby notę MoR na dokumencie
 * sprzedawcy rozliczającego podatek samodzielnie. Brak wiersza to legalne
 * ustawienia domyślne - dokładnie tak, jak liczy je checkout.
 */
async function loadBillingPlane(
  supabase: AdminClient,
  tenantId: string,
): Promise<CheckoutBillingPlane> {
  const { data, error } = await supabase
    .from("checkout_settings")
    .select(CHECKOUT_SETTINGS_COLUMNS)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  failOnReadError("checkout_settings", error);
  return checkoutBillingPlane(normalizeCheckoutSettings(data));
}

function buyerFromProfile(
  row: Record<string, unknown> | null,
  fallbackEmail: string | null,
): InvoiceParty {
  if (!row) return { name: fallbackEmail ?? "-", email: fallbackEmail };
  const company = str(row.company);
  const person = str(row.full_name);
  return {
    name: (row.is_company ? company : person) ?? company ?? person ?? fallbackEmail ?? "-",
    taxId: str(row.tax_id),
    addressLine1: str(row.address_line1),
    addressLine2: str(row.address_line2),
    postalCode: str(row.postal_code),
    city: str(row.city),
    country: str(row.country_code),
    email: str(row.email) ?? fallbackEmail,
  };
}

/**
 * Płaszczyzna dokumentu: ostemplowana na ZAMÓWIENIU w chwili jego założenia
 * (`payment_orders.billing_plane`, audyt INV-09) - zmiana ustawień kasy
 * między zakupem a webhookiem (albo jego ponowieniem po dniach) nie może
 * przestawić noty podatkowej zamrażanej na zawsze. Bieżące ustawienia tylko
 * dla dokumentu bez zamówienia (subskrypcja) albo zamówienia sprzed stempla.
 */
async function loadDocumentPlane(
  supabase: AdminClient,
  tenantId: string,
  orderId: string | null,
): Promise<CheckoutBillingPlane> {
  if (orderId) {
    const { data, error } = await supabase
      .from("payment_orders")
      .select("billing_plane")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    failOnReadError("payment_orders", error);
    const stamped = data?.billing_plane;
    if (isBillingPlane(stamped)) return stamped;
  }
  return loadBillingPlane(supabase, tenantId);
}

/** Migawka ze źródeł bieżących: profil rozliczeniowy, ustawienia wystawcy, płaszczyzna zamówienia. */
export async function loadBillingDocumentSnapshot(owner: {
  userId: string;
  tenantId: string;
  orderId?: string | null;
}): Promise<BillingDocumentSnapshot> {
  const supabase = await admin();
  const [billingRead, profileRead, seller, plane] = await Promise.all([
    supabase
      .from("billing_profiles")
      .select(
        "full_name, company, tax_id, email, address_line1, address_line2, city, postal_code, country_code, is_company",
      )
      .eq("user_id", owner.userId)
      .eq("tenant_id", owner.tenantId)
      .maybeSingle(),
    supabase.from("profiles").select("email").eq("id", owner.userId).maybeSingle(),
    loadSeller(supabase, owner.tenantId),
    loadDocumentPlane(supabase, owner.tenantId, owner.orderId ?? null),
  ]);
  failOnReadError("billing_profiles", billingRead.error);
  failOnReadError("profiles", profileRead.error);
  return {
    buyer: buyerFromProfile(
      billingRead.data as Record<string, unknown> | null,
      str(profileRead.data?.email),
    ),
    seller,
    plane,
  };
}

/** Strona dokumentu jako JSON o stałym komplecie kluczy (brak wartości = `null`). */
function partyJson(party: InvoiceParty): Json {
  return {
    name: party.name,
    taxId: party.taxId ?? null,
    addressLine1: party.addressLine1 ?? null,
    addressLine2: party.addressLine2 ?? null,
    postalCode: party.postalCode ?? null,
    city: party.city ?? null,
    country: party.country ?? null,
    email: party.email ?? null,
  };
}

function partyFromJson(value: Json | null): InvoiceParty | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const name = str(value.name);
  if (!name) return null;
  return {
    name,
    taxId: str(value.taxId),
    addressLine1: str(value.addressLine1),
    addressLine2: str(value.addressLine2),
    postalCode: str(value.postalCode),
    city: str(value.city),
    country: str(value.country),
    email: str(value.email),
  };
}

function isBillingPlane(value: unknown): value is CheckoutBillingPlane {
  return (BILLING_DOCUMENT_PLANES as readonly unknown[]).includes(value);
}

export function snapshotColumns(snapshot: BillingDocumentSnapshot): BillingDocumentSnapshotColumns {
  return {
    buyer_snapshot: partyJson(snapshot.buyer),
    seller_snapshot: partyJson(snapshot.seller),
    billing_plane: snapshot.plane,
  };
}

/** Migawka zapisana w wierszu; `null`, gdy jej nie ma (albo jest nieczytelna). */
export function snapshotFromRow(
  row: BillingDocumentSnapshotColumns,
): BillingDocumentSnapshot | null {
  const buyer = partyFromJson(row.buyer_snapshot);
  const seller = partyFromJson(row.seller_snapshot);
  if (!buyer || !seller || !isBillingPlane(row.billing_plane)) return null;
  return { buyer, seller, plane: row.billing_plane };
}

const SNAPSHOT_COLUMNS = "buyer_snapshot, seller_snapshot, billing_plane" as const;

/**
 * Zamrożenie migawki dokumentu, który jej nie ma (write-once). Zwraca migawkę
 * ZAPISANĄ W BAZIE - własną albo, gdy równoległe pobranie było szybsze, tamtą.
 * Rzuca, gdy źródła są nieczytelne albo wiersz ma migawkę uszkodzoną: wtedy
 * nie ma czego drukować, a dorobienie nowej złamałoby niezmienność.
 */
export async function freezeBillingDocumentSnapshot(doc: {
  id: string;
  user_id: string;
  tenant_id: string;
  order_id?: string | null;
}): Promise<BillingDocumentSnapshot> {
  const live = await loadBillingDocumentSnapshot({
    userId: doc.user_id,
    tenantId: doc.tenant_id,
    orderId: doc.order_id ?? null,
  });
  const supabase = await admin();
  const { data: frozen, error } = await supabase
    .from("billing_documents")
    .update(snapshotColumns(live))
    .eq("id", doc.id)
    .eq("tenant_id", doc.tenant_id)
    .is("buyer_snapshot", null)
    .select(SNAPSHOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`billing document snapshot: freeze failed: ${error.message}`);

  // Zero wierszy = migawkę zapisał ktoś wcześniej (równoległe pobranie).
  // Drukujemy JEGO wersję, nie świeżo przeczytaną - inaczej dwa pierwsze
  // pobrania mogłyby dać dwa różne pliki tego samego dokumentu.
  let row = frozen;
  if (!row) {
    const reread = await supabase
      .from("billing_documents")
      .select(SNAPSHOT_COLUMNS)
      .eq("id", doc.id)
      .eq("tenant_id", doc.tenant_id)
      .maybeSingle();
    failOnReadError("billing_documents", reread.error);
    row = reread.data;
  }
  const snapshot = row ? snapshotFromRow(row) : null;
  if (!snapshot)
    throw new Error(`billing document snapshot: document ${doc.id} has no readable snapshot`);
  return snapshot;
}
