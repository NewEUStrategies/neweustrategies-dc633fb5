// Dokumenty rozliczeniowe (faktury, potwierdzenia płatności) dla płatności u operatora.
//
// Numer faktury nadaje operator - czasem dopiero PO `transaction.completed`,
// osobnym zdarzeniem `transaction.updated`. Dlatego zapis jest idempotentny i
// aktualizujący: pierwsze zdarzenie zakłada dokument, kolejne uzupełniają
// numer i kwotę. Adres pliku PDF pobieramy na żądanie (`invoice.server`), bo
// operator wystawia wyłącznie linki czasowe.
//
// STAN DOKUMENTU tłumaczy `billingDocumentStatus` - jedyne miejsce, które zna
// zbiór z CHECK-a tabeli. Przepisywanie stanu operatora dosłownie (z domyślnym
// `pending`) rozbijało na CHECK-u każdy zakup jednorazowy (audyt INV-04).
//
// AWARIA ZAPISU TO ALARM, NIE CISZA. Jedynym poprawnym powodem odrzucenia
// wstawienia jest unikalność (23505 - wyścig dwóch zdarzeń o tę samą
// transakcję). Każdy inny błąd oznacza dokument, którego członek nie zobaczy,
// więc idzie do logu jako błąd, do administratorów najemcy jako dzwonek
// (`notifyTenantAdmins`, ten sam kanał co spory płatnicze) i wraca jako
// `failed` - odróżnialny od świadomego `skipped`.
//
// POWIĄZANIE Z ZAMÓWIENIEM (S7, 4.3 / 5.4). Historia płatności klienta
// (`mergePaymentHistory`) chowa zamówienie, które przykrywa jego dokument -
// po `billing_documents.order_id`. Zamówienie bierzemy wyłącznie z NASZEJ
// bazy: po identyfikatorze transakcji, który stempluje realizacja, albo po
// `orderId` z metadanych sprawdzonym z naszym wierszem (środowisko, rodzaj,
// subskrypcja, właściciel). Ładunek operatora jest tu tylko kluczem
// wyszukiwania - właściciel i najemca zawsze z naszego wiersza.
//
// Faktura subskrypcji przykrywa zamówienie tylko wtedy, gdy JEST zakupem
// z zamówienia: opłaciła je (trial) albo jest PIERWSZĄ fakturą subskrypcji
// (`billing_reason = subscription_create`). Metadane `orderId` niesie każda
// faktura subskrypcji z naszej kasy - także odnowienia subskrypcji sprzed
// wdrożenia, których zamówienie nie ma jeszcze żadnego dokumentu.
//
// WŁAŚCICIEL PIERWSZEJ FAKTURY (4.4 / 5.5 / 6.9). `invoice.paid` potrafi
// przyjść przed `customer.subscription.created` (Stripe wysyła je równolegle);
// bez wiersza `subscriptions` faktura nie miała właściciela i przepadała bez
// śladu. Zapasem jest zamówienie z metadanych subskrypcji.
//
// Moduł server-only (klient service_role; klient operatora wyłącznie po
// `billing_reason` faktury, gdy ładunek go nie niesie).
import {
  loadBillingDocumentSnapshot,
  snapshotColumns,
  type BillingDocumentSnapshot,
} from "@/lib/billing/billingDocumentSnapshot.server";
import {
  billingDocumentStatus,
  billingDocumentStatusTransition,
} from "@/lib/billing/billingDocumentStatus";
import type { BillingDocumentKind } from "@/lib/billing/types";
import type { StripeEnv } from "@/lib/stripe.server";

type Raw = Record<string, unknown>;

/** Postgres `unique_violation` - jedyny błąd wstawienia, który jest wynikiem poprawnym. */
const UNIQUE_VIOLATION = "23505";

export type RecordDocumentOutcome = "created" | "updated" | "skipped" | "failed";

