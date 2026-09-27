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
// WPŁATA BEZ MIEJSCA (20260926180000). Opłacenie nie zawsze znaczy już
// „miejsce jest Twoje": baza może zostawić wpłatę w kolejce (pula wyczerpana
// między kasą a webhookiem), w oczekiwaniu na decyzję organizatora (bilet
// wymaga akceptacji) albo na zgłoszeniu zamkniętym (pieniądze do zwrotu).
// Szablon, SMS i dzwonek czytają to z `registration_status` - a organizator
// dostaje własny dzwonek, bo w każdym z tych trzech stanów to on ma ruch.
//
// Moduł server-only (klient service_role, token SMS).
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";
import { paidAdmission, type PaidAdmission } from "@/lib/events/paidAdmission";

/** Wyniki płatności, o których piszemy do uczestnika. */
export type TicketOutcome = "paid" | "unpaid" | "refunded" | "partial_refund";

/**
 * Szablon per wynik płatności. Odrzucona karta (`unpaid`) MUSI mieć swój wpis:
 * bez niego funkcja kończyła się w ciszy (`if (!type ...)`) i uczestnik jechał
 * na wydarzenie w przekonaniu, że ma opłacone miejsce.
 *
 * Typ zostaje `Partial`, bo klucz przychodzi z rzutowanego napisu RPC - ładunek
 * bez pola `outcome` albo z wynikiem, którego nie znamy, ma dalej trafiać
 * w bramkę `!type`, a nie w szablon wybrany na chybił trafił.
 */
const TYPE_BY_OUTCOME: Readonly<Partial<Record<TicketOutcome, TxEmailType>>> = {
  unpaid: "payment_failed",
  refunded: "event_ticket_refunded",
  partial_refund: "event_ticket_partially_refunded",
};

/**
 * Szablon wpłaty per skutek dla miejsca. `paid` celowo NIE stoi w
 * `TYPE_BY_OUTCOME`: jedno źródło prawdy, bo mail „bilet opłacony - miejsce
 * jest Twoje" do kogoś w kolejce to obietnica miejsca, którego nie ma.
 *
 * `closed` (wpłata na zgłoszenie odwołane albo odrzucone) NIE MA szablonu dla
 * kupującego - każdy istniejący mówiłby nieprawdę. Sprawę ma organizator:
 * dostaje dzwonek „do zwrotu".
 */
const PAID_TYPE: Readonly<Record<PaidAdmission, TxEmailType | null>> = {
  seated: "event_ticket_paid",
  waitlisted: "event_ticket_paid_waitlisted",
  awaitingDecision: "event_ticket_paid_pending",
  closed: null,
};

/**
 * Rodzaj wiadomości do uczestnika: wynik płatności, a dla wpłaty bez miejsca -
 * jej osobny wariant. Klucze idempotencji zostają przy samym WYNIKU
 * (`...:paid:0`), więc ponowiony webhook po awansie z kolejki nie dokłada
 * drugiej wiadomości o wpłacie.
 */
type NoticeKind = TicketOutcome | "paid_waitlisted" | "paid_pending";

function noticeKind(outcome: TicketOutcome, admission: PaidAdmission): NoticeKind {
  if (admission === "waitlisted") return "paid_waitlisted";
  if (admission === "awaitingDecision") return "paid_pending";
  return outcome;
}

/**
 * Tytuły dzwonka per rodzaj wiadomości, w obu językach - wiersz w bazie jest
 * jeden, a czyta go interfejs w języku sesji. Tabela zamiast ramion
 * ternary'ego: przy czwartym wyniku zagnieżdżenie przestawało być czytelne.
 */
