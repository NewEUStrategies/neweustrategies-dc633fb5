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
      availability: "Zaproszenie można wysłać tylko na termin, w którym obie strony mają otwarte okno dostępności.",
      invitesLeft: "Pozostało zaproszeń: {{count}}",
      dailyLimit: "Limit spotkań w jednym dniu: {{count}}",
      noSlots: "Brak wspólnego wolnego terminu - poproś rozmówcę o poszerzenie dostępności.",
      noContact: "Adresu e-mail i telefonu nie udostępniamy - kontaktem wymienicie się na spotkaniu.",
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
      requester_group_not_allowed: "Reguły giełdy nie pozwalają Twojej grupie zapraszać na spotkania.",
      invitee_group_not_allowed: "Reguły giełdy nie pozwalają zaprosić osoby z tej grupy.",
      requester_not_sponsor: "Na tym wydarzeniu zaproszenia wysyłają wyłącznie partnerzy i sponsorzy.",
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
      availability: "An invitation can only be sent for a slot where both sides have an open availability window.",
      invitesLeft: "Invitations left: {{count}}",
      dailyLimit: "Meetings allowed per day: {{count}}",
      noSlots: "No shared free slot - ask your counterpart to widen their availability.",
      noContact: "Email addresses and phone numbers are not shared here - exchange contacts at the meeting.",
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
      same_slot: "This is the same slot as the current one.",
      same_person: "You cannot book a meeting with yourself.",
      slot_invalid: "This slot is not part of the exchange grid - pick one from the list.",
      slot_outside_availability: "This slot falls outside your availability window.",
      counterpart_unavailable: "Your counterpart has no open window in this slot.",
      group_not_allowed: "The rules of this event do not allow a meeting between these two groups.",
      invite_limit_reached: "You have used up your invitations for this event.",
      daily_limit_reached: "One of you already has a full day of meetings.",
      duplicate_invitation: "You already have an active invitation with this person in this slot.",
      participant_busy: "One of you already has a meeting in this slot.",
      table_busy: "The seat at this table has just been taken - pick another slot.",
      no_free_table: "Every table is taken in this slot - pick another one.",
      availability_in_use: "A meeting is scheduled in this window - cancel it first.",
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
