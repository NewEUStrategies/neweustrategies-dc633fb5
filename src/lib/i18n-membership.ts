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
      openPanel: "Panel organizacji",
    },
    // Panel samoobsługi organizacji (/profile/organization)
    orgPanel: {
      title: "Panel organizacji",
      subtitle: "Zapraszaj własny zespół i zarządzaj miejscami - bez udziału redakcji.",
      noOrgTitle: "Brak organizacji",
      noOrgBody:
        "Nie masz miejsca w żadnej organizacji członkowskiej. Skontaktuj się z nami, jeśli Twoja instytucja chce dołączyć.",
      contactCta: "Zobacz członkostwo instytucjonalne",
      seatsUsed: "Wykorzystane miejsca",
      expiresAt: "Członkostwo ważne do {{date}}",
      noExpiry: "Członkostwo bezterminowe",
      suspendedNote:
        "Organizacja jest zawieszona - miejsca nie nadają uprawnień. Skontaktuj się z redakcją.",
      membersHeading: "Członkowie i zaproszenia",
      colEmail: "E-mail",
      colRole: "Rola",
      colStatus: "Status",
      colJoined: "Dołączył(a)",
      colActions: "",
      statusClaimed: "aktywne",
      statusPending: "oczekuje",
      lastInvited: "wysłano {{date}}",
      inviteHeading: "Zaproś do organizacji",
      inviteHint:
        "Zaproszona osoba dostanie e-mail; miejsce przypisze się automatycznie po zalogowaniu na ten adres.",
      invitePlaceholder: "adres@twojafirma.pl",
      inviteButton: "Wyślij zaproszenie",
      inviteSentEmail: "Zaproszenie wysłane e-mailem.",
      inviteSentNoEmail:
        "Miejsce dodane. E-mail nie został wysłany - przekaż zaproszenie samodzielnie.",
      resend: "Wyślij ponownie",
      resendOk: "Zaproszenie ponowione.",
      resendNoEmail: "Nie udało się wysłać e-maila - spróbuj później.",
      resendError: "Nie udało się ponowić zaproszenia.",
      removeConfirmTitle: "Usunąć miejsce {{email}}?",
      removeOk: "Miejsce usunięte.",
      removeError: "Nie udało się usunąć miejsca.",
      memberViewNote:
        "Zarządzanie miejscami jest dostępne dla administratora organizacji. Twoje miejsce jest aktywne.",
      benefitsNote:
        "Miejsce w organizacji nadaje warstwę członkostwa {{tier}} - dostęp do treści premium, wydarzeń i biblioteki zgodnie z pakietem.",
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
      cta: "Support the foundation",
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
      openPanel: "Organisation panel",
    },
    orgPanel: {
      title: "Organisation panel",
      subtitle: "Invite your own team and manage seats - no editorial staff involved.",
      noOrgTitle: "No organisation",
      noOrgBody:
        "You don't hold a seat in any member organisation. Contact us if your institution would like to join.",
      contactCta: "See institutional membership",
      seatsUsed: "Seats used",
      expiresAt: "Membership valid until {{date}}",
      noExpiry: "Membership without expiry",
      suspendedNote:
        "The organisation is suspended - seats do not grant access. Please contact the editorial team.",
      membersHeading: "Members and invitations",
      colEmail: "Email",
      colRole: "Role",
      colStatus: "Status",
      colJoined: "Joined",
      colActions: "",
      statusClaimed: "active",
      statusPending: "pending",
      lastInvited: "sent {{date}}",
      inviteHeading: "Invite to the organisation",
      inviteHint:
        "The invitee receives an email; the seat is assigned automatically once they sign in with that address.",
      invitePlaceholder: "name@yourcompany.com",
      inviteButton: "Send invitation",
      inviteSentEmail: "Invitation sent by email.",
      inviteSentNoEmail:
        "Seat added. The email could not be sent - please share the invitation yourself.",
      resend: "Resend",
      resendOk: "Invitation re-sent.",
      resendNoEmail: "Could not send the email - try again later.",
      resendError: "Could not resend the invitation.",
      removeConfirmTitle: "Remove seat {{email}}?",
      removeOk: "Seat removed.",
      removeError: "Could not remove the seat.",
      memberViewNote:
        "Seat management is available to the organisation administrator. Your seat is active.",
      benefitsNote:
        "An organisation seat grants the {{tier}} membership tier - premium content, events and library access per your package.",
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

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