const BELL_TITLES: Readonly<Record<NoticeKind, { pl: string; en: string }>> = {
  paid: { pl: "Bilet opłacony", en: "Ticket paid" },
  paid_waitlisted: {
    pl: "Opłacone - jesteś na liście rezerwowej",
    en: "Paid - you are on the waiting list",
  },
  paid_pending: {
    pl: "Opłacone - zgłoszenie czeka na decyzję",
    en: "Paid - awaiting the organiser's decision",
  },
  unpaid: { pl: "Płatność odrzucona - bilet nieopłacony", en: "Payment declined - ticket unpaid" },
  refunded: { pl: "Bilet anulowany - zwrot płatności", en: "Ticket cancelled - payment refunded" },
  partial_refund: { pl: "Częściowy zwrot za bilet", en: "Partial ticket refund" },
};

/** Treść SMS-a: tytuł wydarzenia i (dla kolejki) pozycja, gdy baza ją podała. */
interface SmsVars {
  title: string;
  position: number | null;
}

/**
 * Treści SMS-ów per rodzaj i język. BEZ OGONKÓW CELOWO: jeden znak spoza
 * GSM-7 przełącza całą wiadomość na UCS-2, połowi długość segmentu i podwaja
 * koszt wysyłki.
 */
const SMS_BODIES: Readonly<Record<NoticeKind, Record<EmailLang, (v: SmsVars) => string>>> = {
  paid: {
    pl: (v) => `Bilet oplacony: ${v.title}. Szczegoly wyslalismy mailem.`,
    en: (v) => `Ticket paid: ${v.title}. Details are in your inbox.`,
  },
  paid_waitlisted: {
    pl: (v) =>
      `Platnosc za ${v.title} przyjeta - brak wolnych miejsc, jestes na liscie rezerwowej${v.position === null ? "" : ` (miejsce ${v.position})`}. Bilet wyslemy, gdy zwolni sie miejsce.`,
    en: (v) =>
      `Payment for ${v.title} received - no seat is free yet, you are on the waiting list${v.position === null ? "" : ` (position ${v.position})`}. We will send your ticket when a seat opens up.`,
  },
  paid_pending: {
    pl: (v) =>
      `Platnosc za ${v.title} przyjeta - zgloszenie czeka na decyzje organizatora. Szczegoly w mailu.`,
    en: (v) =>
      `Payment for ${v.title} received - your registration awaits the organiser's decision. Details are in your inbox.`,
  },
  unpaid: {
    pl: (v) =>
      `Platnosc za bilet na ${v.title} nie przeszla - miejsce nie jest potwierdzone. Szczegoly w mailu.`,
    en: (v) =>
      `Payment for ${v.title} was declined - your seat is not confirmed. Details are in your inbox.`,
  },
  refunded: {
    pl: (v) => `Bilet na ${v.title} zostal anulowany, platnosc zwrocona. Szczegoly w mailu.`,
    en: (v) => `Your ticket for ${v.title} was cancelled and refunded. Details are in your inbox.`,
  },
  partial_refund: {
    pl: (v) => `Czesciowy zwrot za bilet na ${v.title}. Miejsce pozostaje zarezerwowane.`,
    en: (v) => `Partial refund issued for ${v.title}. Your seat stays reserved.`,
  },
};

/** Wpłata bez miejsca - stany, w których ruch ma organizator. */
type OrganizerAlertKind = Exclude<PaidAdmission, "seated">;

/** Treść dzwonka organizatora: tytuł wydarzenia i pozycja w kolejce. */
interface AlertVars {
  /** Tytuł z dwukropkiem albo pusty napis - wpis nie zaczyna się od „: ". */
  lead: string;
  position: number | null;
}

/**
 * Dzwonek organizatora per stan wpłaty bez miejsca. Oba języki w jednym
 * wierszu, jak dzwonek uczestnika.
 */
const ORGANIZER_ALERTS: Readonly<
  Record<
    OrganizerAlertKind,
    { title: { pl: string; en: string }; body: Record<EmailLang, (v: AlertVars) => string> }
  >
