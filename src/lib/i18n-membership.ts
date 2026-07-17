// Zasoby i18n huba członkostwa (/profile/membership). Członkostwo jako produkt:
// aktualny poziom + prawa, status wspierającego, organizacja i miejsca oraz
// historia uczestnictwa (wydarzenia, pobrania).
import i18n from "@/lib/i18n";

export const membershipPl = {
  membership: {
    title: "Członkostwo",
    subtitle: "Twój poziom, prawa i historia uczestnictwa.",
    currentLevel: "Twój poziom",
    rank: "Ranga",
    benefitsHeading: "Co obejmuje Twój poziom",
    manageSubscription: "Zarządzaj subskrypcją",
    seePlans: "Zobacz poziomy członkostwa",
    upgrade: "Podnieś poziom",
    // Źródła poziomu
    sources: {
      heading: "Skąd wynika Twój poziom",
      subscription: "Aktywna subskrypcja",
      grant_manual: "Nadanie przez zespół NES",
      grant_donation: "Status wspierającego (darowizna)",
      grant_import: "Nadanie (import)",
      organization: "Członkostwo organizacji",
      expires: "Ważne do {{date}}",
      noExpiry: "Bezterminowo",
    },
    // Wsparcie / darowizny
    support: {
      heading: "Twoje wsparcie",
      none: "Nie masz jeszcze zarejestrowanych darowizn.",
      supporterActive: "Status wspierającego aktywny do {{date}}.",
      cta: "Wesprzyj fundację",
      refunded: "zwrócono",
    },
    // Organizacja członkowska
    organization: {
      heading: "Twoja organizacja",
      none: "Nie należysz do żadnej organizacji członkowskiej.",
      role: "Rola",
      roleOwner: "Administrator",
      roleMember: "Członek",
      seats: "Miejsca",
      seatsUsage: "{{used}} z {{limit}}",
      status: "Status",
      statusActive: "aktywna",
      statusSuspended: "zawieszona",
      manageSeats: "Zarządzaj miejscami",
      seatsHeading: "Miejsca w organizacji",
      invitePlaceholder: "adres e-mail",
      invite: "Dodaj miejsce",
      pending: "zaproszony",
      claimed: "aktywne",
      remove: "Usuń",
      seatLimitReached: "Osiągnięto limit miejsc.",
      inviteError: "Nie udało się dodać miejsca.",
      inviteSuccess: "Dodano miejsce.",
      seatExists: "To miejsce już istnieje.",
    },
    // Historia uczestnictwa
    events: {
      heading: "Historia uczestnictwa w wydarzeniach",
      none: "Nie masz jeszcze historii RSVP.",
      statusGoing: "Uczestnictwo",
      statusInterested: "Zainteresowanie",
      statusCancelled: "Anulowano",
      upcoming: "nadchodzące",
      past: "zakończone",
    },
    downloads: {
      heading: "Pobrane materiały",
      none: "Nie pobrałeś jeszcze żadnych materiałów.",
      openLibrary: "Przejdź do biblioteki",
    },
    loading: "Wczytywanie...",
  },
};

export const membershipEn: typeof membershipPl = {
  membership: {
    title: "Membership",
    subtitle: "Your level, rights and participation history.",
    currentLevel: "Your level",
    rank: "Rank",
    benefitsHeading: "What your level includes",
    manageSubscription: "Manage subscription",
    seePlans: "See membership levels",
    upgrade: "Upgrade level",
    sources: {
      heading: "Where your level comes from",
      subscription: "Active subscription",
      grant_manual: "Granted by the NES team",
      grant_donation: "Supporter status (donation)",
      grant_import: "Grant (import)",
      organization: "Organisation membership",
      expires: "Valid until {{date}}",
      noExpiry: "No expiry",
    },
    support: {
      heading: "Your support",
      none: "No donations recorded yet.",
      supporterActive: "Supporter status active until {{date}}.",
      cta: "Support the institute",
      refunded: "refunded",
    },
    organization: {
      heading: "Your organisation",
      none: "You don't belong to any member organisation.",
      role: "Role",
      roleOwner: "Administrator",
      roleMember: "Member",
      seats: "Seats",
      seatsUsage: "{{used}} of {{limit}}",
      status: "Status",
      statusActive: "active",
      statusSuspended: "suspended",
      manageSeats: "Manage seats",
      seatsHeading: "Organisation seats",
      invitePlaceholder: "email address",
      invite: "Add seat",
      pending: "invited",
      claimed: "active",
      remove: "Remove",
      seatLimitReached: "Seat limit reached.",
      inviteError: "Could not add the seat.",
      inviteSuccess: "Seat added.",
      seatExists: "That seat already exists.",
    },
    events: {
      heading: "Event participation history",
      none: "No RSVP history yet.",
      statusGoing: "Attending",
      statusInterested: "Interested",
      statusCancelled: "Cancelled",
      upcoming: "upcoming",
      past: "past",
    },
    downloads: {
      heading: "Downloaded materials",
      none: "You haven't downloaded any materials yet.",
      openLibrary: "Go to the library",
    },
    loading: "Loading...",
  },
};

i18n.addResourceBundle("pl", "translation", membershipPl, true, true);
i18n.addResourceBundle("en", "translation", membershipEn, true, true);
