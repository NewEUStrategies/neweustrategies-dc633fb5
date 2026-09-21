/**
 * RAMA KAŻDEGO WYKRESU BI w /admin/analytics. Trzyma tytuł, podtytuł i odznakę,
 * przełącznik pełnego ekranu, eksport (PNG + CSV) i okno szczegółów po
 * wskazaniu elementu.
 *
 * CO SIĘ ZMIENIŁO I DLACZEGO. Karta rysowała wcześniej przez ECharts, czyli
 * przez DRUGI silnik wykresów - obok tego, który powstał wobec specyfikacji.
 * Panel admina dostawał więc inną paletę, inną geometrię i inne zasady
 * interakcji niż wykres we wpisie: pierścień z legendą zamiast tabeli klucza,
 * brak wariantów wypełnienia słupka, brak przerwy na osi pierścienia. Karta
 * przyjmuje teraz `ChartConfig` i rysuje przez `<Chart>`, więc panel i wpis
 * mówią jednym językiem wizualnym.
 *
 * CZEGO KARTA JUŻ NIE ROBI: nie rysuje własnej tabeli danych. Silnik rysuje ją
 * sam przy KAŻDYM rodzaju (sekcja 8: grafika nigdy nie jest jedyną drogą do
 * liczby), więc druga tabela pod tą samą kartą byłaby tymi samymi liczbami
 * dwa razy. `csv` zostaje - ale wyłącznie jako ŹRÓDŁO EKSPORTU, bo plik bywa
 * bogatszy od rysunku (kolumny, których wykres nie koduje).
 *
 * NIE USTAWIA TEŻ `role="img"` NA SWOIM KONTENERZE. Robił to, bo kanwa ECharts
 * jest dla czytnika ekranu pustym prostokątem; nasz silnik oddaje rysunek
 * z własną nazwą i opisem obsługi, a druga rola „obrazek" wokół niego
 * ogłaszałaby ten sam wykres dwa razy.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, Maximize2, Minimize2, MoreHorizontal } from "lucide-react";
import { Chart } from "@/components/charts/Chart";
import type { ChartConfig } from "@/lib/charts/types";
import { chartLangFrom } from "@/lib/charts/format";
import type { ChartSelection } from "@/lib/charts/selection";
import { exportCsv, exportPng } from "./exportChart";
import { ChartDrillDialog, type ChartDrillDetail } from "./ChartDrillDialog";

export interface ChartCardProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  /**
   * Konfiguracja dla silnika. Tytuł i opis zostają PUSTE - nagłówek rysuje
   * karta, a rama silnika pominęłaby swój własny tylko wtedy, gdy są puste;
   * dwa nagłówki nad jednym rysunkiem to nie jest ozdoba, tylko szum.
   */
  config: ChartConfig;
  height?: number;
  /** Dane eksportu CSV. Bez nich pozycja CSV w menu nie istnieje. */
  csv?: { filename: string; headers: string[]; rows: readonly (readonly unknown[])[] };
  /** Nazwa pliku PNG; domyślnie slug tytułu. */
  pngName?: string;
  className?: string;
  /** Treść pod rysunkiem (odznaki, przypisy panelu). */
  footer?: ReactNode;
  /**
   * Zamiana WSKAZANIA na ładunek okna szczegółów. Zwrócony `null` znaczy
   * „ten element nie ma czego pokazać" i okno się nie otwiera.
   */
  onDataClick?: (selection: ChartSelection) => ChartDrillDetail | null;
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
  config,
  height = 300,
  csv,
  pngName,
  className,
  footer,
  onDataClick,
}: ChartCardProps) {
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const [full, setFull] = useState(false);
  const [drill, setDrill] = useState<ChartDrillDetail | null>(null);
  // Kontener rysunku - stąd eksport bierze WĘZEŁ SVG. Nie ma innej drogi:
  // silnik nie wystawia uchwytu do swojego rysunku i nie powinien, bo to jest
  // szczegół implementacji renderu, a nie część jego umowy.
  const plotRef = useRef<HTMLDivElement | null>(null);

  // Wysokość jedzie PRZEZ KONFIGURACJĘ, a nie stylem kontenera: silnik liczy
  // z niej geometrię (pasma, odstępy, próg etykiety w łuku), więc rysunek
  // rozciągnięty CSS-em rozjechałby się z własnymi obliczeniami.
  const configZWysokoscia = useMemo<ChartConfig>(
    () => ({ ...config, title: "", description: "", height: full ? 560 : height }),
    [config, full, height],
  );

  const doPng = useCallback(() => {
    void exportPng(pngName ?? slug(title), plotRef.current);
  }, [pngName, title]);

  const doCsv = useCallback(() => {
    if (csv) exportCsv(csv.filename, csv.headers, csv.rows);
  }, [csv]);

  const handleSelect = useCallback(
    (selection: ChartSelection) => {
      if (!onDataClick) return;
      const detail = onDataClick(selection);
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
                  jako bezimienny „przycisk". */}
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
      <div className="flex-1 p-2 min-h-0 overflow-auto" ref={plotRef}>
        <Chart
          config={configZWysokoscia}
          lang={lang}
          // NAZWA RYSUNKU Z TYTUŁU KARTY. Konfiguracja ma tytuł pusty, żeby nie
          // było go dwa razy - bez tej właściwości wszystkie wykresy pulpitu
          // nazywałyby się „Wykres", czyli czytnik ekranu ogłaszałby dziesięć
          // nierozróżnialnych obrazków.
          ariaLabel={t("adminAnalytics.chartCard.chartRegion", { title })}
          onSelect={onDataClick ? handleSelect : undefined}
        />
      </div>
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
