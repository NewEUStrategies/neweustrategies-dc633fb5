// i18n panelu uczestnika (moje zgłoszenia) oraz zdrowia webhooków w panelu
// admina. Jeden moduł, bo obie powierzchnie mówią o tym samym zdarzeniu:
// wyniku płatności przeniesionym na zgłoszenie.
import i18n from "@/lib/i18n";

const pl = {
  participantTickets: {
    title: "Moje zgłoszenia",
    lead: "Status każdego zapisu na wydarzenie, historia zdarzeń płatności oraz powód anulowania lub zwrotu. Tu też decydujesz, czy o zmianach mamy pisać mailem, SMS-em, czy wcale.",
    empty: "Nie masz jeszcze żadnego zgłoszenia na wydarzenie.",
    loadError: "Nie udało się wczytać zgłoszeń. Odśwież stronę.",
    status: {
      label: "Status zgłoszenia",
      approved: "Potwierdzone",
      pending: "Czeka na decyzję",
      waitlist: "Lista rezerwowa",
      cancelled: "Anulowane",
      rejected: "Odrzucone",
      unknown: "Nieznany",
    },
    payment: {
      label: "Płatność",
      paid: "Opłacone",
      unpaid: "Nieopłacone",
      refunded: "Zwrócone",
      partial: "Zwrot częściowy",
      free: "Bezpłatne",
      amount: "Kwota",
      refundedAmount: "Kwota zwrotu",
    },
    waitlistPosition: "Pozycja na liście rezerwowej: {{position}}",
    reason: {
      title: "Powód anulowania / zwrotu",
      cancelled: "Zgłoszenie anulowane {{date}}.",
      refunded: "Płatność zwrócona w całości - miejsce zostało zwolnione.",
      partial: "Zwrócono część kwoty - miejsce pozostaje zarezerwowane.",
      none: "Brak anulowania i zwrotu dla tego zgłoszenia.",
      note: "Notatka organizatora: {{note}}",
      source: "Źródło decyzji: {{source}}",
    },
    channels: {
      title: "Powiadomienia o tym zgłoszeniu",
      hint: "Wiadomości krytyczne dla wejścia (potwierdzenie i kod QR) wysyłamy zawsze mailem, o ile masz e-mail włączony.",
      email: "E-mail",
      sms: "SMS",
      saved: "Preferencje zapisane.",
      failed: "Nie udało się zapisać preferencji.",
    },
    webhooks: {
      title: "Historia zdarzeń płatności",
      empty: "Brak zdarzeń operatora płatności dla tego zgłoszenia.",
      occurred: "Czas",
      type: "Typ",
      status: "Status",
      retries: "Ponowienia",
    },
    openEvent: "Strona wydarzenia",
  },
  webhookHealth: {
    title: "Zdrowie webhooków",
    lead: "Opóźnienia, błędy i ponowienia zdarzeń operatora płatności w wybranym oknie czasowym.",
    load: "Odśwież",
    total: "Zdarzenia",
    processed: "Przetworzone",
    skipped: "Pominięte",
    failed: "Nieudane",
    pending: "W toku",
    retries: "Ponowienia",
    failureRate: "Odsetek niepowodzeń",
    avgDuration: "Średni czas obsługi",
    p95Duration: "95. percentyl czasu",
    avgLag: "Średnie opóźnienie",
    byType: "Rozbicie po typach",
    recentFailures: "Ostatnie niepowodzenia",
    noFailures: "Brak niepowodzeń w tym oknie - nic nie wymaga uwagi.",
    alertHigh:
      "Odsetek niepowodzeń przekracza 5% ({{rate}}) - sprawdź ostatnie błędy i ponów zdarzenia.",
    alertWarn: "Odsetek niepowodzeń rośnie ({{rate}}) - obserwuj kolejne zdarzenia.",
    alertOk: "Wskaźniki w normie.",
    resend: "Wyślij powiadomienia ponownie",
    resending: "Wysyłam...",
    resendHint:
      "Ponowna wysyłka maila i SMS-a o aktualnym statusie zgłoszenia. Nie zmienia statusu płatności ani miejsca.",
    resendOk: "Wysłano ponownie (e-mail: {{email}}, SMS: {{sms}}).",
    resendFailed: "Ponowna wysyłka nie powiodła się: {{error}}",
    registrationId: "Identyfikator zgłoszenia (UUID)",
  },
};

const en = {
  participantTickets: {
    title: "My registrations",
    lead: "Status of every event registration, the payment event history, and the exact reason for a cancellation or refund. You also decide here whether we write by email, SMS, or not at all.",
    empty: "You have no event registrations yet.",
    loadError: "Could not load your registrations. Refresh the page.",
    status: {
      label: "Registration status",
      approved: "Confirmed",
      pending: "Awaiting decision",
      waitlist: "Waiting list",
      cancelled: "Cancelled",
      rejected: "Rejected",
      unknown: "Unknown",
    },
    payment: {
      label: "Payment",
      paid: "Paid",
      unpaid: "Unpaid",
      refunded: "Refunded",
      partial: "Partially refunded",
      free: "Free",
      amount: "Amount",
      refundedAmount: "Refunded amount",
    },
    waitlistPosition: "Waiting list position: {{position}}",
    reason: {
      title: "Cancellation / refund reason",
      cancelled: "Registration cancelled on {{date}}.",
      refunded: "Payment fully refunded - the seat was released.",
      partial: "Part of the amount was refunded - your seat stays reserved.",
      none: "No cancellation or refund for this registration.",
      note: "Organiser note: {{note}}",
      source: "Decision source: {{source}}",
    },
    channels: {
      title: "Notifications for this registration",
      hint: "Entry-critical messages (confirmation and QR code) are always sent by email while email stays enabled.",
      email: "Email",
      sms: "SMS",
      saved: "Preferences saved.",
      failed: "Could not save preferences.",
    },
    webhooks: {
      title: "Payment event history",
      empty: "No payment provider events for this registration.",
      occurred: "Time",
      type: "Type",
      status: "Status",
      retries: "Retries",
    },
    openEvent: "Event page",
  },
  webhookHealth: {
    title: "Webhook health",
    lead: "Latency, errors and retries of payment provider events in the selected window.",
    load: "Refresh",
    total: "Events",
    processed: "Processed",
    skipped: "Skipped",
    failed: "Failed",
    pending: "In flight",
    retries: "Retries",
    failureRate: "Failure rate",
    avgDuration: "Average handling time",
    p95Duration: "95th percentile time",
    avgLag: "Average lag",
    byType: "Breakdown by type",
    recentFailures: "Recent failures",
    noFailures: "No failures in this window - nothing needs attention.",
    alertHigh: "Failure rate is above 5% ({{rate}}) - review recent errors and retry the events.",
    alertWarn: "Failure rate is rising ({{rate}}) - keep an eye on the next events.",
    alertOk: "All metrics within range.",
    resend: "Resend notifications",
    resending: "Sending...",
    resendHint:
      "Resends the email and SMS about the current registration status. It never changes the payment status or the seat.",
    resendOk: "Resent (email: {{email}}, SMS: {{sms}}).",
    resendFailed: "Resend failed: {{error}}",
    registrationId: "Registration id (UUID)",
  },
};

let registered = false;

/** Rejestruje słownik w chunku trasy, nie w entry aplikacji. */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}

ensureI18n();
