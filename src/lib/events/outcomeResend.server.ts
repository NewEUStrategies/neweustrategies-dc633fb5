// Ponowna wysyłka powiadomienia o statusie zgłoszenia - BEZ dotykania pieniędzy.
//
// PO CO TO ISTNIEJE OBOK PONOWIENIA WEBHOOKA. Ponowienie zdarzenia z dziennika
// (`webhookRetry`) przetwarza ładunek operatora jeszcze raz: może zmienić
// status zamówienia, zwolnić miejsce, ruszyć listę rezerwową. Tymczasem
// najczęstsza awaria jest inna - pieniądze i miejsce są w porządku, a mail
// wpadł do niedziałającej skrzynki albo SMS nie wyszedł. Wtedy admin
// potrzebuje operacji, która JEDYNIE powtarza wiadomość.
//
// STAN CZYTAMY Z BAZY, NIE Z FORMULARZA. Wołający podaje wyłącznie
// identyfikator zgłoszenia; treść składa się z tego, co realnie zapisano -
// więc powtórka nie może obiecać uczestnikowi innego statusu niż prawdziwy.
//
// Moduł server-only (klient service_role).
import type {
  OutcomeNotifyResult,
  TicketOutcome,
  TicketOutcomePayload,
} from "@/lib/events/registrationOutcomeNotify.server";

export interface ResendOutcomeResult extends OutcomeNotifyResult {
  registrationId: string;
  outcome: TicketOutcome;
}

interface OrderRow {
  amount_cents: number | null;
  refunded_amount_cents: number | null;
  currency: string | null;
}

/** Wynik płatności odtworzony ze stanu zapisanego w bazie. */
function resolveOutcome(paymentStatus: string | null, order: OrderRow | null): TicketOutcome {
  const amount = order?.amount_cents ?? 0;
  const refunded = order?.refunded_amount_cents ?? 0;
  if (refunded > 0 && amount > 0 && refunded >= amount) return "refunded";
  if (refunded > 0) return "partial_refund";
  if (paymentStatus === "refunded") return "refunded";
  if (paymentStatus === "paid") return "paid";
  return "unpaid";
}

/**
 * Składa ładunek wyniku dla istniejącego zgłoszenia i wysyła powiadomienia
 * ponownie. Nie wykonuje ŻADNEGO zapisu poza dziennikiem wysyłki.
 *
 * NAJEMCA JEST ARGUMENTEM, BO IDENTYFIKATOR POCHODZI OD KLIENTA. Wołający
 * podaje `registrationId` z formularza, a czytamy kluczem serwisowym, czyli
 * z pominięciem RLS - bez jawnego `.eq("tenant_id", …)` admin najemcy A
 * wysłałby uczestnikowi najemcy B mail i SMS o jego bilecie (UUID-y zgłoszeń
 * wędrują w kodach QR, eksportach CSV i adresach zarządzania zapisem).
 * `tenantId` MUSI pochodzić z bramki roli (profil wołającego), nigdy z ładunku.
 *
 * Filtr najemcy powtarzamy przy WSZYSTKICH czterech odczytach, choć w trzech
 * dalszych zakres jest już przechodni (identyfikatory pochodzą z wiersza
 * zawężonego wyżej). Jawny filtr jest tańszą obroną niż rozumowanie
 * przechodnie: przetrwa refaktor, który zmieni źródło identyfikatora.
 */
export async function resendTicketOutcome(
  registrationId: string,
  tenantId: string,
): Promise<ResendOutcomeResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: registration, error } = await supabaseAdmin
    .from("event_registrations")
    .select("id, tenant_id, event_id, person_id, payment_status, payment_order_id")
    .eq("id", registrationId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`nie udało się odczytać zgłoszenia: ${error.message}`);
  // Zgłoszenie spoza najemcy wołającego ma dać DOKŁADNIE ten sam komunikat co
  // nieistniejące - inaczej różnica treści zamienia przycisk w wyrocznię
  // „czy ten UUID istnieje w systemie".
  if (!registration) throw new Error("Zgłoszenie nie istnieje.");

  const [{ data: person }, { data: event }, orderResult] = await Promise.all([
    supabaseAdmin
      .from("event_people")
      .select("user_id, email, phone, first_name")
      .eq("id", registration.person_id ?? "")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("events")
      .select("slug, title_pl, title_en")
      .eq("id", registration.event_id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    registration.payment_order_id
      ? supabaseAdmin
          .from("payment_orders")
          .select("amount_cents, refunded_amount_cents, currency")
          .eq("id", registration.payment_order_id)
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const order = (orderResult.data ?? null) as OrderRow | null;
  const outcome = resolveOutcome(registration.payment_status ?? null, order);

  const payload: TicketOutcomePayload = {
    applied: true,
    registration_id: registration.id,
    outcome,
    amount_cents: order?.amount_cents ?? null,
    refunded_cents: order?.refunded_amount_cents ?? null,
    currency: order?.currency ?? null,
    tenant_id: registration.tenant_id,
    event_id: registration.event_id,
    event_slug: event?.slug ?? null,
    event_title_pl: event?.title_pl ?? null,
    event_title_en: event?.title_en ?? null,
    contact: {
      user_id: person?.user_id ?? null,
      email: person?.email ?? null,
      phone: person?.phone ?? null,
      first_name: person?.first_name ?? null,
    },
    // Lista rezerwowa NIE rusza przy ponowieniu wiadomości - awans jest
    // skutkiem płatności, a tu nie zmieniamy niczyjego miejsca.
    waitlist: null,
  };

  const { notifyTicketOutcome } = await import("@/lib/events/registrationOutcomeNotify.server");
  const result = await notifyTicketOutcome(payload, {
    // Bez dopisku bramka idempotencji uznałaby powtórkę za duplikat webhooka
    // i cicho nic by nie wysłała - czyli przycisk nie robiłby nic.
    idempotencySuffix: `resend:${Date.now()}`,
  });

  return { ...result, registrationId: registration.id, outcome };
}
