/**
 * Organizm: panel uzgodnienia liczb - wejście warstwy semantycznej do panelu admina.
 *
 * Jedno wywołanie `getSemanticSnapshot` pobiera WSZYSTKIE strumienie dla JEDNEGO
 * okna, więc panel nie może pokazać dwóch liczb policzonych na dwóch różnych
 * przedziałach czasu. Kolejność sekcji jest celowa:
 *
 *   1. okno pomiaru (bez niego żadna liczba nie ma sensu),
 *   2. metryki kanoniczne z werdyktem uzgodnienia,
 *   3. metryki złożone (licznik i mianownik z jednego strumienia),
 *   4. dostępność strumieni (czego w liczbach nie ma),
 *   5. interpretacja i rekomendacje w znanym prymitywie `InsightSection`,
 *   6. słownik metryk (zwinięty - referencja, nie treść pierwszego planu).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import "@/lib/i18n-admin-semantic";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, RefreshCw, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  metricById,
  needsAttention,
  resolveWindow,
  type MetricId,
  type WindowPresetId,
} from "@/lib/analytics/semantic";
import { useCurrentTenantId } from "@/lib/tenant";
import { chartLangOf, formatMetricValue } from "@/lib/analytics/semantic/format";
import { getSemanticSnapshot } from "@/lib/analytics/semantic/snapshot.functions";
import { InsightSection } from "@/components/admin/analytics/InsightSection";
import { MetricDefinitionPopover } from "../molecules/MetricDefinitionPopover";
import { ReconciliationRow } from "../molecules/ReconciliationRow";
import { StreamHealthGrid } from "../molecules/StreamHealthGrid";
import { WindowProvenance } from "../molecules/WindowProvenance";
import { buildSemanticInsights } from "../semanticInsights";
import { MetricDictionary } from "./MetricDictionary";

/** Presety dostępne w panelu. `24h` świadomie pominięty - nie da się na nim uzgadniać. */
const PRESETS = [
  { id: "7d", labelKey: "adminAnalytics.timeRange.preset7d" },
  { id: "28d", labelKey: "adminAnalytics.timeRange.preset28d" },
  { id: "30d", labelKey: "adminAnalytics.timeRange.preset30d" },
  { id: "90d", labelKey: "adminAnalytics.timeRange.preset90d" },
] as const satisfies ReadonlyArray<{ id: WindowPresetId; labelKey: string }>;

type PanelPresetId = (typeof PRESETS)[number]["id"];