> = {
  waitlisted: {
    title: {
      pl: "Opłacone zgłoszenie na liście rezerwowej",
      en: "Paid registration on the waiting list",
    },
    body: {
      pl: (v) =>
        `${v.lead}wpłata przyszła po wyczerpaniu miejsc - zgłoszenie czeka opłacone${v.position === null ? "" : ` (pozycja ${v.position})`} i awansuje samo, gdy zwolni się miejsce. Możesz dostawić miejsce albo zwrócić płatność.`,
      en: (v) =>
        `${v.lead}the payment arrived after seats ran out - the registration waits paid${v.position === null ? "" : ` (position ${v.position})`} and moves up automatically when a seat frees up. You can add a seat or refund the payment.`,
    },
  },
  awaitingDecision: {
    title: {
      pl: "Opłacone zgłoszenie czeka na akceptację",
      en: "Paid registration awaits approval",
    },
    body: {
      pl: (v) =>
        `${v.lead}uczestnik zapłacił za bilet wymagający akceptacji - przyjmij albo odrzuć zgłoszenie (odmowa wymaga zwrotu płatności).`,
      en: (v) =>
        `${v.lead}the attendee paid for a ticket that needs approval - approve or decline (declining requires a refund).`,
    },
  },
  closed: {
    title: {
      pl: "Wpłata za zamknięte zgłoszenie - do zwrotu",
      en: "Payment for a closed registration - refund due",
    },
    body: {
      pl: (v) =>
        `${v.lead}wpłata dotarła do zgłoszenia odwołanego albo odrzuconego. Zwróć płatność w panelu płatności.`,
      en: (v) =>
        `${v.lead}a payment reached a cancelled or rejected registration. Refund it in the payments panel.`,
    },
  },
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
  /**
   * Status zgłoszenia PO zapisie (20260926180000). Dla `paid` mówi, czy wpłata
   * dała miejsce (`approved`), kolejkę (`waitlist`), oczekiwanie na decyzję
   * (`pending`/`draft`), czy trafiła na zgłoszenie zamknięte. Brak pola
   * (baza sprzed migracji) = dotychczasowe „miejsce jest Twoje".
   */
  registration_status?: string | null;
  /** Pozycja w kolejce, gdy zgłoszenie czeka na liście rezerwowej. */
  waitlist_position?: number | null;
  /**
   * `true` tylko przy PIERWSZYM zaksięgowaniu wpłaty na tym zgłoszeniu.
   * Ponowiony webhook dostaje `false` - i nie dokłada dzwonków.
   */
  newly_settled?: boolean;
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

/** Pozycja w kolejce z ładunku - wyłącznie liczba, nigdy „null" w treści. */
function waitlistPosition(payload: TicketOutcomePayload): number | null {
  return typeof payload.waitlist_position === "number" ? payload.waitlist_position : null;
}

function detailsFor(payload: TicketOutcomePayload, kind: NoticeKind, lang: EmailLang): TxDetail[] {
  const details: TxDetail[] = [];
  const title = eventTitle(payload, lang);
  if (title) details.push({ label: lang === "en" ? "Event" : "Wydarzenie", value: title });

  const paid = money(payload.amount_cents, payload.currency ?? null, lang);
  if (paid) details.push({ label: lang === "en" ? "Amount" : "Kwota", value: paid });

  // Kolejka: pozycja mówi kupującemu, ile osób jest przed nim - bez niej
  // „czekasz na liście rezerwowej" nie daje żadnej miary szansy.
  const position = kind === "paid_waitlisted" ? waitlistPosition(payload) : null;
  if (position !== null) {
    details.push({
      label: lang === "en" ? "Waiting list position" : "Miejsce w kolejce",
      value: String(position),
    });
  }

  // Wiersz zwrotu tylko tam, gdzie zwrot NAPRAWDĘ był. W mailu o opłaceniu
  // sugerowałby anulowanie, a w mailu o odrzuconej płatności byłby zdaniem
  // „zwrócono 0,00 zł" o pieniądzach, których nikt nie pobrał.
  if (kind === "refunded" || kind === "partial_refund") {
    const refunded = money(payload.refunded_cents ?? null, payload.currency ?? null, lang);
    if (refunded) {
      details.push({ label: lang === "en" ? "Refunded amount" : "Kwota zwrotu", value: refunded });
    }
  }
  return details;
}

function smsBody(payload: TicketOutcomePayload, kind: NoticeKind, lang: EmailLang): string {
  return SMS_BODIES[kind][lang]({
    title: eventTitle(payload, lang),
    position: waitlistPosition(payload),
  });
}

/** Dzwonek w aplikacji - tylko dla zalogowanego uczestnika. Nigdy nie rzuca. */
async function pushBell(
  payload: TicketOutcomePayload,
  kind: NoticeKind,
  contact: Contact,
): Promise<void> {
  const tenantId = payload.tenant_id ?? null;
  if (!contact.userId || !tenantId) return;
  const titles = BELL_TITLES[kind];
  try {
    // Przez `enqueue_notification`, nie surowym INSERT-em (D0-3): funkcja
    // bazowa bierze najemcę z PROFILU odbiorcy (nie z wydarzenia), pilnuje
    // deduplikacji i wysyła push. Rodzaj `billing` jest zawsze doręczany.
    // Ikona z listy kuratorskiej - `receipt` jej nie ma (leniwy rejestr 109 KB).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("enqueue_notification", {
      p_user_id: contact.userId,
      p_kind: "billing",
      p_title_pl: titles.pl,
      p_title_en: titles.en,
      p_body_pl: eventTitle(payload, "pl"),
      p_body_en: eventTitle(payload, "en"),
      p_href: payload.event_slug ? `/events/${payload.event_slug}` : "/profile/tickets",
      p_icon: "credit-card",
    });
    if (error) console.error("[events] ticket outcome bell failed", { error });
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
    // Awans to wiadomość o CUDZYM zgłoszeniu, więc preferencje kanałów czytamy
    // po JEGO identyfikatorze - dokładnie tak, jak dla płacącego niżej. Pilność
    // awansu nie jest tu wyjątkiem: ścieżka pieniężna, co najmniej równie pilna,
    // preferencje respektuje.
    const channels = await readChannels(registrationId);

    if (channels.email) {
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
    }

    if (channels.sms) {
      const { sendSms } = await import("@/lib/notify/sms.server");
      await sendSms({
        to: str(row, "phone"),
        body:
          lang === "en"
            ? `A seat opened up for ${title} - you are in. Details are in your inbox.`
            : `Zwolnilo sie miejsce na ${title} - jestes na liscie uczestnikow. Szczegoly w mailu.`,
        // Ten sam kontrakt co przy mailu o awansie: ponowione zdarzenie nie ma
        // prawa dołożyć drugiego SMS-a.
        idempotencyKey: `event-ticket-promoted-sms:${registrationId}`,
      });
    }
  }
  return sent;
}

