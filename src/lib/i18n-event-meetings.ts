// Slownik GIELDY SPOTKAN 1-1 (Business Matching Exchange), PL/EN.
//
// JEDNA NAKLADKA NA OBIE PLASZCZYZNY. Panel organizatora i ekran uczestnika
// mowia o tych samych rzeczach - stolik, termin, zaproszenie, odmowa - i gdyby
// mialy osobne slowniki, ta sama sytuacja nazywalaby sie w panelu inaczej niz
// w wiadomosci, ktora uczestnik dostaje. Rozdzielone sa tylko sekcje.
//
// KLUCZE BLEDOW ODWZOROWUJA WYJATKI Z MIGRACJI `20260823190000_event_meetings.sql`
// jeden do jednego (patrz `meetingsErrors.ts`). Test parytetu pilnuje, ze kazdy
// klucz, ktory baza potrafi podniesc, ma zdanie po polsku i po angielsku -
// inaczej pierwszy nowy warunek w bazie pokazuje sie uzytkownikowi jako
// `not_invitee` albo, gorzej, jako surowy tekst wyjatku.
//
// TEKST MOWI, CO ZROBIC DALEJ. "Ten termin wlasnie zajela druga osoba - wybierz
// inny" zamiast "Konflikt". Uczestnik kongresu ma minute miedzy sesjami, a nie
// checi na interpretowanie komunikatu.
import i18n from "@/lib/i18n";