export function SemanticReconciliationPanel() {
  const { t, i18n } = useTranslation();
  const lang = chartLangOf(i18n.language);
  const [presetId, setPresetId] = useState<PanelPresetId>("28d");
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const fetchSnapshot = useServerFn(getSemanticSnapshot);
  const tenantId = useCurrentTenantId();

  const query = useQuery({
    // Warsztat W KLUCZU, nie tylko w RLS: `QueryClient` stoi w korzeniu
    // aplikacji i PRZEŻYWA zmianę warsztatu, a przy stałym
    // `["semantic-snapshot", presetId]` panel warsztatu B dostawał migawkę
    // warsztatu A z cache (`staleTime: 60_000`) i nie wysyłał ani jednego
    // zapytania. Taki wyciek jest cichy: nie widać go w ruchu sieciowym, tylko
    // na ekranie. Warsztat NIE JEDZIE do funkcji serwerowej - ta bierze go z
    // profilu wywołującego; tutaj rozdziela wyłącznie wpisy cache.
    queryKey: ["semantic-snapshot", tenantId ?? "", presetId],
    queryFn: () => fetchSnapshot({ data: { presetId } }),
    staleTime: 60_000,
    enabled: Boolean(tenantId),
  });

  // Okno lokalne dla `WindowProvenance` w stanie wczytywania: ten sam resolwer,
  // więc nagłówek nie „skacze” po dojściu odpowiedzi z serwera.
  const optimisticWindow = useMemo(() => resolveWindow({ presetId }), [presetId]);

  const snapshot = query.data;
  // Nierozwiązany warsztat to nadal ODCZYT W TOKU, nie „brak migawki”:
  // zapytanie jest wtedy wstrzymane, więc bez tego składnika panel ogłaszałby
  // pustkę, zanim w ogóle zdążył o cokolwiek zapytać.
  const loading = query.isLoading || !tenantId;

  const insights = useMemo(
    () => (snapshot ? buildSemanticInsights({ snapshot, t, language: i18n.language }) : []),
    [snapshot, t, i18n.language],
  );

  const deltaByMetric = useMemo(() => {
    const map = new Map<MetricId, number | null>();
    for (const d of snapshot?.deltas ?? []) map.set(d.metricId, d.deltaPct);
    return map;
  }, [snapshot]);

  const orderedEntries = useMemo(() => {
    const entries = [...(snapshot?.entries ?? [])];
    // Najpierw to, co wymaga decyzji, potem reszta w kolejności słownika.
    return entries.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
  }, [snapshot]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-none flex items-center gap-2">
              <Scale className="h-4 w-4 shrink-0 text-primary" />
              {t("adminAnalytics.semantic.panelTitle")}
            </h2>
            <p className="mt-1.5 max-w-prose text-xs text-muted-foreground">
              {t("adminAnalytics.semantic.panelSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={presetId} onValueChange={(v) => setPresetId(v as PanelPresetId)}>
              {/* Rola `combobox` NIE wylicza nazwy z zawartości, więc widoczne
                  „28 dni” samo nie staje się nazwą dostępną. To jedyny element
                  panelu, który zmienia okno WSZYSTKICH liczb - bez nazwy czytnik
                  ogłaszałby puste pole listy. */}
              <SelectTrigger
                aria-label={t("adminAnalytics.semantic.window.title")}
                className="h-8 w-28 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {t(p.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {query.isFetching ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3 w-3" />
              )}
              {t("adminAnalytics.common.refresh")}
            </Button>
          </div>
        </div>
      </Card>

      <WindowProvenance
        window={snapshot?.window ?? optimisticWindow}
        previous={snapshot?.previous}
      />

      {loading ? (
        <Card className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("adminAnalytics.common.loadingData")}
        </Card>
      ) : !snapshot ? (
        <Card className="p-6 text-xs text-muted-foreground">
          {t("adminAnalytics.semantic.empty")}
        </Card>
      ) : (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold leading-none">
                {t("adminAnalytics.semantic.canonicalLabel")}
              </h3>
              {snapshot.ga4Error ? (
                <span className="text-[11px] text-destructive">{snapshot.ga4Error}</span>
              ) : null}
            </div>
            <ul className="space-y-2">
              {orderedEntries.map((entry) => (
                <ReconciliationRow
                  key={entry.metricId}
                  entry={entry}
                  deltaPct={deltaByMetric.get(entry.metricId)}
                />
              ))}
            </ul>
          </Card>

          <Card className="p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold leading-none">
                {t("adminAnalytics.semantic.ratios.title")}
              </h3>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t("adminAnalytics.semantic.ratios.subtitle")}
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {snapshot.ratios.map((ratio) => {
                const metric = metricById(ratio.metricId);
                return (
                  <li
                    key={ratio.metricId}
                    className="rounded-md border border-border bg-muted/20 p-2.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">
                        {i18n.language?.toLowerCase().startsWith("en")
                          ? metric.labelEn
                          : metric.labelPl}
                      </span>
                      <MetricDefinitionPopover metricId={ratio.metricId} />
                    </div>
                    <div className="mt-1 text-lg font-semibold tabular-nums leading-tight">
                      {formatMetricValue(
                        ratio.value,
                        metric.unit,
                        lang,
                        t("adminAnalytics.semantic.ratios.undefinedValue"),
                      )}
                    </div>
                    {ratio.value === null && ratio.reason ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">{ratio.reason}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          <StreamHealthGrid streams={snapshot.streams} />

          <InsightSection
            title={t("adminAnalytics.semantic.panelTitle")}
            subtitle={t("adminAnalytics.semantic.panelSubtitle")}
            insights={insights}
          />

          <Card className="p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setDictionaryOpen((v) => !v)}
              aria-expanded={dictionaryOpen}
              className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm font-semibold transition-colors hover:bg-muted/40"
            >
              {t("adminAnalytics.semantic.dictionary.title")}
              <ChevronDown
                className={
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
                  (dictionaryOpen ? "rotate-180" : "")
                }
              />
            </button>
            {dictionaryOpen ? (
              <div className="border-t border-border">
                <MetricDictionary />
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