/**
 * Dzwonek do organizatorów najemcy (admin i super_admin z `user_roles` - ta
 * sama bramka co `assert_event_admin_tenant`) o wpłacie bez miejsca. Poczty
 * organizatora nie ma w systemie, więc dzwonek jest jedynym kanałem; prowadzi
 * wprost na listę zgłoszeń, gdzie plakietka pokazuje wiersz. Każdy odbiorca
 * przez `enqueue_notification` (D0-3, jak dzwonek kupującego): najemca
 * z profilu, deduplikacja i push; rodzaj `billing` jest zawsze doręczany.
 * Nigdy nie rzuca - zwraca liczbę ZAKOLEJKOWANYCH wpisów.
 */
async function alertOrganizers(
  payload: TicketOutcomePayload,
  kind: OrganizerAlertKind,
): Promise<number> {
  const tenantId = payload.tenant_id ?? null;
  const eventId = payload.event_id ?? null;
  if (!tenantId || !eventId) return 0;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: admins, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .in("role", ["admin", "super_admin"]);
    if (rolesError) throw rolesError;
    // Ta sama osoba może mieć obie role - jeden wpis, nie dwa.
    const ids = [...new Set((admins ?? []).map((row) => row.user_id))];
    if (ids.length === 0) return 0;

    const copy = ORGANIZER_ALERTS[kind];
    const position = waitlistPosition(payload);
    const lead = (lang: EmailLang): string => {
      const title = eventTitle(payload, lang);
      return title ? `${title}: ` : "";
    };
    const results = await Promise.all(
      ids.map((userId) =>
        supabaseAdmin.rpc("enqueue_notification", {
          p_user_id: userId,
          p_kind: "billing",
          p_title_pl: copy.title.pl,
          p_title_en: copy.title.en,
          p_body_pl: copy.body.pl({ lead: lead("pl"), position }),
          p_body_en: copy.body.en({ lead: lead("en"), position }),
          p_href: `/admin/events/${eventId}/registration/list`,
          p_icon: "credit-card",
        }),
      ),
    );
    const errors = results.flatMap((result) => (result.error ? [result.error] : []));
    if (errors.length > 0) {
      console.error("[events] organizer alert failed", { error: errors[0] });
    }
    return results.length - errors.length;
  } catch (err) {
    console.error("[events] organizer alert failed", err);
    return 0;
  }
}

