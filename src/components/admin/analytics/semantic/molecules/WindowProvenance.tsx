/**
 * Molekuła: pochodzenie okna pomiaru.
 *
 * Pokazuje DOKŁADNE granice, ziarno, zakres wysłany do GA4, okno poprzednie oraz
 * listę zastrzeżeń. Bez tego admin porównujący naszą zakładkę GA4 z interfejsem
 * Google widział inne liczby (Google domyślnie dolicza dzień bieżący) i tracił
 * zaufanie do panelu, nie mając jak sprawdzić, skąd bierze się różnica.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { CalendarRange, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CanonicalWindow, WindowNote } from "@/lib/analytics/semantic";
import { isoDateOnly } from "@/lib/analytics/semantic/format";

/** Zastrzeżenia, które ZMIENIAJĄ interpretację liczb - reszta jest informacyjna. */
const WARNING_NOTES: ReadonlySet<WindowNote> = new Set<WindowNote>([
  "ga4_open_day",
  "instant_grain_not_available_in_ga4",
  "legacy_rpc_window_ends_now",
]);

/**
 * Tylko te pola okna są potrzebne do prezentacji. Zawężenie sprawia, że komponent
 * przyjmuje zarówno `CanonicalWindow` (klient), jak i `SemanticWindowDto`
 * (odpowiedź serwera) bez adapterów i bez rzutowań.
 */
export type WindowProvenanceWindow = Pick<
  CanonicalWindow,
  "sinceIso" | "untilIso" | "days" | "grain" | "crossStreamSafe" | "notes" | "ga4"
>;

export interface WindowProvenanceProps {
  window: WindowProvenanceWindow;
  /** Okno poprzednie - pokazywane, gdy panel liczy zmiany. */
  previous?: Pick<CanonicalWindow, "sinceIso" | "untilIso">;
  /** Zwięzły wariant: jedna linia bez karty (nagłówki dashboardów). */
  compact?: boolean;
  className?: string;
}

export function WindowProvenance({
  window,
  previous,
  compact = false,
  className,
}: WindowProvenanceProps) {
  const { t } = useTranslation();

  const range = t("adminAnalytics.semantic.window.range", {
    since: isoDateOnly(window.sinceIso),
    until: isoDateOnly(window.untilIso),
  });
  const grainLabel = t(
    window.grain === "day"
      ? "adminAnalytics.semantic.window.grainDay"
      : "adminAnalytics.semantic.window.grainInstant",
  );

  const safetyBadge = (
    <Badge
      variant="outline"
      className={
        "text-[10px] " +
        (window.crossStreamSafe
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400")
      }
    >
      {t(
        window.crossStreamSafe
          ? "adminAnalytics.semantic.window.safe"
          : "adminAnalytics.semantic.window.unsafe",
      )}
    </Badge>
  );

  if (compact) {
    return (
      <div
        className={
          "flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground " +
          (className ?? "")
        }
      >
        <span className="inline-flex items-center gap-1">
          <CalendarRange className="h-3 w-3 shrink-0" />
          {range}
        </span>
        <span aria-hidden>·</span>
        <span>{t("adminAnalytics.semantic.window.days", { count: window.days })}</span>
        <span aria-hidden>·</span>
        <span>{grainLabel}</span>
        {safetyBadge}
      </div>
    );
  }

  return (
    <Card className={"p-4 space-y-3 " + (className ?? "")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-none flex items-center gap-2">
            <CalendarRange className="h-4 w-4 shrink-0 text-primary" />
            {t("adminAnalytics.semantic.window.title")}
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {range} · {t("adminAnalytics.semantic.window.days", { count: window.days })} ·{" "}
            {grainLabel}
          </p>
        </div>
        {safetyBadge}
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">
        <div className="flex flex-wrap items-baseline gap-1.5">
          <dt className="text-muted-foreground">
            {t("adminAnalytics.semantic.window.ga4Range", {
              start: window.ga4.startDate,
              end: window.ga4.endDate,
            })}
          </dt>
        </div>
        {previous ? (
          <div className="flex flex-wrap items-baseline gap-1.5">
            <dt className="text-muted-foreground">
              {t("adminAnalytics.semantic.window.previous")}:
            </dt>
            <dd className="font-mono tabular-nums">
              {isoDateOnly(previous.sinceIso)} - {isoDateOnly(previous.untilIso)}
            </dd>
          </div>
        ) : null}
      </dl>

      {window.notes.length > 0 ? (
        <ul className="space-y-1.5 border-t border-border pt-2.5">
          {window.notes.map((note) => {
            const warn = WARNING_NOTES.has(note);
            const Icon = warn ? TriangleAlert : note === "excludes_open_day" ? CheckCircle2 : Info;
            return (
              <li key={note} className="flex gap-2 text-[11px] leading-4">
                <Icon
                  className={
                    "h-3.5 w-3.5 shrink-0 " +
                    (warn
                      ? "text-amber-500"
                      : note === "excludes_open_day"
                        ? "text-emerald-500"
                        : "text-sky-500")
                  }
                />
                <span className="text-muted-foreground">
                  {t(`adminAnalytics.semantic.windowNotes.${note}`)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
