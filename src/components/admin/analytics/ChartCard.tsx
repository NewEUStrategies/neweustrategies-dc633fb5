/**
 * Wrapper for every BI chart on /admin/analytics. Owns:
 * - Title / subtitle / badge slot
 * - Full-screen toggle (uses the Fullscreen API when available, falls back to a
 *   fixed-position overlay so it still works in browsers that block it)
 * - CSV + PNG export (delegates to ./exportChart; the ECharts instance is
 *   captured through EChart's onReady callback)
 *
 * The card keeps chart state internal - parent components pass an `option`
 * plus optional export data. That contract lets the same shell wrap any
 * ECharts option (bar, line, treemap, radar, ...) without knowing the shape.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, Maximize2, Minimize2, MoreHorizontal } from "lucide-react";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import { EChart } from "./EChart";
import { exportCsv, exportPng } from "./exportChart";
import { ChartDrillDialog, type ChartClickParams, type ChartDrillDetail } from "./ChartDrillDialog";
import { ChartDataTable, hasChartTableData } from "./ChartDataTable";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  option: EChartsCoreOption;
  height?: number;
  /** Optional CSV export data. When omitted the CSV item is hidden. */
  csv?: { filename: string; headers: string[]; rows: readonly (readonly unknown[])[] };
  /** Filename for PNG export (defaults to a slug of `title`). */
  pngName?: string;
  className?: string;
  /** Extra content rendered below the chart (e.g. footer chips, legend). */
  footer?: ReactNode;
  themeVersion?: number;
  /**
   * Map an ECharts click event to a drill-down payload. When it returns a
   * non-null detail, the card opens a dialog with title / date / URL /
   * description / metrics / links. Returning `null` skips the dialog (useful
   * for elements that carry no drillable context, e.g. threshold markLines).
   */
  onDataClick?: (params: ChartClickParams) => ChartDrillDetail | null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function ChartCard({
  title,
  subtitle,
  badge,
  option,
  height = 300,
  csv,
  pngName,
  className,
  footer,
  themeVersion,
  onDataClick,
}: ChartCardProps) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const [drill, setDrill] = useState<ChartDrillDetail | null>(null);
  // useId, nie slug(title): na /admin/analytics stoi kilkanascie kart, a dwie
  // moga miec ten sam tytul w roznych sekcjach - zduplikowany id rozjechalby
  // powiazanie aria-describedby.
  const tableId = `${useId()}-chart-data`;
  // Jeden predykat dla atrybutu i dla renderu - inaczej przy zerowym zbiorze
  // (pulpit w trakcie ladowania, raport bez wynikow) `aria-describedby`
  // wskazywalby element, ktorego nie ma.
  const showTable = hasChartTableData(csv);
  const instanceRef = useRef<ECharts | null>(null);

  const handleReady = useCallback((inst: ECharts) => {
    instanceRef.current = inst;
  }, []);

  const doPng = useCallback(() => {
    exportPng(pngName ?? slug(title), instanceRef.current);
  }, [pngName, title]);

  const doCsv = useCallback(() => {
    if (csv) exportCsv(csv.filename, csv.headers, csv.rows);
  }, [csv]);

  const handleClick = useCallback(
    (params: ChartClickParams) => {
      if (!onDataClick) return;
      const detail = onDataClick(params);
      if (detail) setDrill(detail);
    },
    [onDataClick],
  );

  return (
    <Card
      className={
        (full
          ? "fixed inset-3 z-50 flex flex-col overflow-hidden shadow-2xl"
          : "flex flex-col overflow-hidden ") + (className ?? "")
      }
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-border/60">
        <div className="min-w-0">
          <div className="text-sm font-semibold flex items-center gap-2">
            <span className="truncate">{title}</span>
            {badge}
          </div>
          {subtitle ? (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</div>
          ) : null}
          {onDataClick ? (
            <div className="text-[10px] text-muted-foreground/80 mt-0.5">
              {t("adminAnalytics.drillDialog.hint")}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Popover>
            <PopoverTrigger asChild>
              {/* Wyzwalacz to sama ikona „trzech kropek" - bez `aria-label`
                  czytnik ekranu ogłaszałby jedyne wejście do eksportu PNG i CSV
                  jako bezimienny „przycisk". Nazwa idzie ze słownika, tak samo
                  jak w sąsiednim przełączniku pełnego ekranu. */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={t("adminAnalytics.chartCard.exportMenu")}
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            {/* Radiksowy `PopoverContent` renderuje `role="dialog"`; rola okna
                bez nazwy jest ogłaszana jako samo „dialog", więc menu dostaje
                tę samą nazwę co jego wyzwalacz. */}
            <PopoverContent
              align="end"
              className="w-44 p-1"
              aria-label={t("adminAnalytics.chartCard.exportMenu")}
            >
              <button
                type="button"
                onClick={doPng}
                className="w-full text-left flex items-center px-2 py-1.5 text-sm rounded hover:bg-accent"
              >
                <Download className="w-3.5 h-3.5 mr-2" /> {t("adminAnalytics.chartCard.exportPng")}
              </button>
              {csv ? (
                <button
                  type="button"
                  onClick={doCsv}
                  className="w-full text-left flex items-center px-2 py-1.5 text-sm rounded hover:bg-accent"
                >
                  <Download className="w-3.5 h-3.5 mr-2" />{" "}
                  {t("adminAnalytics.chartCard.exportCsv")}
                </button>
              ) : null}
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setFull((v) => !v)}
            aria-label={
              full
                ? t("adminAnalytics.chartCard.exitFullscreen")
                : t("adminAnalytics.chartCard.fullscreen")
            }
          >
            {full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      {/* Region wykresu jest OPISANY, bo ECharts renderuje do kanwy - dla
          czytnika ekranu to pusty prostokat. `role="img"` + nazwa z tytulu daje
          minimum („tu jest wykres X"), a `aria-describedby` prowadzi do tabeli
          z tymi samymi danymi, jesli karta je dostala. */}
      <div
        className="flex-1 p-2 min-h-0"
        role="img"
        aria-label={t("adminAnalytics.chartCard.chartRegion", { title })}
        aria-describedby={showTable ? tableId : undefined}
      >
        <EChart
          option={option}
          height={full ? "calc(100vh - 120px)" : height}
          onReady={handleReady}
          onDataClick={onDataClick ? handleClick : undefined}
          themeVersion={themeVersion}
        />
      </div>
      {showTable && csv ? (
        <ChartDataTable id={tableId} title={title} headers={csv.headers} rows={csv.rows} />
      ) : null}
      {footer ? (
        <div className="px-4 py-2 border-t border-border/60 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
      <ChartDrillDialog
        open={drill !== null}
        onOpenChange={(v) => !v && setDrill(null)}
        detail={drill}
      />
    </Card>
  );
}