export interface OutcomeNotifyResult {
  emailed: boolean;
  smsSent: boolean;
  promotedNotified: number;
  /** Ilu organizatorów dostało dzwonek o wpłacie bez miejsca. */
  organizerAlerted: number;
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
async function readChannels(registrationId: string): Promise<Channels> {
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
  const result: OutcomeNotifyResult = {
    emailed: false,
    smsSent: false,
    promotedNotified: 0,
    organizerAlerted: 0,
  };
  if (payload.applied !== true) return result;

  const outcome = (payload.outcome ?? "") as TicketOutcome;
  // Skutek dla miejsca liczy się tylko przy wpłacie - zwrot i odrzucona karta
  // mają swoje szablony niezależnie od statusu zgłoszenia.
  const admission: PaidAdmission =
    outcome === "paid" ? paidAdmission(payload.registration_status) : "seated";
  const type = outcome === "paid" ? PAID_TYPE[admission] : TYPE_BY_OUTCOME[outcome];
  const kind = noticeKind(outcome, admission);
  const registrationId = payload.registration_id ?? null;
  const contact = readContact(payload);

  // Pełny zwrot zwalnia miejsce - kolejka rusza niezależnie od tego, czy sam
  // zwracający ma jeszcze adres w bazie.
  result.promotedNotified = await notifyPromoted(payload).catch((err) => {
    console.error("[events] waitlist promotion notify failed", err);
    return 0;
  });

  // Wpłata bez miejsca: ruch ma organizator. RAZ na wpłatę - ponowiony webhook
  // (`newly_settled: false`) i ładunek bez pola (panel, stara baza) nie
  // dokładają dzwonka.
  if (outcome === "paid" && admission !== "seated" && payload.newly_settled === true) {
    result.organizerAlerted = await alertOrganizers(payload, admission);
  }

  // `closed` nie ma szablonu (PAID_TYPE) - kupujący nie dostaje ani maila,
  // ani SMS-a, ani dzwonka, bo każdy z nich mówiłby nieprawdę.
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
        details: detailsFor(payload, kind, lang),
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
      const sms = await sendSms({
        to: contact.phone,
        body: smsBody(payload, kind, lang),
        // Klucz zbudowany tak samo jak pocztowy - z samego zdarzenia, więc
        // ponowiony webhook nie wysyła drugiego SMS-a, a dopisek z panelu
        // świadomie omija bramkę.
        idempotencyKey: `event-ticket-sms:${registrationId}:${outcome}:${payload.refunded_cents ?? 0}${suffix}`,
      });
      result.smsSent = sms.ok && !sms.skipped;
    } catch (err) {
      console.error("[events] ticket outcome sms failed", err);
    }
  }

  // Dzwonek nie ma klucza idempotencji jak poczta i SMS, więc ponowiony
  // webhook wpłaty (`newly_settled: false`) dokładałby kolejny wpis. Zwroty
  // dzwonią jak dotąd - każda transza to nowa informacja.
  if (!(outcome === "paid" && payload.newly_settled === false)) {
    await pushBell(payload, kind, contact);
  }
  return result;
}