export const eventMeetingsPl = {
  eventMeetings: {
    title: "Giełda spotkań 1-1",
    subtitle: "Umów rozmowę z uczestnikiem kongresu w wolnym terminie obu stron.",

    nav: {
      exchange: "Giełda",
      myMeetings: "Moje spotkania",
      availability: "Moja dostępność",
      tables: "Stoliki",
      settings: "Konfiguracja",
      stats: "Statystyki",
    },

    status: {
      invited: "Zaproszenie wysłane",
      accepted: "Potwierdzone",
      declined: "Odrzucone",
      cancelled: "Odwołane",
      rescheduled: "Przełożone",
      held: "Odbyło się",
      no_show: "Nieobecność",
      expired: "Zaproszenie wygasło",
      pending: "Czeka na odpowiedź",
      all: "Wszystkie",
    },

    side: {
      requester: "Ty zaprosiłeś",
      invitee: "Zaproszono Ciebie",
    },

    actions: {
      invite: "Zaproś na rozmowę",
      accept: "Przyjmij",
      decline: "Odrzuć",
      cancel: "Odwołaj",
      reschedule: "Zaproponuj inny termin",
      addAvailability: "Dodaj okno dostępności",
      removeAvailability: "Usuń okno",
      arrange: "Umów spotkanie",
      markHeld: "Odbyło się",
      markNoShow: "Nieobecność",
      pickSlot: "Wybierz termin",
      saveTable: "Zapisz stolik",
      deleteTable: "Usuń stolik",
    },

    fields: {
      counterpart: "Rozmówca",
      slot: "Termin",
      table: "Stolik",
      zone: "Strefa",
      seat: "Miejsce",
      topic: "Temat rozmowy",
      message: "Wiadomość do zaproszenia",
      declineReason: "Powód odmowy",
      cancelReason: "Powód odwołania",
      expiresAt: "Zaproszenie ważne do",
      note: "Notatka",
      capacity: "Liczba miejsc",
      sponsor: "Sponsor",
      day: "Dzień",
      search: "Szukaj po nazwisku lub firmie",
    },

    hints: {
      availability:
        "Zaproszenie można wysłać tylko na termin, w którym obie strony mają otwarte okno dostępności.",
      invitesLeft: "Pozostało zaproszeń: {{count}}",
      dailyLimit: "Limit spotkań w jednym dniu: {{count}}",
      noSlots: "Brak wspólnego wolnego terminu - poproś rozmówcę o poszerzenie dostępności.",
      noContact:
        "Adresu e-mail i telefonu nie udostępniamy - kontaktem wymienicie się na spotkaniu.",
      bookingClosed: "Zapisy na spotkania są zamknięte.",
      declineReasonRequired: "Krótkie uzasadnienie odmowy trafia do drugiej strony.",
    },

    empty: {
      meetings: "Nie masz jeszcze żadnych spotkań.",
      availability: "Nie zgłosiłeś jeszcze żadnego okna dostępności.",
      tables: "Nie dodano jeszcze żadnego stolika.",
      participants: "Brak uczestników spełniających kryteria.",
    },

    toasts: {
      invited: "Zaproszenie wysłane",
      accepted: "Spotkanie potwierdzone",
      declined: "Zaproszenie odrzucone",
      cancelled: "Spotkanie odwołane",
      rescheduled: "Nowy termin zaproponowany",
      availabilitySaved: "Okno dostępności zapisane",
      availabilityRemoved: "Okno dostępności usunięte",
      tableSaved: "Stolik zapisany",
      tableDeleted: "Stolik usunięty",
      settingsSaved: "Konfiguracja giełdy zapisana",
      statusSaved: "Status spotkania zmieniony",
    },

    participant: {
      heading: "Giełda spotkań 1-1",
      loading: "Ładujemy stan giełdy…",
      tabs: {
        meetings: "Moje spotkania",
        availability: "Moja dostępność",
      },
      badges: {
        // "Termin", a nie "Slot": reszta polskiej powierzchni gieldy mowi
        // "Wolne terminy" i "Termin", wiec odznaka nie moze mowic inaczej
        // o tym samym pojeciu.
        slot: "Termin: {{count}} min",
        tables: "Stoliki: {{count}}",
        timezone: "Strefa: {{zone}}",
        expiry: "Zaproszenie wygasa po {{count}} h",
      },
      summary: {
        incoming: "Zaproszenia do Ciebie",
        outgoing: "Twoje zaproszenia",
        accepted: "Potwierdzone",
        held: "Odbyte",
      },
      blocks: {
        notConfigured: "Organizator nie uruchomił jeszcze giełdy spotkań dla tego wydarzenia.",
        disabled: "Giełda spotkań jest wyłączona dla tego wydarzenia.",
        notRegistered:
          "Giełda jest dla zarejestrowanych uczestników - zapisz się na wydarzenie, żeby umawiać rozmowy.",
        notAllowed: "Twoja grupa uczestników nie umawia spotkań na tym wydarzeniu.",
        closed:
          "Zapisy na spotkania są w tej chwili zamknięte - okna dostępności możesz zgłosić już teraz.",
      },
      form: {
        save: "Zapisz",
        dismiss: "Anuluj",
        confirm: "Potwierdź",
      },
      availability: {
        title: "Twoje okna dostępności",
        description:
          "Zaproszenie da się umówić tylko na termin, w którym obie strony mają otwarte okno.",
        open: "Przyjmuję zaproszenia",
        closed: "Jestem, ale nie przyjmuję zaproszeń",
        openField: "Przyjmuję w tym oknie zaproszenia",
        from: "Od",
        to: "Do",
        dialogNew: "Nowe okno dostępności",
        dialogEdit: "Edycja okna dostępności",
        removeConfirm: "Usunąć to okno dostępności?",
        durationHint: "Okno musi trwać od 15 minut do 16 godzin.",
      },
      meetings: {
        incoming: "Do Ciebie",
        outgoing: "Od Ciebie",
        expiresAt: "Odpowiedz do {{value}}",
        tableUnassigned: "Stolik przydzielimy po potwierdzeniu",
        seat: "miejsce {{count}}",
        declineTitle: "Odrzuć zaproszenie",
        cancelTitle: "Odwołaj spotkanie",
        rescheduleTitle: "Zaproponuj inny termin",
        rescheduleHint:
          "Wybieramy z terminów wolnych dla obu stron - obecne spotkanie zostanie zamknięte jako przełożone.",
        noSlots: "Brak wspólnego wolnego terminu - poproś rozmówcę o poszerzenie dostępności.",
        loadingSlots: "Szukamy wspólnych terminów…",
      },
    },

    errors: {
      forbidden: "Zaloguj się, żeby korzystać z giełdy spotkań.",
      invalid_payload: "Brakuje danych do wykonania tej operacji.",
      invalid_decision: "Nieznana decyzja - przyjmij albo odrzuć zaproszenie.",
      not_found: "Nie znaleziono tego spotkania.",
      not_registered: "Giełda spotkań jest dla zarejestrowanych uczestników tego wydarzenia.",
      not_invitee: "Na zaproszenie odpowiada tylko osoba zaproszona.",
      not_a_party: "To spotkanie nie jest Twoje.",
      invitation_not_open: "Na to zaproszenie już odpowiedziano.",
      invitation_expired: "Termin ważności zaproszenia minął - zaproponuj nowy.",
      decline_reason_required: "Podaj krótki powód odmowy.",
      meeting_not_active: "Zmieniać można tylko otwarte zaproszenie albo potwierdzone spotkanie.",
      meetings_disabled: "Giełda spotkań nie jest włączona dla tego wydarzenia.",
      exchange_closed: "Zapisy na spotkania są w tej chwili zamknięte.",
      invalid_window: "Okno dostępności musi kończyć się po godzinie rozpoczęcia.",
      exchange_rule_closed: "Reguły tego wydarzenia nie otwierają giełdy dla Twojej grupy.",
      rate_limited: "Za dużo zaproszeń w krótkim czasie - spróbuj ponownie za chwilę.",
      same_slot: "To jest ten sam termin, co obecny.",
      self_invite: "Nie umówisz spotkania z samym sobą.",
      slot_not_in_grid: "Ten termin nie mieści się w siatce giełdy - wybierz z listy.",
      requester_unavailable: "Ten termin wypada poza Twoim oknem dostępności.",
      invitee_unavailable: "Rozmówca nie ma otwartego okna w tym terminie.",
      requester_not_participating: "Twoje zgłoszenie na to wydarzenie nie jest potwierdzone.",
      invitee_not_participating: "Zgłoszenie rozmówcy na to wydarzenie nie jest potwierdzone.",
      requester_group_cannot_meet: "Twoja grupa uczestników nie umawia spotkań na tym wydarzeniu.",
      invitee_group_cannot_meet: "Grupa rozmówcy nie przyjmuje zaproszeń na tym wydarzeniu.",
      requester_group_not_allowed:
        "Reguły giełdy nie pozwalają Twojej grupie zapraszać na spotkania.",
      invitee_group_not_allowed: "Reguły giełdy nie pozwalają zaprosić osoby z tej grupy.",
      requester_not_sponsor:
        "Na tym wydarzeniu zaproszenia wysyłają wyłącznie partnerzy i sponsorzy.",
      invite_limit_reached: "Wyczerpałeś limit zaproszeń w tym wydarzeniu.",
      daily_limit_reached: "Jedna ze stron ma już komplet spotkań tego dnia.",
      duplicate_invitation: "Masz już aktywne zaproszenie do tej osoby na ten termin.",
      duplicate_meeting: "Takie spotkanie już istnieje.",
      participant_busy: "Jedna ze stron ma już spotkanie w tym terminie.",
      table_busy: "Miejsce przy tym stoliku właśnie zajęto - wybierz inny termin.",
      table_inactive: "Ten stolik jest wyłączony z giełdy.",
      table_not_found: "Nie znaleziono tego stolika.",
      table_seat_out_of_range: "Przy tym stoliku nie ma już wolnego miejsca.",
      no_free_table: "W tym terminie wszystkie stoliki są zajęte - wybierz inny.",
      availability_overlap: "To okno nakłada się na inne Twoje okno dostępności.",
      availability_has_meetings: "W tym oknie jest zaplanowane spotkanie - najpierw je odwołaj.",

      unknown: "Operacja się nie powiodła. Spróbuj ponownie.",
    },
  },
};

