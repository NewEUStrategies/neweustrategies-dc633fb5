// Wspólny errorComponent dla route'ów (atomic design: molecule).
// Nazwany komponent (wielka litera) zamiast inline'owej strzałki w opcjach
// route'a - React wymaga, by hooki (useRouter) były wywoływane w komponencie,
// nie w dowolnej funkcji (rules-of-hooks). "Spróbuj ponownie" invaliduje
// loadery routera i resetuje granicę błędu.
import { useEffect } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { errorCopy } from "@/lib/errorCopy";

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
  const router = useRouter();
  const copy = errorCopy();
  // Raw error.message is never shown to visitors - it is logged/reported only.
  useEffect(() => {
    if (error) console.error("[RouteError]", error);
  }, [error]);
  const retry = () => {
    void router.invalidate();
    reset();
  };

  if (variant === "admin") {
    return (
      <div className="p-8">
        <h1 className="font-display text-xl mb-1">{title ?? copy.errorTitle}</h1>
        <p className="text-sm text-muted-foreground">{copy.errorBody}</p>
        <Button variant="outline" className="mt-3" onClick={retry}>
          {copy.tryAgain}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="font-display text-2xl">{title ?? copy.errorTitle}</h1>
        <p className="text-sm text-muted-foreground mt-2">{copy.errorBody}</p>
        <button
          onClick={retry}
          className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
        >
          {copy.tryAgain}
        </button>
      </main>
    </div>
  );
}