const str = (row: Raw | null | undefined, key: string): string | null => {
  const value = row?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface TransactionDocumentInput {
  transactionId: string;
  subscriptionId: string | null;
  amountCents: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  /** Link do faktury hostowanej przez Stripe (`hosted_invoice_url`). */
  hostedUrl: string | null;
  /** Link do PDF faktury (`invoice_pdf`) - czasem gotowy dopiero po chwili. */
  pdfUrl: string | null;
  /** Stan u operatora, surowy - na stan rejestru tłumaczy go `billingDocumentStatus`. */
  status: string | null;
  /** Faktura operatora albo potwierdzenie płatności jednorazowej (sesja Checkout). */
  kind: Extract<BillingDocumentKind, "invoice" | "receipt">;
  issuedAt: string | null;
  environment: StripeEnv;
  /**
   * NASZE zamówienie z metadanych transakcji (`orderId`, ustawia kasa). Tylko
   * klucz wyszukiwania - wiązanie i właściciela rozstrzyga nasz wiersz.
   */
  orderId?: string | null;
  /**
   * `billing_reason` faktury, gdy niesie go ładunek. Bez niego (ładunek bez
   * pola, powtórka z dziennika) pytamy operatora - tylko wtedy, gdy od tego
   * zależy powiązanie z zamówieniem.
   */
  billingReason?: string | null;
}

/** Właściciel dokumentu i zamówienie, które dokument przykrywa w historii. */
interface DocumentOwner {
  userId: string;
  tenantId: string;
  /** Zamówienie, do którego dokument wolno przypiąć (`null` = żadne). */
  orderId: string | null;
}

/** Zamówienie w kształcie potrzebnym do ustalenia właściciela i powiązania. */
interface OwnerOrder {
  id: string;
  user_id: string | null;
  tenant_id: string;
  kind: string;
  provider_intent_id: string | null;
  provider_subscription_id: string | null;
}

const ORDER_COLUMNS = "id, user_id, tenant_id, kind, provider_intent_id, provider_subscription_id";

/**
 * Zamówienie subskrypcji z metadanych faktury - wyłącznie wtedy, gdy nasz
 * wiersz potwierdza powiązanie: to samo środowisko, rodzaj `subscription`
 * i ta sama subskrypcja operatora (albo jeszcze żadna - domknięcie
 * zamówienia mogło nie zdążyć zapisać identyfikatora).
 */
async function subscriptionOrderFor(input: TransactionDocumentInput): Promise<OwnerOrder | null> {
  if (!input.orderId || !input.subscriptionId) return null;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("payment_orders")
    .select(ORDER_COLUMNS)
    .eq("id", input.orderId)
    .eq("environment", input.environment)
    .maybeSingle();
  if (error) throw new Error(`subscription order lookup failed: ${error.message}`);
  const order = data as OwnerOrder | null;
  if (!order || order.kind !== "subscription") return null;
  if (order.provider_subscription_id && order.provider_subscription_id !== input.subscriptionId) {
    return null;
  }
  return order;
}

/** Brak obiektu u operatora (404 / `resource_missing`) - to nie awaria odczytu. */
function isMissingResource(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; statusCode?: unknown };
  return e.code === "resource_missing" || e.statusCode === 404;
}

/**
 * `billing_reason` faktury: z ładunku, a bez niego od operatora (w środowisku
 * zdarzenia). Identyfikator spoza faktur i faktura nieznana operatorowi to
 * `null` (powodu nie znamy - nie wiążemy); każda inna awaria RZUCA, a zapis
 * dokumentu kończy się `failed` i zdarzenie wraca (reguła INV).
 */
async function invoiceBillingReason(input: TransactionDocumentInput): Promise<string | null> {
  if (input.billingReason) return input.billingReason;
  if (!input.transactionId.startsWith("in_")) return null;
  try {
    const { getStripeClient } = await import("@/lib/stripe.server");
    const stripe = await getStripeClient(input.environment);
    const invoice = await stripe.invoices.retrieve(input.transactionId);
    return typeof invoice.billing_reason === "string" ? invoice.billing_reason : null;
  } catch (error) {
    if (isMissingResource(error)) return null;
    throw new Error(
      `invoice billing reason lookup failed (${input.transactionId}): ${errorMessage(error)}`,
    );
  }
}

