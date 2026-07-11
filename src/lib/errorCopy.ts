// Single source of bilingual copy for the "emergency" layer: 404 pages and
// error boundaries. These surfaces can render outside the i18next provider
// (root boundary, class ErrorBoundary), so they read `currentLang()` directly
// instead of useTranslation(). Raw error.message is deliberately never shown
// to visitors - it is logged/reported, not rendered.
import { currentLang } from "@/lib/i18n/localeRuntime";

type ErrorCopy = {
  notFoundTitle: string;
  notFoundBody: string;
  errorTitle: string;
  errorBody: string;
  tryAgain: string;
  goHome: string;
};

const COPY: Record<"pl" | "en", ErrorCopy> = {
  pl: {
    notFoundTitle: "Nie znaleziono strony",
    notFoundBody: "Strona, której szukasz, nie istnieje lub została przeniesiona.",
    errorTitle: "Nie udało się załadować strony",
    errorBody: "Coś poszło nie tak po naszej stronie. Odśwież stronę lub wróć na stronę główną.",
    tryAgain: "Spróbuj ponownie",
    goHome: "Strona główna",
  },
  en: {
    notFoundTitle: "Page not found",
    notFoundBody: "The page you're looking for doesn't exist or has been moved.",
    errorTitle: "This page didn't load",
    errorBody: "Something went wrong on our end. Try refreshing or head back home.",
    tryAgain: "Try again",
    goHome: "Go home",
  },
};

export function errorCopy(): ErrorCopy {
  return COPY[currentLang() === "pl" ? "pl" : "en"];
}
