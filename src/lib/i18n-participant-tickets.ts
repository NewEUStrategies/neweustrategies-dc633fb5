// i18n panelu uczestnika (moje zgłoszenia) oraz zdrowia webhooków w panelu
// admina. Jeden moduł, bo obie powierzchnie mówią o tym samym zdarzeniu:
// wyniku płatności przeniesionym na zgłoszenie.
import i18n from "@/lib/i18n";

export const participantTicketsPl = {
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
      // Gość grupy: płaci osoba zapisująca grupę (kwoty zamówienia nie pokazujemy).
      paidByGroup: "Opłacone przez osobę zapisującą grupę",
      amount: "Kwota",
      refundedAmount: "Kwota zwrotu",
    },
    // Stan zwrotu zamkniętego zgłoszenia (przegląd R45) - także po odwołaniu
    // całego wydarzenia przez organizatora.
    refundState: {
      queued: "Zwrot został zlecony - pieniądze wrócą na kartę lub konto, z którego zapłacono.",
      processing: "Zwrot jest realizowany przez operatora płatności.",
      review: "Organizator rozpatruje zwrot - dostaniesz informację o decyzji.",
      refunded: "Zwrot został wykonany.",
      declined: "Organizator nie zlecił zwrotu dla tego zgłoszenia.",
    },
    waitlistPosition: "Pozycja na liście rezerwowej: {{position}}",
    reason: {
      title: "Powód anulowania / zwrotu",
      cancelled: "Zgłoszenie anulowane {{date}}.",
      refunded: "Płatność zwrócona w całości - miejsce zostało zwolnione.",
      partial: "Zwrócono część kwoty - miejsce pozostaje zarezerwowane.",
      none: "Brak anulowania i zwrotu dla tego zgłoszenia.",
      // REG-06: WYŁĄCZNIE powód napisany dla uczestnika (`participant_reason`),
      // nigdy wewnętrzna notatka organizatora.
      participantReason: "Powód podany przez organizatora: {{reason}}",
      source: "Źródło decyzji: {{source}}",
    },
    channels: {
      title: "Powiadomienia o tym zgłoszeniu",
      hint: "Wiadomości krytyczne dla wejścia (potwierdzenie i kod QR) wysyłamy zawsze mailem, o ile masz e-mail włączony. Wyłączenie e-maila wycisza też przypomnienia mailowe.",
      email: "E-mail",
      sms: "SMS",
      saved: "Preferencje zapisane.",
      failed: "Nie udało się zapisać preferencji.",
      smsUnavailable: "SMS-y nie są obecnie wysyłane na tej platformie.",
      smsConsent: {
        title: "Zgoda na SMS-y",
        body: "Zgadzam się na SMS-y o tym zgłoszeniu (płatność, zmiany statusu, przypomnienia) na numer kończący się na {{hint}}. Zgodę wycofasz, wyłączając SMS.",
        bodyNoHint:
          "Zgadzam się na SMS-y o tym zgłoszeniu (płatność, zmiany statusu, przypomnienia) na numer podany w zgłoszeniu. Zgodę wycofasz, wyłączając SMS.",
        confirm: "Zgadzam się",
        cancel: "Anuluj",
      },
      // Odmowy `event_registration_set_channels` (REG-10). Bez interpolacji -
      // bramka `eventErrorMapsI18n.gate.test.ts`.
      errors: {
        smsConsentRequired: "Włączenie SMS-ów wymaga Twojej zgody.",
        phoneRequired: "Zgłoszenie nie ma numeru telefonu - SMS-ów nie ma dokąd wysłać.",
        manageExpired:
          "Link do zgłoszenia wygasł wraz z końcem wydarzenia - powiadomienia można już tylko wyłączyć.",
        alreadyClosed: "Zgłoszenie jest już zamknięte - powiadomienia można już tylko wyłączyć.",
        phoneChanged:
          "Numer telefonu w zgłoszeniu zmienił się, gdy okno zgody było otwarte. Odśwież stronę i sprawdź numer przed zgodą.",
        notFound: "Nie znaleźliśmy tego zgłoszenia.",
        authRequired: "Zaloguj się albo otwórz link z maila, aby zmienić powiadomienia.",
        invalidPayload: "Nie udało się zapisać tej zmiany. Odśwież stronę i spróbuj ponownie.",
        invalidTenant: "Nie rozpoznaliśmy tej strony. Odśwież ją i spróbuj ponownie.",
        unknown: "Nie udało się zapisać preferencji.",
      },
    },
    reminders: {
      title: "Przypomnienia o wydarzeniu",
      lead: "Wybierz, jak mamy przypominać o tym wydarzeniu i o sesjach z Twojego planu.",
      show: "Pokaż przypomnienia",
      hide: "Ukryj przypomnienia",
      loadError: "Nie udało się wczytać przypomnień.",
      unavailable: "Ustawienia przypomnień są chwilowo niedostępne.",
      expired: "Wydarzenie się zakończyło - przypomnienia nie są już wysyłane.",
      organizerOff: "Organizator wyłączył przypomnienia dla tego wydarzenia.",
      closed: "Zgłoszenie jest zamknięte - przypomnienia nie są wysyłane.",
      email: "Przypomnienia e-mailem",
      emailOff:
        "E-mail jest wyłączony dla tego zgłoszenia - włącz go w powiadomieniach, aby dostawać przypomnienia.",
      push: "Powiadomienia w aplikacji",
      sms: "Przypomnienia SMS-em",
      smsHint: "Włączenie wymaga zgody na SMS-y o tym zgłoszeniu.",
      smsNoPhone: "Zgłoszenie nie ma numeru telefonu.",
      sessions: "Przypomnienia o sesjach z mojego planu",
      saved: "Przypomnienia zapisane.",
    },
    // Przegląd R67: zgłoszenie zamknięte albo link po końcu wydarzenia - zgodę
    // na SMS i e-maile da się już tylko WYCOFAĆ (baza odmawia włączenia).
    withdraw: {
      title: "Wyłącz powiadomienia o tym zgłoszeniu",
      closedBody:
        "Zgłoszenie jest zamknięte. Możesz w każdej chwili wyłączyć SMS-y i e-maile o nim - włączyć ich stąd już się nie da.",
      expiredBody:
        "Wydarzenie się zakończyło. Możesz w każdej chwili wyłączyć SMS-y i e-maile o tym zgłoszeniu - włączyć ich stąd już się nie da.",
      smsOff: "Wyłącz SMS-y",
      emailOff: "Wyłącz e-maile",
      smsDone: "SMS-y o tym zgłoszeniu są wyłączone - zgoda wycofana.",
      emailDone: "E-maile o tym zgłoszeniu są wyłączone.",
      saved: "Powiadomienia wyłączone.",
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

export const participantTicketsEn = {
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
      paidByGroup: "Paid by the person who registered the group",
      amount: "Amount",
      refundedAmount: "Refunded amount",
    },
    refundState: {
      queued:
        "The refund has been ordered - the money will return to the card or account you paid from.",
      processing: "The payment provider is processing the refund.",
      review: "The organiser is reviewing the refund - you will be told about the decision.",
      refunded: "The refund has been completed.",
      declined: "The organiser did not order a refund for this registration.",
    },
    waitlistPosition: "Waiting list position: {{position}}",
    reason: {
      title: "Cancellation / refund reason",
      cancelled: "Registration cancelled on {{date}}.",
      refunded: "Payment fully refunded - the seat was released.",
      partial: "Part of the amount was refunded - your seat stays reserved.",
      none: "No cancellation or refund for this registration.",
      participantReason: "Reason given by the organiser: {{reason}}",
      source: "Decision source: {{source}}",
    },
    channels: {
      title: "Notifications for this registration",
      hint: "Entry-critical messages (confirmation and QR code) are always sent by email while email stays enabled. Turning email off also silences email reminders.",
      email: "Email",
      sms: "SMS",
      saved: "Preferences saved.",
      failed: "Could not save preferences.",
      smsUnavailable: "Text messages are not sent on this platform at the moment.",
      smsConsent: {
        title: "Consent to text messages",
        body: "I agree to receive text messages about this registration (payment, status changes, reminders) at the number ending in {{hint}}. You can withdraw consent by turning SMS off.",
        bodyNoHint:
          "I agree to receive text messages about this registration (payment, status changes, reminders) at the number given in the registration. You can withdraw consent by turning SMS off.",
        confirm: "I agree",
        cancel: "Cancel",
      },
      errors: {
        smsConsentRequired: "Turning text messages on requires your consent.",
        phoneRequired: "This registration has no phone number - there is nowhere to send texts.",
        manageExpired:
          "The registration link expired when the event ended - notifications can now only be turned off.",
        alreadyClosed: "This registration is closed - notifications can now only be turned off.",
        phoneChanged:
          "The phone number in this registration changed while the consent window was open. Refresh the page and check the number before agreeing.",
        notFound: "We could not find this registration.",
        authRequired: "Sign in or open the link from your email to change notifications.",
        invalidPayload: "We could not save this change. Refresh the page and try again.",
        invalidTenant: "We did not recognise this site. Refresh the page and try again.",
        unknown: "Could not save preferences.",
      },
    },
    reminders: {
      title: "Event reminders",
      lead: "Choose how we remind you about this event and about the sessions in your plan.",
      show: "Show reminders",
      hide: "Hide reminders",
      loadError: "Could not load reminders.",
      unavailable: "Reminder settings are temporarily unavailable.",
      expired: "The event has ended - reminders are no longer sent.",
      organizerOff: "The organiser turned reminders off for this event.",
      closed: "This registration is closed - reminders are not sent.",
      email: "Email reminders",
      emailOff:
        "Email is off for this registration - turn it on in notifications to receive reminders.",
      push: "In-app notifications",
      sms: "Text message reminders",
      smsHint: "Turning this on requires consent to text messages about this registration.",
      smsNoPhone: "This registration has no phone number.",
      sessions: "Reminders about sessions in my plan",
      saved: "Reminders saved.",
    },
    withdraw: {
      title: "Turn off notifications about this registration",
      closedBody:
        "This registration is closed. You can turn off text messages and emails about it at any time - they can no longer be turned on here.",
      expiredBody:
        "The event has ended. You can turn off text messages and emails about this registration at any time - they can no longer be turned on here.",
      smsOff: "Turn off text messages",
      emailOff: "Turn off emails",
      smsDone: "Text messages about this registration are off - consent withdrawn.",
      emailDone: "Emails about this registration are off.",
      saved: "Notifications turned off.",
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
  i18n.addResourceBundle("pl", "translation", participantTicketsPl, true, true);
  i18n.addResourceBundle("en", "translation", participantTicketsEn, true, true);
}

ensureI18n();