/**
 * Czy dokument tej transakcji ma przykryć zamówienie subskrypcji:
 *   - faktura, która OPŁACIŁA zamówienie (`provider_intent_id` - po trialu);
 *   - dokument już przypięty do zamówienia (ponowiona dostawa) - bez pytania
 *     operatora;
 *   - pierwszy dokument zamówienia, ale WYŁĄCZNIE pierwsza faktura
 *     subskrypcji (`subscription_create`).
 * Odnowienia niosą to samo `orderId` w metadanych subskrypcji, ale NIE są
 * zakupem z zamówienia - przypięte dostałyby z historii rabat kuponu, którego
 * nie miały, i schowały zamówienie. Pusty rejestr zamówienia tego nie
 * rozstrzyga: subskrypcja sprzed wdrożenia ma pierwszą fakturę zapisaną bez
 * powiązania (albo wcale), więc jej pierwsze odnowienie po wdrożeniu było
 * „pierwszym dokumentem" zamówienia.
 */
async function coversSubscriptionOrder(
  order: OwnerOrder,
  input: TransactionDocumentInput,
): Promise<boolean> {
  if (order.provider_intent_id === input.transactionId) return true;
  const supabase = await admin();
  const { data, error } = await supabase
    .from("billing_documents")
    .select("provider_document_id")
    .eq("order_id", order.id)
    .limit(2);
  if (error) throw new Error(`order document lookup failed: ${error.message}`);
  const linked = (data ?? []).map((row) => row.provider_document_id);
  if (linked.includes(input.transactionId)) return true;
  if (linked.length > 0) return false;
  return (await invoiceBillingReason(input)) === "subscription_create";
}

/**
 * Właściciel i tenant transakcji - z subskrypcji albo z zamówienia. `null` =
 * transakcja bez właściciela (gość). Błąd odczytu RZUCA: „nie wiem, czyja to
 * transakcja" to nie to samo co „gość", a pomylenie ich chowało awarię bazy
 * pod cichym pominięciem dokumentu.
 */
async function ownerFor(input: TransactionDocumentInput): Promise<DocumentOwner | null> {
  const supabase = await admin();

  if (input.subscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("user_id, tenant_id")
      .eq("provider_subscription_id", input.subscriptionId)
      .eq("environment", input.environment)
      .maybeSingle();
    if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
    const order = await subscriptionOrderFor(input);
    if (data?.user_id) {
      // Zamówienie innego konta albo najemcy niż subskrypcja nie jest tym
      // zakupem - dokument zostaje bez powiązania.
      const linked =
        order && order.user_id === data.user_id && order.tenant_id === data.tenant_id
          ? (await coversSubscriptionOrder(order, input))
            ? order.id
            : null
          : null;
      return { userId: data.user_id, tenantId: data.tenant_id, orderId: linked };
    }
    // Pierwsza faktura przed `customer.subscription.created`: właściciel
    // z NASZEGO zamówienia subskrypcji.
    if (order?.user_id) {
      return {
        userId: order.user_id,
        tenantId: order.tenant_id,
        orderId: (await coversSubscriptionOrder(order, input)) ? order.id : null,
      };
    }
  }

  // Zawężenie do środowiska jest TU tak samo obowiązkowe jak w gałęzi
  // subskrypcyjnej wyżej: identyfikator transakcji z piaskownicy i z produkcji
  // może się powtórzyć, a ustalony tu właściciel trafia wprost do dokumentu
  // księgowego (`user_id`, `tenant_id`) - pomyłka to cudza faktura w cudzym
  // panelu. Historyczne zamówienia sprzed kolumny mają z migracji
  // `20260731220000_payment_orders_environment_isolation` wartość 'live', więc
  // filtr nie odcina im dokumentów dla ruchu produkcyjnego. Zamówienie
  // znalezione po identyfikatorze, który stempluje realizacja, JEST zakupem
  // tej transakcji - dokument je przykrywa.
  const { data: order, error } = await supabase
    .from("payment_orders")
    .select("id, user_id, tenant_id")
    .eq("provider_intent_id", input.transactionId)
    .eq("environment", input.environment)
    .maybeSingle();
  if (error) throw new Error(`payment_orders lookup failed: ${error.message}`);
  if (order?.user_id)
    return { userId: order.user_id, tenantId: order.tenant_id, orderId: order.id };

  return null;
}

/**
 * Odczyt albo zapis rejestru nie udał się z powodu innego niż wyścig: log
 * BŁĘDU, dzwonek dla administratorów najemcy dokumentu i wynik `failed`. Treść
 * alarmu niesie wyłącznie identyfikatory (transakcja, kod błędu) - żadnych
 * danych nabywcy.
 */
