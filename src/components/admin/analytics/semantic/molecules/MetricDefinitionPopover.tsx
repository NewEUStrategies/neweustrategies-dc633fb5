/**
 * Molekuła: definicja metryki kanonicznej dostępna przy KAŻDEJ liczbie.
 *
 * Sedno warstwy semantycznej po stronie UX: obok liczby stoi ikona, pod którą
 * jest jedno obowiązujące zdanie definicji, wzór ze strumienia autorytatywnego
 * oraz lista „czego nie wolno” (np. nie dziel emisji reklam przez odsłony stron).
 * Bez tego czytelnik raportu musiał zgadywać, którą z sześciu wersji „odsłony”
 * właśnie widzi.
 *
 * TREŚĆ Z `metricHelp` (SPEC §5.5) - to samo źródło co dymek wykresu, kafel
 * KPI i słownik, więc etykieta i definicja nie mogą się rozjechać między
 * ekranami. Popover zostaje SZYBKI (rejestr w kodzie, zero zapytań); pełne
 * objaśnienie z benchmarkiem, dźwigniami i źródłami otwiera „Więcej” w
 * arkuszu bocznym - dopiero ono pobiera treść grupy z serwera.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { Info, ShieldAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type MetricId, metricById, streamById } from "@/lib/analytics/semantic";
import { bi } from "@/lib/analytics/semantic/benchmarks/adapter";
import { metricHelp } from "@/lib/analytics/semantic/metricHelp";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { MetricExplainerBody } from "./MetricExplainer";

export function MetricDefinitionPopover({
  metricId,
  className,
}: {
  metricId: MetricId;
  className?: string;
}) {
  ensureShellI18n();
  const { t, i18n } = useTranslation();
  // `PopoverContent` Radiksa renderuje `role="dialog"`, a rola `dialog` NIE
  // wylicza nazwy z zawartości. Popover stoi przy KAŻDEJ liczbie panelu, więc
  // bez nazwy czytnik ogłaszałby serię nieodróżnialnych „okien dialogowych”.
  // Nazwa jest w drzewie - nagłówek metryki - trzeba ją tylko z okienkiem związać.
  const headingId = useId();
  const fullHeadingId = useId();
  const lang = chartLangFrom(i18n.language);
  const metric = metricById(metricId);
  const help = metricHelp(metricId, lang);
  const [open, setOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("adminAnalytics.semantic.showDefinition")}
            className={
              "inline-flex items-center justify-center h-4 w-4 shrink-0 rounded-full text-muted-foreground " +
              "transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 " +
              "focus-visible:ring-ring " +
              (className ?? "")
            }
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-labelledby={headingId}
          className="w-[min(22rem,calc(100vw-2rem))] p-3 space-y-2.5"
        >
          <div className="flex items-start justify-between gap-2">
            <h4 id={headingId} className="text-sm font-semibold leading-5">
              {help.expansion}
            </h4>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {t(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`)}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">{help.measures}</p>

          <div className="space-y-1.5">
            {metric.bindings.map((b) => {
              const stream = streamById(b.streamId);
              return (
                <div
                  key={`${metricId}-${b.streamId}`}
                  className={
                    "rounded-md border p-2 text-[11px] leading-relaxed " +
                    (b.role === "authoritative"
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-muted/30")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">
                      {bi({ pl: stream.labelPl, en: stream.labelEn }, lang)}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                      {b.role === "authoritative"
                        ? t("adminAnalytics.semantic.authoritative")
                        : t("adminAnalytics.semantic.corroborating")}
                    </span>
                  </div>
                  <code className="mt-1 block break-words font-mono text-[10px] text-muted-foreground">
                    {b.formula}
                  </code>
                </div>
              );
            })}
          </div>

          {metric.guards.length > 0 ? (
            <div className="space-y-1 border-t border-border pt-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                <ShieldAlert className="h-3.5 w-3.5 text-brand" />
                {t("adminAnalytics.semantic.dictionary.colGuards")}
              </div>
              <ul className="space-y-1">
                {metric.guards.map((g, idx) => (
                  <li key={idx} className="flex gap-1.5 text-[11px] text-muted-foreground">
                    <span aria-hidden className="text-brand leading-4">
                      !
                    </span>
                    <span className="leading-4">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-t border-border pt-2">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-semibold"
              onClick={() => {
                setOpen(false);
                setFullOpen(true);
              }}
            >
              {t("adminRevenue.benchmark.explainer.more")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {/* Arkusz montuje treść dopiero po otwarciu - dopiero wtedy rusza
          zapytanie o benchmark (popover pozostaje bez I/O). */}
      <Sheet open={fullOpen} onOpenChange={setFullOpen}>
        <SheetContent
          side="right"
          aria-labelledby={fullHeadingId}
          aria-describedby={undefined}
          className="w-full overflow-y-auto sm:max-w-lg"
        >
          <MetricExplainerBody
            metricId={metricId}
            lang={lang}
            mode="full"
            headingId={fullHeadingId}
            heading="sheet"
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
