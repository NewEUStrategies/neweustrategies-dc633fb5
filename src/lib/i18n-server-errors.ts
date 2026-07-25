// Bundle i18n dla dwóch klas błędów serwerowych: CSRF i rate-limit.
// Rejestrowany raz per proces (side-effect import) - Toasty / komponenty
// wywołują mapServerError() bez wiedzy o kluczach.
import i18n from "@/lib/i18n";

const pl = {
  serverErrors: {
    csrf: {
      title: "Sesja wygasła",
      description:
        "Ze względów bezpieczeństwa Twoja sesja została uznana za nieważną. Odśwież stronę i spróbuj ponownie.",
    },
    rateLimit: {
      title: "Zbyt wiele żądań",
      description: "Przekroczyłeś limit prób. Spróbuj ponownie za chwilę.",
      descriptionWithRetry: "Przekroczyłeś limit prób. Spróbuj ponownie za {{s}} s.",
    },
  },
};

const en = {
  serverErrors: {
    csrf: {
      title: "Session expired",
      description:
        "For security reasons your session was invalidated. Please refresh the page and try again.",
    },
    rateLimit: {
      title: "Too many requests",
      description: "You have exceeded the rate limit. Please try again in a moment.",
      descriptionWithRetry: "You have exceeded the rate limit. Try again in {{s}} s.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
