// Nakładka i18n PANELU USTAWIEŃ UCZESTNIKA w studiu wydarzenia
// (`adminEventParticipant.*`).
//
// WŁAŚCICIEL: Foundation. Dwa ekrany studia czytają stąd: „Komunikacja"
// (przypomnienia, eksport do kalendarza, dziennik doręczeń) i „Zasady
// biletów" (przekazanie, zwrot, oferty z listy rezerwowej). Ekrany toru C
// (certyfikat, ankieta) mają własną nakładkę `adminEventFollowUp`.
//
// KAŻDY LIŚĆ MA W KODZIE PEŁNY LITERAŁ, nie sklejanie: `LEAD_PRESET_LABEL_KEYS`,
// `PARTICIPANT_SETTINGS_ERROR_KEYS` (`participantSettingsDraft.ts`) oraz
// `DELIVERY_KIND|CHANNEL|STATUS_LABEL_KEYS` (`participantDeliveryKinds.ts`)
// wskazują gałęzie `communications.leads`, `errors` i `deliveries`. Bramka
// `eventsI18nKeys` ma korzeń `adminEventParticipant` w `REFERENCE_PREFIXES`,
// więc literał bez wpisu tutaj czerwieni CI.
//
// ODMOWY BAZY (`invalid_*`, `forbidden`, `not_found`) NIE STOJĄ TUTAJ - te
// zdania czyta mapa studia (`adminEvents.studio.errors.*`), bo RPC ustawień
// odpowiada tym samym słownikiem kodów co reszta studia. Gałąź `errors` niżej
// to komunikaty WALIDACJI FORMULARZA, zanim cokolwiek poleci do bazy.
//
// ZNACZNIK CZYSTOŚCI CHUNKA STARTOWEGO (`scripts/check-entry-purity.ts`):
// zdanie `policies.refund.rule` (PL). Nakładka jedzie wyłącznie w chunku
// panelu administracyjnego.
import i18n from "@/lib/i18n";

