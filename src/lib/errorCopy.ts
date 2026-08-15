// Single source of bilingual copy for the "emergency" layer: 404 pages,
// error boundaries and friendly error screens. These surfaces can render
// outside the i18next provider (root boundary, class ErrorBoundary), so they
// read `currentLang()` directly instead of useTranslation(). Raw error.message
// is deliberately never shown to visitors - it is logged/reported, not rendered.
import { currentLang } from "@/lib/i18n/localeRuntime";

type ErrorScenario = {
  title: string;
  body: string;
  stepsTitle: string;
  steps: string[];
  primaryAction: string;
  secondaryAction: string;
};

type ErrorCopy = {
  notFoundTitle: string;
  notFoundBody: string;
  /** Nadlinia nad listą podpowiedzi na stronie 404. */
  notFoundSuggestionsTitle: string;
  /** Etykiety skrótów nawigacyjnych na stronie 404. */
  notFoundLinks: { home: string; analyses: string; pricing: string; quiz: string; contact: string };
  contactSupport: string;
  errorTitle: string;
  errorBody: string;
  tryAgain: string;
  goHome: string;
  unauthorized: ErrorScenario;
  sessionExpired: ErrorScenario;
  network: ErrorScenario;
  /**
   * Render ZDEGRADOWANY: strona wyszła poprawnie (HTTP 200), ale jedna sekcja
   * nie zdążyła pobrać danych w budżecie SSR. Osobny scenariusz, bo `network`
   * każe czytelnikowi sprawdzić WŁASNE łącze - a tu zawiodła nasza strona.
   */
  degraded: ErrorScenario;
  /**
   * Nadlinia karty przy degradacji. `errorTitle` („Nie udało się załadować
   * strony") byłby przy niej wprost nieprawdziwy - strona załadowała się
   * w całości, brakuje tylko danych jednej sekcji, a odpowiedź ma status 200.
   */
  degradedEyebrow: string;
  /** Stopka pomocy pod kartą błędu i skróty ratunkowe. */
  needHelp: string;
  contactLink: string;
  goBack: string;
  keepGoing: string;
  /**
   * Etykieta kodu na pasku statusu dla błędu ogólnego. Techniczne „ERR" nic
   * czytelnikowi nie mówi - ludzki okrzyk mówi więcej, więc żyje w słowniku.
   */
  genericCode: string;
  generic: ErrorScenario;
};

const COPY: Record<"pl" | "en", ErrorCopy> = {
  pl: {
    notFoundTitle: "Nie znaleziono strony",
    notFoundBody: "Strona, której szukasz, nie istnieje lub została przeniesiona.",
    notFoundSuggestionsTitle: "Być może szukasz:",
    notFoundLinks: {
      home: "Strona główna",
      analyses: "Analizy",
      pricing: "Cennik",
      quiz: "Quiz",
      contact: "Kontakt",
    },
    contactSupport: "Napisz do nas",
    errorTitle: "Nie udało się załadować strony",
    errorBody: "Coś poszło nie tak po naszej stronie. Odśwież stronę lub wróć na stronę główną.",
    tryAgain: "Spróbuj ponownie",
    goHome: "Strona główna",
    unauthorized: {
      title: "Wymagane logowanie",
      body: "Ta część platformy jest dostępna tylko dla zalogowanych użytkowników.",
      stepsTitle: "Co zrobić?",
      steps: [
        "Kliknij przycisk „Zaloguj się” poniżej.",
        "Podaj swój e-mail i hasło lub zaloguj się przez Google.",
        "Po zalogowaniu wrócisz automatycznie do żądanej strony.",
      ],
      primaryAction: "Zaloguj się",
      secondaryAction: "Strona główna",
    },
    sessionExpired: {
      title: "Sesja wygasła",
      body: "Twoja sesja wygasła lub wymagana jest ponowna weryfikacja tożsamości.",
      stepsTitle: "Co zrobić?",
      steps: [
        "Kliknij przycisk „Zaloguj się ponownie”.",
        "W razie problemu wyczyść ciasteczka i zaloguj się na nowo.",
        "Możesz też wrócić na stronę główną i kontynuować jako gość.",
      ],
      primaryAction: "Zaloguj się ponownie",
      secondaryAction: "Strona główna",
    },
    network: {
      title: "Problem z połączeniem",
      body: "Nie udało się połączyć z serwerem. Sprawdź swoje łącze internetowe.",
      stepsTitle: "Co zrobić?",
      steps: [
        "Sprawdź, czy masz aktywne połączenie z internetem.",
        "Kliknij „Spróbuj ponownie”, aby ponowić żądanie.",
        "Jeśli problem wraca, poczekaj chwilę i odśwież stronę.",
      ],
      primaryAction: "Spróbuj ponownie",
      secondaryAction: "Strona główna",
    },
    degraded: {
      title: "Ta sekcja chwilowo nie ma danych",
      body: "Reszta strony działa normalnie - nie udało się tylko pobrać tej listy na czas.",
      stepsTitle: "Co zrobić?",
      steps: [
        "Kliknij „Spróbuj ponownie” - dane zwykle wracają od razu.",
        "Możesz też odświeżyć stronę za chwilę.",
        "Pozostała treść strony jest kompletna i możesz z niej korzystać.",
      ],
      primaryAction: "Spróbuj ponownie",
      secondaryAction: "Strona główna",
    },
    degradedEyebrow: "Strona załadowana",
    needHelp: "Potrzebujesz pomocy?",
    contactLink: "Skontaktuj się z nami",
    goBack: "Wróć",
    keepGoing: "Przejdź dalej",
    generic: {
      title: "Nie udało się załadować strony",
      body: "Coś poszło nie tak po naszej stronie. Przepraszamy za utrudnienia.",
      stepsTitle: "Co zrobić?",
      steps: [
        "Kliknij „Spróbuj ponownie”, aby ponowić żądanie.",
        "Jeśli to nie pomoże, wróć na stronę główną.",
        "Możesz też skontaktować się z nami, jeśli błąd się powtarza.",
      ],
      primaryAction: "Spróbuj ponownie",
      secondaryAction: "Strona główna",
    },
  },
  en: {
    notFoundTitle: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or has been moved.",
    notFoundSuggestionsTitle: "You might be looking for:",
    notFoundLinks: {
      home: "Home",
      analyses: "Analyses",
      pricing: "Pricing",
      quiz: "Quiz",
      contact: "Contact",
    },
    contactSupport: "Contact support",
    errorTitle: "This page didn't load",
    errorBody: "Something went wrong on our end. Try refreshing or head back home.",
    tryAgain: "Try again",
    goHome: "Go home",
    unauthorized: {
      title: "Sign in required",
      body: "This part of the platform is only available to signed-in users.",
      stepsTitle: "What to do",
      steps: [
        "Click the Sign in button below.",
        "Enter your email and password or sign in with Google.",
        "After signing in you will be returned to the requested page.",
      ],
      primaryAction: "Sign in",
      secondaryAction: "Go home",
    },
    sessionExpired: {
      title: "Session expired",
      body: "Your session has expired or your identity needs to be verified again.",
      stepsTitle: "What to do",
      steps: [
        "Click Sign in again.",
        "If you still have trouble, clear cookies and sign in once more.",
        "You can also return home and continue as a guest.",
      ],
      primaryAction: "Sign in again",
      secondaryAction: "Go home",
    },
    network: {
      title: "Connection problem",
      body: "We couldn't reach the server. Please check your internet connection.",
      stepsTitle: "What to do",
      steps: [
        "Check that you have an active internet connection.",
        "Click Try again to retry the request.",
        "If the issue persists, wait a moment and refresh the page.",
      ],
      primaryAction: "Try again",
      secondaryAction: "Go home",
    },
    degraded: {
      title: "This section has no data right now",
      body: "The rest of the page is fine - we just couldn't fetch this list in time.",
      stepsTitle: "What to do",
      steps: [
        "Click Try again - the data usually comes back immediately.",
        "You can also refresh the page in a moment.",
        "The rest of the page is complete and ready to use.",
      ],
      primaryAction: "Try again",
      secondaryAction: "Go home",
    },
    degradedEyebrow: "Page loaded",
    needHelp: "Need help?",
    contactLink: "Contact support",
    goBack: "Go back",
    keepGoing: "Keep going",
    generic: {
      title: "This page didn't load",
      body: "Something went wrong on our end. We're sorry for the inconvenience.",
      stepsTitle: "What to do",
      steps: [
        "Click Try again to retry the request.",
        "If that doesn't help, go back to the home page.",
        "You can also contact us if the error keeps happening.",
      ],
      primaryAction: "Try again",
      secondaryAction: "Go home",
    },
  },
};

