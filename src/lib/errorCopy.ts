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
  errorTitle: string;
  errorBody: string;
  tryAgain: string;
  goHome: string;
  unauthorized: ErrorScenario;
  sessionExpired: ErrorScenario;
  network: ErrorScenario;
  generic: ErrorScenario;
};

const COPY: Record<"pl" | "en", ErrorCopy> = {
  pl: {
    notFoundTitle: "Nie znaleziono strony",
    notFoundBody: "Strona, której szukasz, nie istnieje lub została przeniesiona.",
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

export type ErrorKind = "unauthorized" | "sessionExpired" | "network" | "generic";

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

  if (
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network") ||
    message.includes("fetch") ||
    e.name === "TypeError" ||
    message.includes("timeout") ||
    message.includes("abort")
  ) {
    return "network";
  }

  return "generic";
}