export const adminEventParticipantPl = {
  adminEventParticipant: {
    loadError: "Nie udało się wczytać ustawień uczestników.",
    retry: "Spróbuj ponownie",
    communications: {
      description: "Przypomnienia, eksport do kalendarza i dziennik wysłanych wiadomości.",
      reminders: {
        title: "Przypomnienia",
        description:
          "Uczestnik z aktywnym zgłoszeniem dostaje e-mail i powiadomienie; kanały wybiera sam.",
        enabled: "Wysyłaj przypomnienia",
        enabledHint: "Wyłączenie wstrzymuje też przypomnienia o sesjach.",
        leadsLegend: "Kiedy przypominać",
        leadsHint: "Wybierz od 1 do 4 terminów przed startem.",
        leadsLimit: "Wybrano 4 terminy - odznacz jeden, aby zmienić.",
        sessionEnabled: "Przypomnienia o sesjach z planu",
        sessionEnabledHint: "Dla sesji zapisanych lub oznaczonych przez osoby z kontem.",
        sessionLead: "Wyprzedzenie przed sesją",
        sessionLeadHint: "Tyle minut przed początkiem sesji.",
        sessionLeadOption: "{{minutes}} min przed",
        sms: "Przypomnienia SMS",
        smsHint:
          "Tylko dla uczestników, którzy sami włączyli SMS i podali numer. Dzienny limit na organizację.",
        smsUnavailable: "SMS-y nie są włączone na platformie (brak operatora SMS).",
      },
      leads: {
        p10080: "7 dni przed",
        p4320: "3 dni przed",
        p1440: "24 godziny przed",
        p720: "12 godzin przed",
        p180: "3 godziny przed",
        p60: "1 godzina przed",
        p30: "30 minut przed",
        p15: "15 minut przed",
        custom: "{{minutes}} min przed",
      },
      calendar: {
        title: "Kalendarz",
        description: "Dodawanie wydarzenia i planu do Google, Outlooka, Microsoft 365 i Apple.",
        enabled: "Pozwalaj eksportować do kalendarza",
        enabledHint: "Wyłączenie chowa przyciski kalendarza.",
      },
      deliveries: {
        title: "Dziennik doręczeń",
        description: "Wysłane, pominięte i nieudane wiadomości według rodzaju i kanału.",
        caption: "Doręczenia wiadomości wydarzenia",
        empty: "Nie wysłano jeszcze żadnej wiadomości.",
        loadError: "Nie udało się wczytać dziennika.",
        lastSent: "Ostatnia wysyłka: {{date}}",
        columns: {
          kind: "Wiadomość",
          channel: "Kanał",
        },
      },
    },
    policies: {
      description: "Przekazanie, zwrot i oferty z listy rezerwowej dla kupionych biletów.",
      transfer: {
        title: "Przekazanie biletu",
        description: "Nowy posiadacz dostaje własny kod wejścia, stary przestaje działać.",
        enabled: "Pozwalaj przekazywać bilety",
        enabledHint: "Nie dotyczy biletów grupowych i miejsc z pakietów.",
        deadline: "Do ilu godzin przed startem",
        deadlineHint: "0 = do rozpoczęcia wydarzenia.",
      },
      refund: {
        title: "Zwrot za bilet",
        description: "Płacący może sam zwrócić bilet przed terminem, jeśli go nie przekazał.",
        modeLegend: "Zasada zwrotu",
        modes: {
          policy: "Zwrot do terminu",
          policyHint: "Pełny zwrot bez opłat do terminu poniżej.",
          none: "Bez samodzielnego zwrotu",
          noneHint: "O wyjątkach decyduje organizator.",
        },
        deadline: "Koniec zwrotów (godziny przed startem)",
        deadlineHint: "Domyślnie 168 godzin.",
        rule: "Termin zwrotu to wcześniejsza chwila: start minus te godziny albo 30 dni od zapłaty.",
        snapshot:
          "Zasada zapisuje się przy bilecie w chwili zapłaty - późniejsza zmiana nie skraca praw kupujących.",
        favourable:
          "Po zmianie na korzystniejszą albo przesunięciu wydarzenia obowiązuje korzystniejszy termin; odwołanie wydarzenia zawsze pozwala na zwrot.",
        noneWarning: "Brak zwrotu wymaga zgodnego zapisu w regulaminie wydarzenia.",
      },
      waitlist: {
        title: "Oferty z listy rezerwowej",
        description:
          "Zwolnione płatne miejsce trafia z ofertą do pierwszej osoby z listy, potem do następnej.",
        hours: "Czas na opłacenie oferty (godziny)",
        hoursHint: "Od 2 do 168, domyślnie 24.",
        ticketNote: "Listę rezerwową włączasz dla każdego biletu w sekcji Bilety.",
      },
    },
    deliveries: {
      kind: {
        eventReminder: "Przypomnienie o wydarzeniu",
        sessionReminder: "Przypomnienie o sesji",
        waitlistOffer: "Oferta z listy rezerwowej",
        waitlistOfferExpired: "Oferta wygasła",
        waitlistOfferRefunded: "Zwrot za spóźnioną płatność",
        waitlistJoined: "Zapis na listę rezerwową",
        transferOffer: "Przekazanie - zaproszenie",
        transferCompleted: "Przekazanie - zakończone",
        transferRevoked: "Przekazanie - wycofane",
        surveyInvite: "Zaproszenie do ankiety",
        certificateReady: "Certyfikat gotowy",
      },
      channel: {
        email: "E-mail",
        sms: "Wiadomość SMS",
        inapp: "W aplikacji",
      },
      status: {
        claimed: "W kolejce",
        sent: "Wysłane",
        skipped: "Pominięte",
        failed: "Nieudane",
      },
    },
    errors: {
      reminderLeads: "Wybierz najwyżej 4 różne terminy.",
      sessionLead: "Podaj od 5 do 240 minut.",
      transferDeadline: "Podaj od 0 do 720 godzin.",
      refundDeadline: "Podaj od 0 do 2160 godzin.",
      offerHours: "Podaj od 2 do 168 godzin.",
      certificateMinSessions: "Podaj liczbę sesji od 1 do 100.",
      certificateHours: "Podaj liczbę godzin większą od 0 i najwyżej 999.",
      textLength: "Tekst jest za długi.",
      surveyCloseDays: "Podaj od 1 do 90 dni.",
      surveyMinResults: "Podaj od 5 do 50 odpowiedzi.",
    },
    save: {
      saved: "Ustawienia zapisane",
      failed: "Nie udało się zapisać ustawień.",
    },
  },
} as const;