export type ErrorKind = "unauthorized" | "sessionExpired" | "network" | "degraded" | "generic";

/**
 * Znacznik renderu zdegradowanego. `classifyError` rozpoznaje go po polu
 * `kind`, a nie po treści komunikatu - degradacja jest stanem, który zgłasza
 * sama aplikacja, więc nie ma sensu zgadywać jej z tekstu błędu.
 */
export const DEGRADED_ERROR = Object.freeze({ kind: "degraded" as const });

export function errorCopy(): ErrorCopy {
  return COPY[currentLang() === "pl" ? "pl" : "en"];
}

/**
 * Classifies an error thrown by TanStack Router / server functions into a
 * user-friendly scenario. We never inspect raw messages for visitors; this
 * mapping is only used to pick the right copy and icon.
 */
export function classifyError(error: unknown): ErrorKind {
  if (!error || typeof error !== "object") return "generic";

  const e = error as Record<string, unknown>;
  // Degradacja jest zgłaszana jawnie przez aplikację (DEGRADED_ERROR), więc
  // rozstrzygamy ją przed wszystkimi heurystykami po treści komunikatu.
  if (e.kind === "degraded") return "degraded";

  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.statusCode === "number"
        ? e.statusCode
        : undefined;

  if (status === 401) return "unauthorized";
  if (status === 302 || status === 307 || status === 308) return "sessionExpired";

  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (message.includes("unauthorized") || message.includes("auth") || message.includes("session")) {
    return message.includes("expired") ? "sessionExpired" : "unauthorized";
  }

  // Uwaga: sam `name === "TypeError"` NIE wystarcza za sygnał sieciowy.
  // Większość błędów renderu Reacta ("Cannot read properties of undefined")
  // to też TypeError - pokazywanie im karty "Problem z połączeniem / sprawdź
  // internet" wysyłało diagnozę w maliny. Prawdziwe błędy sieciowe fetch()
  // rozpoznajemy po komunikacie: Chrome "Failed to fetch", Safari
  // "Load failed", Firefox "NetworkError when attempting to fetch resource".
  // Nieudany lazy-load chunka trasy ma własne komunikaty per przeglądarka:
  // Chrome "Failed to fetch dynamically imported module", Firefox "error
  // loading dynamically imported module", Safari "Importing a module script
  // failed" - dwa ostatnie nie zawierają ani "fetch", ani "load failed".
  if (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("timeout") ||
    message.includes("abort")
  ) {
    return "network";
  }

  return "generic";
}
