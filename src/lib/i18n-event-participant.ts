// Nakładka i18n POWIERZCHNI UCZESTNIKA funkcji F1-F5 (`eventParticipant.*`).
//
// WŁAŚCICIEL: Foundation. Panel „Moje" na wydarzeniu (`/events/<slug>/me`)
// i jego molekuły czytają stąd: zakładkę „Po wydarzeniu", tony plakietki
// stanu zgłoszenia, etykiety harmonogramu (sesja odwołana, lista rezerwowa,
// piętro) i zdania błędów. Tory A/B/C mają WŁASNE nakładki (`eventPlan`,
// `eventCalendar`, `eventTicketActions`, `eventFollowUp`) - tu nie dopisują.
//
// NAKŁADKA JEST BRAMKOWANA od pierwszego dnia (`GATED_PREFIXES`), a jej
// korzeń stoi w `REFERENCE_PREFIXES` bramki `eventsI18nKeys` - literał
// `eventParticipant.x` w kodzie bez wpisu tutaj czerwieni CI.
//
// ZNACZNIK CZYSTOŚCI CHUNKA STARTOWEGO. `scripts/check-entry-purity.ts` szuka
// w paczce startowej zdania `options.loadError` (PL). Nakładka ma jechać
// WYŁĄCZNIE w leniwym chunku panelu uczestnika - zmiana tego zdania wymaga
// zmiany znacznika w obu miejscach naraz.
import i18n from "@/lib/i18n";

export const eventParticipantPl = {
  eventParticipant: {
    loading: "Wczytujemy Twój panel wydarzenia…",
    tabs: {
      followUp: "Po wydarzeniu",
    },
    status: {
      active: "Zgłoszenie potwierdzone",
      pending: "Zgłoszenie oczekuje",
      waitlist: "Lista rezerwowa",
      closed: "Zgłoszenie nieaktywne",
    },
    agenda: {
      cancelled: "Sesja odwołana",
      waitlist: "Lista rezerwowa sesji",
      floor: "Piętro: {{floor}}",
      loadError:
        "Nie udało się wczytać Twojego harmonogramu. To nie znaczy, że nie masz zapisów - spróbuj ponownie za chwilę.",
      retry: "Spróbuj ponownie",
    },
    options: {
      loadError: "Nie udało się wczytać ustawień uczestnika tego wydarzenia.",
    },
  },
} as const;

export const eventParticipantEn = {
  eventParticipant: {
    loading: "Loading your event panel…",
    tabs: {
      followUp: "After the event",
    },
    status: {
      active: "Registration confirmed",
      pending: "Registration pending",
      waitlist: "Waitlist",
      closed: "Registration inactive",
    },
    agenda: {
      cancelled: "Session cancelled",
      waitlist: "Session waitlist",
      floor: "Floor: {{floor}}",
      loadError:
        "We could not load your schedule. It does not mean you have no sign-ups - please try again in a moment.",
      retry: "Try again",
    },
    options: {
      loadError: "We could not load the participant settings of this event.",
    },
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", eventParticipantPl, true, true);
  i18n.addResourceBundle("en", "translation", eventParticipantEn, true, true);
}

ensureI18n();
