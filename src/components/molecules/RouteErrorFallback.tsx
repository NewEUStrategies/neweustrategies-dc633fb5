// Wspólny errorComponent dla route'ów (atomic design: molecule).
// Deleguje do FriendlyErrorPage, więc wszystkie błędy loaderów/route'ów
// wyglądają identycznie i zawierają instrukcję „co kliknąć”.
import { useEffect } from "react";
import { type ErrorComponentProps } from "@tanstack/react-router";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";

interface RouteErrorFallbackProps extends ErrorComponentProps {
  /** Opcjonalny nagłówek nad komunikatem błędu (np. "Nie udało się załadować profilu"). */
  title?: string;
  /** "page" = pełnoekranowy publiczny layout, "admin" = kompaktowy panelowy. */
  variant?: "page" | "admin";
}

export function RouteErrorFallback({
  error,
  reset,
  title,
  variant = "page",
}: RouteErrorFallbackProps) {
  // Raw error.message is never shown to visitors - it is logged/reported only.
  useEffect(() => {
    if (error) console.error("[RouteError]", error);
  }, [error]);

  return (
    <FriendlyErrorPage
      error={error}
      reset={reset}
      title={title}
      variant={variant === "admin" ? "compact" : "page"}
    />
  );
}