async function documentNotRecorded(
  owner: DocumentOwner,
  input: TransactionDocumentInput,
  operation: "lookup" | "insert" | "update",
  error: { message: string; code?: string },
): Promise<"failed"> {
  const code = error.code || "unknown";
  console.error(`[payments] billing document ${operation} failed`, input.transactionId, {
    code,
    message: error.message,
  });
  const { notifyTenantAdmins } = await import("@/lib/events/tenantAdminAlert.server");
  await notifyTenantAdmins({
    tenantId: owner.tenantId,
    kind: "billing",
    titlePl: "Nie zapisano dokumentu rozliczeniowego",
    titleEn: "Billing document not recorded",
    bodyPl: `Płatność ${input.transactionId} nie trafiła do rejestru dokumentów członka (błąd bazy ${code}). Sprawdź dziennik webhooków.`,
    bodyEn: `Payment ${input.transactionId} is missing from the member's document register (database error ${code}). Check the webhook log.`,
    href: "/admin/billing",
    icon: "credit-card",
  });
  return "failed";
}

/**
 * Zapisuje lub uzupełnia dokument rozliczeniowy dla transakcji.
 * Bez właściciela (płatność gościa bez konta) po prostu nic nie zapisujemy -
 * potwierdzenie idzie wtedy mailem, a nie do panelu.
 */
export async function recordTransactionDocument(
  input: TransactionDocumentInput,
): Promise<RecordDocumentOutcome> {
  if (!input.transactionId) return "skipped";
  let owner: DocumentOwner | null;
  try {
    owner = await ownerFor(input);
  } catch (e) {
    // Bez właściciela nie ma najemcy, któremu można wysłać dzwonek - zostaje
    // log błędu i dziennik webhooków (jak przy sporze bez najemcy).
    console.error("[payments] billing document owner lookup failed", input.transactionId, {
      message: errorMessage(e),
    });
    return "failed";
  }
  if (!owner) return "skipped";

  // Filtr najemcy także tu: dokument innego najemcy o tym samym
  // identyfikatorze nie może przyjąć danych tej transakcji.
  const supabase = await admin();
  const { data: existing, error: loadError } = await supabase
    .from("billing_documents")
    .select("id, number, amount_cents, status, order_id")
    .eq("provider_document_id", input.transactionId)
    .eq("tenant_id", owner.tenantId)
    .maybeSingle();
  if (loadError) return documentNotRecorded(owner, input, "lookup", loadError);

  // `null` = stan nieznany. Nowy dokument dostaje wtedy `open` (nie wolno
  // twierdzić, że zapłacono), a istniejący zostaje przy swoim - nieznany stan
  // nie może cofnąć opłaconej faktury.
  const status = billingDocumentStatus(input.status);
  const amount = Number.isFinite(input.amountCents ?? NaN) ? (input.amountCents as number) : 0;

  if (existing) {
    const patch: {
      updated_at: string;
      number?: string;
      amount_cents?: number;
      status?: string;
      hosted_url?: string;
      pdf_url?: string;
      order_id?: string;
    } = { updated_at: new Date().toISOString() };
    if (input.invoiceNumber && input.invoiceNumber !== existing.number) {
      patch.number = input.invoiceNumber;
    }
    if (amount > 0 && amount !== existing.amount_cents) patch.amount_cents = amount;
    // Tylko do przodu: spóźnione albo ponowione zdarzenie nie cofa stanu
    // (np. `refunded` -> `paid`, `paid` -> `open`).
    const nextStatus = billingDocumentStatusTransition(existing.status, status);
    if (nextStatus !== null) patch.status = nextStatus;
    if (input.hostedUrl) patch.hosted_url = input.hostedUrl;
    if (input.pdfUrl) patch.pdf_url = input.pdfUrl;
    // Dokument zapisany przed powiązaniem (stara wersja, wyścig z realizacją)
    // dostaje zamówienie przy kolejnej dostawie; raz zapisanego nie zmieniamy.
    if (owner.orderId && !existing.order_id) patch.order_id = owner.orderId;
    if (Object.keys(patch).length === 1) return "skipped";

    const { error } = await supabase
      .from("billing_documents")
      .update(patch)
      .eq("id", existing.id)
      .eq("tenant_id", owner.tenantId);
    if (error) return documentNotRecorded(owner, input, "update", error);
    return "updated";
  }

  // Migawka stron i płaszczyzny rozliczeń z CHWILI ZAKUPU (audyt INV-07).
  // Jej brak nie blokuje dokumentu - członek ma zobaczyć zakup od razu -
  // a migawkę zamrozi pierwsze pobranie PDF (`freezeBillingDocumentSnapshot`).
  const snapshot = await loadBillingDocumentSnapshot(owner).catch(
    (e: unknown): BillingDocumentSnapshot | null => {
      console.error("[payments] billing document snapshot unavailable", input.transactionId, {
        message: errorMessage(e),
      });
      return null;
    },
  );

  const { error } = await supabase.from("billing_documents").insert({
    provider: "stripe",
    provider_document_id: input.transactionId,
    kind: input.kind,
    number: input.invoiceNumber,
    hosted_url: input.hostedUrl,
    pdf_url: input.pdfUrl,
    amount_cents: amount,
    currency: (input.currency ?? "EUR").toUpperCase(),
    status: status ?? "open",
    issued_at: input.issuedAt ?? new Date().toISOString(),
    user_id: owner.userId,
    tenant_id: owner.tenantId,
    // Powiązanie z zamówieniem scala historię płatności (`mergePaymentHistory`):
    // bez niego zakup jednorazowy pokazałby się dwa razy - jako dokument i jako
    // zamówienie bez dokumentu.
    order_id: owner.orderId,
    ...(snapshot ? snapshotColumns(snapshot) : {}),
  });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Wyścig dwóch zdarzeń o tę samą transakcję - drugi zapis przegrywa na
      // unikalności i to jest poprawny wynik, nie błąd.
      console.warn("[payments] billing document insert lost race", input.transactionId);
      return "skipped";
    }
    return documentNotRecorded(owner, input, "insert", error);
  }
  return "created";
}