export const adminEventParticipantEn = {
  adminEventParticipant: {
    loadError: "We could not load the participant settings.",
    retry: "Try again",
    communications: {
      description: "Reminders, calendar export and the log of sent messages.",
      reminders: {
        title: "Reminders",
        description:
          "Attendees with an active registration get an email and a notification; they choose channels.",
        enabled: "Send reminders",
        enabledHint: "Turning this off also pauses session reminders.",
        leadsLegend: "When to remind",
        leadsHint: "Pick 1 to 4 moments before the start.",
        leadsLimit: "4 moments picked - untick one to change.",
        sessionEnabled: "Reminders for sessions in the plan",
        sessionEnabledHint: "For sessions joined or starred by signed-in attendees.",
        sessionLead: "Lead time before a session",
        sessionLeadHint: "Minutes before the session starts.",
        sessionLeadOption: "{{minutes}} min before",
        sms: "SMS reminders",
        smsHint:
          "Only for attendees who switched SMS on and gave a number. Daily cap per organisation.",
        smsUnavailable: "Text messages are not enabled on the platform (no SMS provider).",
      },
      leads: {
        p10080: "7 days before",
        p4320: "3 days before",
        p1440: "24 hours before",
        p720: "12 hours before",
        p180: "3 hours before",
        p60: "1 hour before",
        p30: "30 minutes before",
        p15: "15 minutes before",
        custom: "{{minutes}} min before",
      },
      calendar: {
        title: "Calendar",
        description: "Adding the event and the plan to Google, Outlook, Microsoft 365 and Apple.",
        enabled: "Allow calendar export",
        enabledHint: "Turning this off hides the calendar buttons.",
      },
      deliveries: {
        title: "Delivery log",
        description: "Sent, skipped and failed messages by type and channel.",
        caption: "Message deliveries of the event",
        empty: "No message has been sent yet.",
        loadError: "We could not load the log.",
        lastSent: "Last sent: {{date}}",
        columns: {
          kind: "Message",
          channel: "Channel",
        },
      },
    },
    policies: {
      description: "Transfer, refund and waitlist offers for bought tickets.",
      transfer: {
        title: "Ticket transfer",
        description: "The new holder gets their own entry code; the old one stops working.",
        enabled: "Allow ticket transfers",
        enabledHint: "Not for group tickets or package seats.",
        deadline: "Up to how many hours before the start",
        deadlineHint: "0 = until the event begins.",
      },
      refund: {
        title: "Ticket refund",
        description:
          "The payer can refund the ticket before the deadline if it was not transferred.",
        modeLegend: "Refund rule",
        modes: {
          policy: "Refund until the deadline",
          policyHint: "A full refund with no fee until the deadline below.",
          none: "No self-service refund",
          noneHint: "The organiser decides on exceptions.",
        },
        deadline: "Refunds end (hours before the start)",
        deadlineHint: "168 hours by default.",
        rule: "The refund deadline is the earlier moment: the start minus these hours, or 30 days after payment.",
        snapshot:
          "The rule is saved with the ticket at payment - later changes never shorten buyers' rights.",
        favourable:
          "After a more generous change or a later event date, the more favourable deadline applies; a cancelled event always allows a refund.",
        noneWarning: "No refund needs matching wording in the event terms.",
      },
      waitlist: {
        title: "Waitlist offers",
        description:
          "A freed paid seat goes as an offer to the first person on the list, then to the next.",
        hours: "Time to pay for an offer (hours)",
        hoursHint: "From 2 to 168, 24 by default.",
        ticketNote: "You turn the waitlist on per ticket in the Tickets section.",
      },
    },
    deliveries: {
      kind: {
        eventReminder: "Event reminder",
        sessionReminder: "Session reminder",
        waitlistOffer: "Waitlist offer",
        waitlistOfferExpired: "Offer expired",
        waitlistOfferRefunded: "Refund for a late payment",
        waitlistJoined: "Joined the waitlist",
        transferOffer: "Transfer - invitation",
        transferCompleted: "Transfer - completed",
        transferRevoked: "Transfer - withdrawn",
        surveyInvite: "Survey invitation",
        certificateReady: "Certificate ready",
      },
      channel: {
        email: "Email",
        sms: "Text message",
        inapp: "In the app",
      },
      status: {
        claimed: "Queued",
        sent: "Sent",
        skipped: "Skipped",
        failed: "Failed",
      },
    },
    errors: {
      reminderLeads: "Pick at most 4 different moments.",
      sessionLead: "Enter 5 to 240 minutes.",
      transferDeadline: "Enter 0 to 720 hours.",
      refundDeadline: "Enter 0 to 2160 hours.",
      offerHours: "Enter 2 to 168 hours.",
      certificateMinSessions: "Enter a number of sessions from 1 to 100.",
      certificateHours: "Enter hours above 0 and at most 999.",
      textLength: "The text is too long.",
      surveyCloseDays: "Enter 1 to 90 days.",
      surveyMinResults: "Enter 5 to 50 responses.",
    },
    save: {
      saved: "Settings saved",
      failed: "We could not save the settings.",
    },
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", adminEventParticipantPl, true, true);
  i18n.addResourceBundle("en", "translation", adminEventParticipantEn, true, true);
}

ensureI18n();
