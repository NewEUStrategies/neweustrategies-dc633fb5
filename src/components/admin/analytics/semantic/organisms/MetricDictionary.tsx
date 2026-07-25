/**
 * Organizm: słownik metryk kanonicznych.
 *
 * Jedno miejsce, w którym da się sprawdzić, co dana nazwa ZNACZY, z jakiego
 * strumienia pochodzi i czego z nią nie wolno zrobić. Renderowany z rejestru w
 * kodzie, więc nie może rozjechać się z definicjami używanymi do liczenia -
 * to jest różnica między słownikiem a dokumentem w intranecie.
 *
 * Responsywność: tabela przewija się poziomo we własnym kontenerze, więc strona
 * nigdy nie dostaje paska poziomego.
 */
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-semantic";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { METRICS, streamById } from "@/lib/analytics/semantic";
import { StreamChip } from "../atoms/StreamChip";

export function MetricDictionary() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language?.toLowerCase().startsWith("en");

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold leading-none flex items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-primary" />
          {t("adminAnalytics.semantic.dictionary.title")}
        </h3>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("adminAnalytics.semantic.dictionary.subtitle")}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colMetric")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colDefinition")}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("adminAnalytics.semantic.dictionary.colSource")}
              </th>
              <th scope="col" className="py-2 font-medium">
                {t("adminAnalytics.semantic.dictionary.colGuards")}
              </th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => {
              const authoritative =
                metric.bindings.find((b) => b.role === "authoritative") ?? metric.bindings[0];
              return (
                <tr key={metric.id} className="border-b border-border/60 align-top">
                  <th scope="row" className="py-2.5 pr-3 font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{isEn ? metric.labelEn : metric.labelPl}</span>
                      <Badge variant="outline" className="w-fit text-[10px]">
                        {t(`adminAnalytics.semantic.dictionary.unit.${metric.unit}`)}
                      </Badge>
                    </div>
                  </th>
                  <td className="py-2.5 pr-3 text-muted-foreground">
                    <p className="leading-relaxed">
                      {isEn ? metric.definitionEn : metric.definitionPl}
                    </p>
                    <code className="mt-1 block break-words font-mono text-[10px]">
                      {authoritative.formula}
                    </code>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex flex-col items-start gap-1">
                      {metric.bindings.map((b) => (
                        <StreamChip key={b.streamId} streamId={b.streamId} role={b.role} />
                      ))}
                      <span className="text-[10px] text-muted-foreground">
                        {t(
                          `adminAnalytics.semantic.consentGate.${streamById(authoritative.streamId).consentGate}`,
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-muted-foreground">
                    <ul className="space-y-1">
                      {metric.guards.map((g, idx) => (
                        <li key={idx} className="flex gap-1.5">
                          <span aria-hidden className="leading-4 text-amber-500">
                            !
                          </span>
                          <span className="leading-4">{g}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
