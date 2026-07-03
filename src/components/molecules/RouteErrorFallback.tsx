// Wspólny errorComponent dla route'ów (atomic design: molecule).
// Nazwany komponent (wielka litera) zamiast inline'owej strzałki w opcjach
// route'a - React wymaga, by hooki (useRouter) były wywoływane w komponencie,
// nie w dowolnej funkcji (rules-of-hooks). "Spróbuj ponownie" invaliduje
// loadery routera i resetuje granicę błędu.
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

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
  const { t } = useTranslation();
  const router = useRouter();
  const retry = () => {
    void router.invalidate();
    reset();
  };

  if (variant === "admin") {
    return (
      <div className="p-8">
        {title ? <h1 className="font-display text-xl mb-1">{title}</h1> : null}
        <p className="text-sm text-destructive">{error.message}</p>
        <Button variant="outline" className="mt-3" onClick={retry}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
        {title ? <h1 className="font-display text-2xl">{title}</h1> : null}
        <p className={title ? "text-sm text-muted-foreground mt-2" : "text-sm text-destructive"}>
          {error.message}
        </p>
        <button
          onClick={retry}
          className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
        >
          {t("common.retry")}
        </button>
      </main>
    </div>
  );
}
