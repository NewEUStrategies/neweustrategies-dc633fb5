// LEGENDA KARTOGRAMU - klucz koloru mapy danych (`ChoroplethMap.tsx`).
//
// TRZY POSTACI, jedna na rodzaj skali (`MapScale.kind` z `kinds/mapScale.ts`):
//   * SKALA CIĄGŁA - gradient między wartością najniższą a najwyższą
//     i dwie liczby po bokach (kształt legendy sprzed modelu skali, więc
//     opublikowane mapy nie zmieniają klucza). Przy zdegenerowanej domenie
//     (jeden region albo wszystkie wartości równe) jedna próbka i JEDNA
//     liczba - gradient obiecywałby zakres, w którym nikogo nie ma;
//   * KLASY - lista stopni rosnąco, każdy z próbką i przedziałem w formacie
//     jednostki („od 10 do 20 mld EUR"), plus nazwa metody podziału. Lista,
//     a nie pasek z podziałką: siedem granic z jednostką nie mieści się pod
//     paskiem w widgecie 320 px, a lista łamie się do nowego wiersza;
//   * SCHEMAT ROZBIEŻNY (ciągły albo klasowy) dostaje dodatkowo punkt
//     środkowy - kolor neutralny jest jedyną rzeczą, którą ten schemat mówi,
//     więc jego wartość musi stać w kluczu słowami.
// Do każdej z nich pozycja „brak danych" z próbką KRESKOWANĄ - tą samą,
// którą mapa kreskuje kraje bez wartości.
//
// Kolory idą wyłącznie przez tokeny (`colorOf` mapy i `MapScale.classes`),
// a geometria (próbka, odstępy, krój) jest taka sama w obu motywach - arkusz
// w `map.css`.
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MapScale } from "@/lib/charts/kinds/mapScale";
import type { MapMethod } from "@/lib/charts/types";
import { formatChartValue, type ChartLang } from "@/lib/charts/format";
import { classRangeLabel, MAP_METHOD_KEYS, MAP_NODATA_SWATCH, type MapT } from "./mapPaint";
import "@/lib/i18n-charts-map";

export interface MapLegendProps {
  scale: MapScale;
  /** Farba wartości - ta sama, którą mapa maluje kraj (z wyglądem opublikowanym). */
  colorOf: (value: number) => string;
  method: MapMethod;
  lang: ChartLang;
  unit: string;
  /** Pozycja „brak danych" - gdy na mapie jest kraj bez wartości. */
  showNoData: boolean;
}

/**
 * Farba próbki i paska jako WŁASNOŚĆ NIESTANDARDOWA, którą czyta arkusz
 * (`background: var(--neh-map-swatch)` w `map.css`). Nie `style.background`
 * wprost: przeglądarka przyjmuje `color-mix()` w tle bez kłopotu, ale parser
 * stylów, który odrzuca nieznaną funkcję w skrócie `background`, gubił całe
 * tło po cichu - a własności niestandardowej nikt nie waliduje.
 */
function paint(name: "--neh-map-swatch" | "--neh-map-bar", value: string): CSSProperties {
  return { [name]: value } as CSSProperties;
}

export function MapLegend({ scale, colorOf, method, lang, unit, showNoData }: MapLegendProps) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "chartsMap" });
  const t: MapT = (key, values) => scoped(key, { lng: lang, ...values });
  if (scale.classes.length === 0) return null;

  const [lo, hi] = scale.domain;
  const span = hi - lo;
  const single = span <= 0;
  const fmt = (value: number): string => formatChartValue(value, lang, unit);

  let body: ReactNode;
  if (scale.kind === "continuous") {
    // Przystanki gradientu w POŁOŻENIU wartości - w schemacie rozbieżnym
    // środek nie leży w połowie paska, tylko tam, gdzie leży w domenie.
    const stops = scale.classes
      .map((s) => `${colorOf(s.from)} ${span > 0 ? Math.round(((s.from - lo) / span) * 100) : 0}%`)
      .join(", ");
    body = (
      <div className="neh-map-legend-scale flex items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">{fmt(lo)}</span>
        <span
          aria-hidden
          className={
            single
              ? "neh-map-legend-bar h-2 w-6 rounded-full"
              : "neh-map-legend-bar h-2 flex-1 max-w-[240px] rounded-full"
          }
          style={paint(
            "--neh-map-bar",
            single ? colorOf(lo) : `linear-gradient(to right, ${stops})`,
          )}
        />
        {!single && <span className="text-xs tabular-nums text-muted-foreground">{fmt(hi)}</span>}
      </div>
    );
  } else {
    body = (
      <>
        <ol className="neh-map-legend-classes">
          {scale.classes.map((c, i) => (
            <li key={i} className="neh-map-legend-item" data-map-class={i}>
              <span
                aria-hidden
                className="neh-map-swatch"
                style={paint("--neh-map-swatch", c.color)}
              />
              <span className="tabular-nums">{classRangeLabel(t, c.from, c.to, lang, unit)}</span>
            </li>
          ))}
        </ol>
        <span className="neh-map-legend-note">
          {t("legend.method", { method: t(MAP_METHOD_KEYS[method]) })}
        </span>
      </>
    );
  }

  return (
    <div
      className="neh-map-legend"
      role="group"
      aria-label={t("legend.label")}
      data-scale={scale.kind}
    >
      {body}
      {scale.midpoint !== null && (
        <span className="neh-map-legend-note" data-map-midpoint>
          {t("legend.midpoint", { value: fmt(scale.midpoint) })}
        </span>
      )}
      {showNoData && (
        <span className="neh-map-legend-item" data-map-nodata>
          <span
            aria-hidden
            className="neh-map-swatch"
            style={paint("--neh-map-swatch", MAP_NODATA_SWATCH)}
          />
          <span>{t("noData")}</span>
        </span>
      )}
    </div>
  );
}