/**
 * Odczyt pól dokumentu ze znormalizowanej transakcji Stripe (faktura albo
 * sesja Checkout - `stripeEvents.server` dokłada `status`, `documentKind`,
 * `invoiceNumber`, `hostedInvoiceUrl` i `invoicePdf`). `null` = transakcja nie
 * ma własnego dokumentu: brak identyfikatora albo `documentKind: null` (sesja
 * subskrypcji - dokumentem jest jej pierwsza faktura). Brak pola
 * `documentKind` (ładunek `transaction.updated`) znaczy fakturę.
 *
 * `fallbackStatus` obowiązuje, gdy ładunek nie niesie statusu (ładunek
 * z dziennika sprzed wdrożenia pola `status` w normalizatorze): sesja
 * `transaction.completed` znaczy „opłacone".
 */
export function documentInputFromTransaction(
  data: unknown,
  environment: StripeEnv,
  fallbackStatus: string | null = null,
): TransactionDocumentInput | null {
  const row = (data ?? {}) as Raw;
  const id = str(row, "id");
  if (!id) return null;
  const kind = row.documentKind === undefined ? "invoice" : row.documentKind;
  if (kind !== "invoice" && kind !== "receipt") return null;
  const totals = (row.details as Raw | undefined)?.totals as Raw | undefined;
  const customData =
    row.customData !== null && typeof row.customData === "object" && !Array.isArray(row.customData)
      ? (row.customData as Raw)
      : null;
  const grand =
    typeof totals?.grandTotal === "string" ? Number.parseInt(totals.grandTotal, 10) : NaN;
  return {
    transactionId: id,
    subscriptionId: str(row, "subscriptionId"),
    amountCents: Number.isFinite(grand) ? grand : null,
    currency: str(row, "currencyCode"),
    invoiceNumber: str(row, "invoiceNumber"),
    hostedUrl: str(row, "hostedInvoiceUrl"),
    pdfUrl: str(row, "invoicePdf"),
    status: str(row, "status") ?? fallbackStatus,
    kind,
    issuedAt: str(row, "billedAt") ?? str(row, "createdAt"),
    environment,
    orderId: str(customData, "orderId") ?? str(customData, "order_id"),
    billingReason: str(row, "billingReason"),
  };
}
