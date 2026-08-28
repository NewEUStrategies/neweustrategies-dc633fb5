// Automatyczne powiadomienia o statusie rejestracji na wydarzenie, wyzwalane
// WYNIKIEM WEBHOOKA operatora płatności - nie kliknięciem organizatora.
//
// DLACZEGO OSOBNY MODUŁ. `registrationNotify.functions` obsługuje decyzje
// człowieka (przyjęcie, odmowa) i wymaga roli redakcyjnej. Tutaj nadawcą jest
// maszyna: webhook Stripe przenosi wynik płatności na zgłoszenie
// (`payments_apply_event_ticket_outcome`), a uczestnik musi się o tym
// dowiedzieć natychmiast - także wtedy, gdy nikt z redakcji nie patrzy.
//
// ŹRÓDŁEM PRAWDY JEST WYNIK RPC, NIE WOŁAJĄCY. Funkcja bazowa zwraca komplet:
// status faktyczny (po przeliczeniu zwrotu częściowego na pełny), dane
// kontaktowe uczestnika, tytuł wydarzenia i listę osób awansowanych z rezerwy.
// Dzięki temu treść maila nie może się rozjechać z tym, co realnie zapisano.
//
// FAIL-SOFT. Pieniądze i miejsce są już zaksięgowane; brak powiadomienia to
// niedogodność, a wyjątek tutaj skazywałby webhook na wieczne ponowienia -
// czyli na wysyłanie tego samego maila w kółko.
//
// Moduł server-only (klient service_role, token SMS).
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";

/** Wyniki płatności, o których piszemy do uczestnika. */
export type TicketOutcome = "paid" | "unpaid" | "refunded" | "partial_refund";

const TYPE_BY_OUTCOME: Readonly<Partial<Record<TicketOutcome, TxEmailType>>> = {
  paid: "event_ticket_paid",
  refunded: "event_ticket_refunded",
  partial_refund: "event_ticket_partially_refunded",
};

interface Contact {
  userId: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
}

/** Kształt zwracany przez `payments_apply_event_ticket_outcome`. */
export interface TicketOutcomePayload {
  applied?: boolean;
  registration_id?: string;
  outcome?: string;
  refunded_cents?: number | null;
  amount_cents?: number | null;
  currency?: string | null;
  tenant_id?: string | null;
  event_id?: string | null;
  event_slug?: string | null;
  event_title_pl?: string | null;
  event_title_en?: string | null;
  contact?: Record<string, unknown> | null;
  waitlist?: { promoted?: number; registrations?: Array<Record<string, unknown>> } | null;
}

function str(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readContact(payload: TicketOutcomePayload): Contact {
  const raw = payload.contact ?? null;
  return {
    userId: str(raw, "user_id"),
    email: str(raw, "email"),
    phone: str(raw, "phone"),
    firstName: str(raw, "first_name"),
  };
}

/** Język odbiorcy: preferencja z profilu, a dla gościa bez konta - polski. */
async function resolveLang(userId: string | null): Promise<EmailLang> {
  if (!userId) return "pl";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveRecipient } = await import("@/lib/billing/notifications.server");
    const recipient = await resolveRecipient(supabaseAdmin, userId);
    return recipient?.lang ?? "pl";
  } catch {
    return "pl";
  }
}

function money(amountCents: number | null | undefined, currency: string | null, lang: EmailLang) {
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) return null;
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL", {
    style: "currency",
    currency: (currency ?? "PLN").toUpperCase(),
  }).format(amountCents / 100);
}

function eventTitle(payload: TicketOutcomePayload, lang: EmailLang): string {
  const pl = payload.event_title_pl ?? null;
  const en = payload.event_title_en ?? null;
  return (lang === "en" ? (en ?? pl) : (pl ?? en)) ?? "";
}

function detailsFor(
  payload: TicketOutcomePayload,
  outcome: TicketOutcome,
  lang: EmailLang,
): TxDetail[] {
  const details: TxDetail[] = [];
  const title = eventTitle(payload, lang);
  if (title) details.push({ label: lang === "en" ? "Event" : "Wydarzenie", value: title });

  const paid = money(payload.amount_cents, payload.currency ?? null, lang);
  if (paid) details.push({ label: lang === "en" ? "Amount" : "Kwota", value: paid });

  if (outcome !== "paid") {
    const refunded = money(payload.refunded_cents ?? null, payload.currency ?? null, lang);
    if (refunded) {
      details.push({ label: lang === "en" ? "Refunded amount" : "Kwota zwrotu", value: refunded });
    }
  }
  return details;
}

