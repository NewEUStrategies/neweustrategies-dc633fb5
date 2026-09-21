/**
 * Molekuła: definicja metryki kanonicznej dostępna przy KAŻDEJ liczbie.
 *
 * Sedno warstwy semantycznej po stronie UX: obok liczby stoi ikona, pod którą
 * jest jedno obowiązujące zdanie definicji, wzór ze strumienia autorytatywnego
 * oraz lista „czego nie wolno” (np. nie dziel emisji reklam przez odsłony stron).
 * Bez tego czytelnik raportu musiał zgadywać, którą z sześciu wersji „odsłony”
 * właśnie widzi.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { Info, ShieldAlert } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { type MetricId, metricById, streamById } from "@/lib/analytics/semantic";

export function MetricDefinitionPopover({
  metricId,
  className,
}: {
  metricId: MetricId;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  // `PopoverContent` Radiksa renderuje `role="dialog"`, a rola `dialog` NIE
  // wylicza nazwy z zawartości. Popover stoi przy KAŻDEJ liczbie panelu, więc
  // bez nazwy czytnik ogłaszałby serię nieodróżnialnych „okien dialogowych”.
  // Nazwa jest w drzewie - nagłówek metryki - trzeba ją tylko z okienkiem związać.
  const headingId = useId();
  const isEn = i18n.language?.toLowerCase().startsWith("en");
  const metric = metricById(metricId);
  const definition = isEn ? metric.definitionEn : metric.definitionPl;

  return (
    <Popover>
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
            {isEn ? metric.labelEn : metric.labelPl}
          </h4>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {t(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`)}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{definition}</p>

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
                    {isEn ? stream.labelEn : stream.labelPl}
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
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              {t("adminAnalytics.semantic.dictionary.colGuards")}
            </div>
            <ul className="space-y-1">
              {metric.guards.map((g, idx) => (
                <li key={idx} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  <span aria-hidden className="text-amber-500 leading-4">
                    !
                  </span>
                  <span className="leading-4">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
