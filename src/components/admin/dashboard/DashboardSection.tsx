// POWŁOKA SEKCJI PULPITU: nagłówek, odnośnik do zakładki-matki i TRZY STANY
// odczytu, których nie wolno mylić.
//
// "Ładowanie", "awaria odczytu" i "źródło jeszcze nie istnieje" prowadzą do
// trzech różnych decyzji operatora - odpowiednio: poczekaj, sprawdź połączenie,
// poczekaj na wdrożenie migracji. Sekcja, która w każdym z nich malowałaby
// zera, wysyłałaby człowieka szukać awarii ruchu tam, gdzie nie ma pomiaru.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface DashboardSectionProps {
  /**
   * Opcjonalny, bo sekcja bywa OSADZONA pod cudzym nagłówkiem (np. w zwijanym
   * panelu na /admin/crm). Pusty `<h2>` w takim miejscu dokładałby czytnikowi
   * ekranu bezimienny poziom w konspekcie dokumentu.
   */
  title?: string;
  subtitle?: string;
  /** Zakładka-matka, w której ta sama liczba żyje w pełnej rozdzielczości. */
  to?: string;
  linkLabel?: string;
  isPending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Funkcja agregująca nie istnieje jeszcze w tej bazie (migracja w drodze). */
  unavailable?: boolean;
  children: ReactNode;
  className?: string;
}

export function DashboardSection({
  title,
  subtitle,
  to,
  linkLabel,
  isPending,
  isError,
  onRetry,
  unavailable,
  children,
  className,
}: DashboardSectionProps) {
  const { t } = useTranslation();

  return (
    <section className={cn("space-y-2.5", className)} aria-busy={isPending || undefined}>
      {title || (to && linkLabel) ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-display text-base font-bold leading-tight">{title}</h2>
            ) : null}
            {subtitle ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
            ) : null}
          </div>
          {to && linkLabel ? (
            <Button asChild variant="ghost" size="sm" className="h-7 text-xs gap-1 shrink-0">
              <Link to={to}>
                {linkLabel}
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {isPending ? (
        <div
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          {t("adminDashboard.state.loading")}
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-md border border-border bg-card p-3 text-xs flex flex-wrap items-center gap-2"
        >
          <AlertTriangle
            className="w-4 h-4 shrink-0 text-[var(--chart-negative-text)]"
            aria-hidden="true"
          />
          <span>{t("adminDashboard.state.error")}</span>
          {onRetry ? (
            <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={onRetry}>
              {t("adminDashboard.state.retry")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {unavailable ? (
            // `role="status"`, nie `alert`: brak migracji nie jest awarią,
            // tylko stanem przejściowym wdrożenia.
            <div
              role="status"
              className="rounded-md border border-dashed border-border bg-muted/40 p-2.5 text-[11px]"
            >
              <span className="font-medium">{t("adminDashboard.state.sourceMissing")}</span>{" "}
              <span className="text-muted-foreground">
                {t("adminDashboard.state.sourceMissingHint")}
              </span>
            </div>
          ) : null}
          {children}
        </>
      )}
    </section>
  );
}