function smsBody(payload: TicketOutcomePayload, outcome: TicketOutcome, lang: EmailLang): string {
  const title = eventTitle(payload, lang);
  if (lang === "en") {
    if (outcome === "paid") return `Ticket paid: ${title}. Details are in your inbox.`;
    if (outcome === "refunded") {
      return `Your ticket for ${title} was cancelled and refunded. Details are in your inbox.`;
    }
    return `Partial refund issued for ${title}. Your seat stays reserved.`;
  }
  if (outcome === "paid") return `Bilet oplacony: ${title}. Szczegoly wyslalismy mailem.`;
  if (outcome === "refunded") {
    return `Bilet na ${title} zostal anulowany, platnosc zwrocona. Szczegoly w mailu.`;
  }
  return `Czesciowy zwrot za bilet na ${title}. Miejsce pozostaje zarezerwowane.`;
}

/** Dzwonek w aplikacji - tylko dla zalogowanego uczestnika. Nigdy nie rzuca. */
async function pushBell(
  payload: TicketOutcomePayload,
  outcome: TicketOutcome,
  contact: Contact,
): Promise<void> {
  const tenantId = payload.tenant_id ?? null;
  if (!contact.userId || !tenantId) return;
  const titlePl =
    outcome === "paid"
      ? "Bilet opłacony"
      : outcome === "refunded"
        ? "Bilet anulowany - zwrot płatności"
        : "Częściowy zwrot za bilet";
  const titleEn =
    outcome === "paid"
      ? "Ticket paid"
      : outcome === "refunded"
        ? "Ticket cancelled - payment refunded"
        : "Partial ticket refund";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("notifications").insert({
      user_id: contact.userId,
      tenant_id: tenantId,
      kind: "billing",
      title_pl: titlePl,
      title_en: titleEn,
      body_pl: eventTitle(payload, "pl"),
      body_en: eventTitle(payload, "en"),
      href: payload.event_slug ? `/events/${payload.event_slug}` : "/profile/tickets",
      icon: "receipt",
    });
  } catch (err) {
    console.error("[events] ticket outcome bell failed", err);
  }
}

/** Mail do osób, które właśnie weszły z listy rezerwowej na zwolnione miejsce. */
async function notifyPromoted(payload: TicketOutcomePayload): Promise<number> {
  const rows = payload.waitlist?.registrations ?? [];
  if (rows.length === 0) return 0;

  const { sendTxEmail } = await import("@/lib/email/transactional.server");
  let sent = 0;
  for (const row of rows) {
    const email = str(row, "email");
    const registrationId = str(row, "registration_id");
    if (!email || !registrationId) continue;
    const lang = await resolveLang(str(row, "user_id"));
    const title = eventTitle(payload, lang);
    const result = await sendTxEmail({
      type: "event_waitlist_promoted",
      to: email,
      lang,
      subjectName: title,
      details: title ? [{ label: lang === "en" ? "Event" : "Wydarzenie", value: title }] : [],
      ctaPath: payload.event_slug ? `/events/${payload.event_slug}` : "/events",
      metaName: str(row, "first_name"),
      tenantId: payload.tenant_id ?? null,
      // Awans jest jednorazowy per zgłoszenie - klucz trzyma ten kontrakt nawet
      // przy ponowieniu tego samego zdarzenia przez operatora.
      idempotencyKey: `event-ticket-promoted:${registrationId}`,
    });
    if (result.ok && !result.skipped) sent += 1;

    const { sendSms } = await import("@/lib/notify/sms.server");
    await sendSms({
      to: str(row, "phone"),
      body:
        lang === "en"
          ? `A seat opened up for ${title} - you are in. Details are in your inbox.`
          : `Zwolnilo sie miejsce na ${title} - jestes na liscie uczestnikow. Szczegoly w mailu.`,
    });
  }
  return sent;
}