export const eventMeetingsEn = {
  eventMeetings: {
    title: "1-1 meeting exchange",
    subtitle: "Book a conversation with another participant in a slot that suits you both.",

    nav: {
      exchange: "Exchange",
      myMeetings: "My meetings",
      availability: "My availability",
      tables: "Tables",
      settings: "Configuration",
      stats: "Statistics",
    },

    status: {
      invited: "Invitation sent",
      accepted: "Confirmed",
      declined: "Declined",
      cancelled: "Cancelled",
      rescheduled: "Rescheduled",
      held: "Held",
      no_show: "No show",
      expired: "Invitation expired",
      pending: "Awaiting answer",
      all: "All",
    },

    side: {
      requester: "You invited",
      invitee: "You were invited",
    },

    actions: {
      invite: "Invite to a meeting",
      accept: "Accept",
      decline: "Decline",
      cancel: "Cancel",
      reschedule: "Propose another slot",
      addAvailability: "Add availability window",
      removeAvailability: "Remove window",
      arrange: "Arrange meeting",
      markHeld: "Held",
      markNoShow: "No show",
      pickSlot: "Pick a slot",
      saveTable: "Save table",
      deleteTable: "Delete table",
    },

    fields: {
      counterpart: "Counterpart",
      slot: "Slot",
      table: "Table",
      zone: "Zone",
      seat: "Seat",
      topic: "Topic",
      message: "Message with the invitation",
      declineReason: "Reason for declining",
      cancelReason: "Reason for cancelling",
      expiresAt: "Invitation valid until",
      note: "Note",
      capacity: "Seats",
      sponsor: "Sponsor",
      day: "Day",
      search: "Search by name or company",
    },

    hints: {
      availability:
        "An invitation can only be sent for a slot where both sides have an open availability window.",
      invitesLeft: "Invitations left: {{count}}",
      dailyLimit: "Meetings allowed per day: {{count}}",
      noSlots: "No shared free slot - ask your counterpart to widen their availability.",
      noContact:
        "Email addresses and phone numbers are not shared here - exchange contacts at the meeting.",
      bookingClosed: "Meeting booking is closed.",
      declineReasonRequired: "A short reason is passed on to the other side.",
    },

    empty: {
      meetings: "You have no meetings yet.",
      availability: "You have not declared any availability window yet.",
      tables: "No table has been added yet.",
      participants: "No participants match these criteria.",
    },

    toasts: {
      invited: "Invitation sent",
      accepted: "Meeting confirmed",
      declined: "Invitation declined",
      cancelled: "Meeting cancelled",
      rescheduled: "New slot proposed",
      availabilitySaved: "Availability window saved",
      availabilityRemoved: "Availability window removed",
      tableSaved: "Table saved",
      tableDeleted: "Table deleted",
      settingsSaved: "Exchange configuration saved",
      statusSaved: "Meeting status changed",
    },

    participant: {
      heading: "1-1 meeting exchange",
      loading: "Loading the exchange…",
      tabs: {
        meetings: "My meetings",
        availability: "My availability",
      },
      badges: {
        slot: "Slot: {{count}} min",
        tables: "Tables: {{count}}",
        timezone: "Time zone: {{zone}}",
        expiry: "Invitations expire after {{count}} h",
      },
      summary: {
        incoming: "Invitations to you",
        outgoing: "Your invitations",
        accepted: "Confirmed",
        held: "Held",
      },
      blocks: {
        notConfigured: "The organiser has not opened the meeting exchange for this event yet.",
        disabled: "The meeting exchange is switched off for this event.",
        notRegistered:
          "The exchange is for registered participants - register for the event to book conversations.",
        notAllowed: "Your participant group does not book meetings at this event.",
        closed:
          "Meeting booking is closed right now - you can still declare your availability windows.",
      },
      form: {
        save: "Save",
        dismiss: "Cancel",
        confirm: "Confirm",
      },
      availability: {
        title: "Your availability windows",
        description: "A meeting can only be booked in a slot where both sides have an open window.",
        open: "Accepting invitations",
        closed: "On site, but not accepting invitations",
        openField: "Accept invitations in this window",
        from: "From",
        to: "To",
        dialogNew: "New availability window",
        dialogEdit: "Edit availability window",
        removeConfirm: "Remove this availability window?",
        durationHint: "A window must last between 15 minutes and 16 hours.",
      },
      meetings: {
        incoming: "To you",
        outgoing: "From you",
        expiresAt: "Answer by {{value}}",
        tableUnassigned: "A table is assigned once the meeting is confirmed",
        seat: "seat {{count}}",
        declineTitle: "Decline invitation",
        cancelTitle: "Cancel meeting",
        rescheduleTitle: "Propose another slot",
        rescheduleHint:
          "We only offer slots free for both sides - the current meeting is closed as rescheduled.",
        noSlots: "No shared free slot - ask your counterpart to widen their availability.",
        loadingSlots: "Looking for shared slots…",
      },
    },

    errors: {
      forbidden: "Sign in to use the meeting exchange.",
      invalid_payload: "Some data required for this operation is missing.",
      invalid_decision: "Unknown decision - accept or decline the invitation.",
      not_found: "This meeting could not be found.",
      not_registered: "The meeting exchange is for registered participants of this event.",
      not_invitee: "Only the invited person can answer this invitation.",
      not_a_party: "This meeting is not yours.",
      invitation_not_open: "This invitation has already been answered.",
      invitation_expired: "The invitation has expired - propose a new slot.",
      decline_reason_required: "Give a short reason for declining.",
      meeting_not_active: "Only an open invitation or a confirmed meeting can be changed.",
      meetings_disabled: "The meeting exchange is not enabled for this event.",
      exchange_closed: "Meeting booking is closed at the moment.",
      invalid_window: "An availability window must end after it starts.",
      exchange_rule_closed: "The rules of this event do not open the exchange for your group.",
      rate_limited: "Too many invitations in a short time - try again in a moment.",
      same_slot: "This is the same slot as the current one.",
      self_invite: "You cannot book a meeting with yourself.",
      slot_not_in_grid: "This slot is not part of the exchange grid - pick one from the list.",
      requester_unavailable: "This slot falls outside your availability window.",
      invitee_unavailable: "Your counterpart has no open window in this slot.",
      requester_not_participating: "Your registration for this event is not confirmed.",
      invitee_not_participating: "Your counterpart's registration for this event is not confirmed.",
      requester_group_cannot_meet: "Your participant group does not book meetings at this event.",
      invitee_group_cannot_meet:
        "Your counterpart's group does not accept invitations at this event.",
      requester_group_not_allowed: "The exchange rules do not let your group send invitations.",
      invitee_group_not_allowed:
        "The exchange rules do not let you invite someone from that group.",
      requester_not_sponsor: "At this event only partners and sponsors send invitations.",
      invite_limit_reached: "You have used up your invitations for this event.",
      daily_limit_reached: "One of you already has a full day of meetings.",
      duplicate_invitation: "You already have an active invitation with this person in this slot.",
      duplicate_meeting: "This meeting already exists.",
      participant_busy: "One of you already has a meeting in this slot.",
      table_busy: "The seat at this table has just been taken - pick another slot.",
      table_inactive: "This table is switched off for the exchange.",
      table_not_found: "This table could not be found.",
      table_seat_out_of_range: "There is no free seat left at this table.",
      no_free_table: "Every table is taken in this slot - pick another one.",
      availability_overlap: "This window overlaps another one of your availability windows.",
      availability_has_meetings: "A meeting is scheduled in this window - cancel it first.",

      unknown: "The operation failed. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", eventMeetingsPl, true, true);
i18n.addResourceBundle("en", "translation", eventMeetingsEn, true, true);

/**
 * No-op wolany w komponencie trasy zamiast side-effectowego importu modulu -
 * pozwala splitterowi zostawic caly slownik w chunku trasy gieldy.
 */
export function ensureI18n(): void {}