export interface OutcomeNotifyResult {
  emailed: boolean;
  smsSent: boolean;
  promotedNotified: number;
}

/** Kanały wybrane przez uczestnika na TYM zgłoszeniu (domyślnie oba włączone). */
interface Channels {
  email: boolean;
  sms: boolean;
}

/**
 * Centrum preferencji komunikacji jest PER ZGŁOSZENIE, nie per konto: na jedno
 * wydarzenie zapisuje się też gość bez konta, a osoba z kontem może chcieć
 * SMS-a o kongresie i ciszy o webinarze. Odczyt jest fail-soft - brak wiersza
 * albo błąd bazy nie może wyciszyć powiadomienia o pieniądzach.
 */
async function readChannels(registrationId: string | null): Promise<Channels> {
  if (!registrationId) return { email: true, sms: true };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("event_registrations")
      .select("notify_email, notify_sms")
      .eq("id", registrationId)
      .maybeSingle();
    return {
      email: data?.notify_email !== false,
      sms: data?.notify_sms !== false,
    };
  } catch (err) {
    console.error("[events] channel preferences read failed", err);
    return { email: true, sms: true };
  }
}

export interface NotifyOptions {
  /**
   * Dopisek do klucza idempotencji. Ponowna wysyłka z panelu MUSI ominąć
   * bramkę powtórzeń - to jest jej jedyny sens - a webhook nadal nie może
   * wysłać tej samej wiadomości dwa razy.
   */
  idempotencySuffix?: string;
}

/**
 * Rozsyła powiadomienia po przeniesieniu wyniku płatności na zgłoszenie.
 * Wołane wyłącznie przez `applyTicketOutcome`, żeby istniała jedna ścieżka
 * „skutek płatności -> uczestnik" dla webhooka i dla panelu.
 */
export async function notifyTicketOutcome(
  payload: TicketOutcomePayload,
  options: NotifyOptions = {},
): Promise<OutcomeNotifyResult> {
  const result: OutcomeNotifyResult = { emailed: false, smsSent: false, promotedNotified: 0 };
  if (payload.applied !== true) return result;

  const outcome = (payload.outcome ?? "") as TicketOutcome;
  const type = TYPE_BY_OUTCOME[outcome];
  const registrationId = payload.registration_id ?? null;
  const contact = readContact(payload);

  // Pełny zwrot zwalnia miejsce - kolejka rusza niezależnie od tego, czy sam
  // zwracający ma jeszcze adres w bazie.
  result.promotedNotified = await notifyPromoted(payload).catch((err) => {
    console.error("[events] waitlist promotion notify failed", err);
    return 0;
  });

  if (!type || !registrationId) return result;

  const lang = await resolveLang(contact.userId);
  const channels = await readChannels(registrationId);
  const suffix = options.idempotencySuffix ? `:${options.idempotencySuffix}` : "";

  if (contact.email && channels.email) {
    try {
      const { sendTxEmail } = await import("@/lib/email/transactional.server");
      const sendResult = await sendTxEmail({
        type,
        to: contact.email,
        lang,
        subjectName: eventTitle(payload, lang),
        details: detailsFor(payload, outcome, lang),
        ctaPath: payload.event_slug ? `/events/${payload.event_slug}` : "/events",
        metaName: contact.firstName,
        tenantId: payload.tenant_id ?? null,
        // Kwota zwrotu wchodzi do klucza: korekta o kolejne 50 zł to NOWA
        // informacja, a ten sam webhook dostarczony dwa razy - nie.
        idempotencyKey: `event-ticket:${registrationId}:${outcome}:${payload.refunded_cents ?? 0}${suffix}`,
      });
      result.emailed = sendResult.ok && !sendResult.skipped;
    } catch (err) {
      console.error("[events] ticket outcome email failed", err);
    }
  }

  if (contact.phone && channels.sms) {
    try {
      const { sendSms } = await import("@/lib/notify/sms.server");
      const sms = await sendSms({ to: contact.phone, body: smsBody(payload, outcome, lang) });
      result.smsSent = sms.ok && !sms.skipped;
    } catch (err) {
      console.error("[events] ticket outcome sms failed", err);
    }
  }

  await pushBell(payload, outcome, contact);
  return result;
}
