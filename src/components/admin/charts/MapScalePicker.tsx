// WYBÓR SKALI BARW KARTOGRAMU - wspólny dla bloku CMS i pola buildera.
//
// Do PR2 mapa nie miała żadnego wyboru koloru: jeden niebieski ramp, zawsze
// ciągły. Teraz autor wybiera schemat (niebieski, łupkowy, pomarańczowy
// akcent, rozbieżny), liczbę klas (skala ciągła albo 3-7), metodę podziału
// (kwantyle albo równe przedziały) i - w schemacie rozbieżnym - środek skali.
//
// PRÓBKI SĄ PRAWDZIWE. Każda opcja schematu pokazuje pięć klas policzonych
// TYM SAMYM modelem skali, który maluje mapę (`mapScale`), więc próbka to
// wyrażenia CSS na tokenach `--chart-map-*` - przełączenie motywu
// przemalowuje ją razem z mapą, a w kodzie nie ma ani jednego hexa. Obok
// próbki stoi NAZWA KANONICZNA schematu (ta sama, którą czytelnik zobaczy
// w legendzie) - kolor nigdy nie jest jedynym nośnikiem wyboru.
//
// Schemat to grupa przycisków radiowych (natywne `<input type="radio">`):
// strzałki zmieniają wybór, Tab wchodzi do grupy raz, czytnik ekranu czyta
// nazwę i stan zaznaczenia.
//
// MINI-LEGENDA pod wyborem to `MapLegend` czytelnika na AKTUALNYCH danych:
// autor widzi granice klas, zanim opublikuje mapę - na przykład to, że przy
// kwantylach jeden kraj odstający nie spłaszcza reszty w blady koniec.
//
// Komponent nie wie nic o zapisie: oddaje zmianę jako łatkę
// (`onChange(patch)`), a wołający zapisuje ją JEDNYM zapisem.
import { useId, useMemo, type CSSProperties } from "react";
import { Check } from "lucide-react";
import "@/lib/i18n-map-editor";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import { DecimalInput } from "@/components/admin/blocks/edit/dataVizShared";
import { MapLegend } from "@/components/charts/MapLegend";
import { mapPaintOf } from "@/components/charts/mapPaint";
import { mapScale } from "@/lib/charts/kinds/mapScale";
import {
  MAP_CLASSES_MAX,
  MAP_CLASSES_MIN,
  MAP_METHODS,
  MAP_SCHEMES,
  type MapMethod,
  type MapScheme,
} from "@/lib/charts/types";
import { cn } from "@/lib/utils";
import { useChartEditorT, type EditorLang } from "./chartEditorI18n";

/** Ustawienia skali mapy - te same pola co w `DataMapConfig`. */
export interface MapScaleValue {
  scheme: MapScheme;
  /** 0 = skala ciągła, 3..7 = liczba klas. */
  classes: number;
  method: MapMethod;
  /** Środek schematu rozbieżnego; null = 0. */
  midpoint: number | null;
}

/** Nazwy kanoniczne schematów - te same liście co `chartsMap.schemes.*`. */
const SCHEME_KEYS: Record<MapScheme, string> = {
  blue: "mapEditor.schemes.blue",
  slate: "mapEditor.schemes.slate",
  accent: "mapEditor.schemes.accent",
  diverging: "mapEditor.schemes.diverging",
};

const METHOD_KEYS: Record<MapMethod, string> = {
  quantile: "mapEditor.methods.quantile",
  equal: "mapEditor.methods.equal",
};

type ClassCount = 3 | 4 | 5 | 6 | 7;

const CLASS_KEYS: Record<ClassCount, string> = {
  3: "mapEditor.scale.classesN.c3",
  4: "mapEditor.scale.classesN.c4",
  5: "mapEditor.scale.classesN.c5",
  6: "mapEditor.scale.classesN.c6",
  7: "mapEditor.scale.classesN.c7",
};

/** Liczby klas w kolejności listy - skala ciągła (0) na czele, jak w panelu buildera. */
const CLASS_OPTIONS: readonly number[] = [
  0,
  ...Array.from({ length: MAP_CLASSES_MAX - MAP_CLASSES_MIN + 1 }, (_, i) => MAP_CLASSES_MIN + i),
];

function isClassCount(n: number): n is ClassCount {
  return n >= MAP_CLASSES_MIN && n <= MAP_CLASSES_MAX && Number.isInteger(n);
}

/**
 * Pięć klas schematu na wartościach wzorcowych - kolory, którymi schemat
 * maluje mapę. Rozbieżny dostaje dziedzinę symetryczną wokół zera, więc
 * środkowa próbka to jego neutralny środek.
 */
function rampSwatches(scheme: MapScheme): string[] {
  const diverging = scheme === "diverging";
  const values = diverging ? [-2, -1, 0, 1, 2] : [0, 1, 2, 3, 4];
  return mapScale(values, scheme, 5, "equal", diverging ? 0 : null).classes.map((c) => c.color);
}

const SWATCHES: Record<MapScheme, string[]> = {
  blue: rampSwatches("blue"),
  slate: rampSwatches("slate"),
  accent: rampSwatches("accent"),
  diverging: rampSwatches("diverging"),
};

/** Farba próbki przez własność niestandardową (`.neh-map-swatch` w `map.css`), jak w legendzie. */
function swatchStyle(color: string): CSSProperties {
  return { ["--neh-map-swatch" as string]: color } as CSSProperties;
}

interface Props {
  value: MapScaleValue;
  onChange: (patch: Partial<MapScaleValue>) => void;
  /**
   * Które ustawienia edytuje ten wybór. Builder: tylko schemat - liczba klas,
   * metoda i środek skali są tam osobnymi polami panelu (bramka wierności
   * ustawień widzi każde z nich).
   */
  parts?: "all" | "scheme";
  /** Wartości NARYSOWANE (kraje regionu z liczbą) - domena mini-legendy. */
  values: readonly number[];
  /** Czy na mapie jest kraj bez wartości - legenda pokazuje wtedy „brak danych". */
  showNoData: boolean;
  unit: string;
  /** Język DOKUMENTU - liczby i napisy mini-legendy (legenda czytelnika). */
  docLang: "pl" | "en";
  /** Język napisów wyboru; brak = język panelu. */
  lang?: EditorLang;
  /** Schematy do wyboru (domyślnie wszystkie). */
  schemes?: readonly MapScheme[];
  /** Nazwa dostępna grupy schematów; domyślnie „Schemat barw". */
  label?: string;
  /**
   * Identyfikator WIDOCZNEJ etykiety, którą wołający już pokazuje nad
   * wyborem (pole panelu buildera ma własną `<Label>`). Grupa bierze z niej
   * nazwę dostępną i nie rysuje drugiego napisu - dawniej „Schemat barw"
   * stało w panelu dwa razy.
   */
  labelledBy?: string;
  /** Podpowiedź o schemacie rozbieżnym (builder ma ją w podpowiedzi pola). */
  showHint?: boolean;
  className?: string;
}

export function MapScalePicker({
  value,
  onChange,
  parts = "all",
  values,
  showNoData,
  unit,
  docLang,
  lang,
  schemes = MAP_SCHEMES,
  label,
  labelledBy,
  showHint = true,
  className,
}: Props) {
  const t = useChartEditorT(lang);
  const baseId = useId();
  const groupLabelId = `${baseId}-scheme`;
  const all = parts === "all";
  const diverging = value.scheme === "diverging";

  const scale = useMemo(
    () => mapScale(values, value.scheme, value.classes, value.method, value.midpoint),
    [values, value.scheme, value.classes, value.method, value.midpoint],
  );
  // Ta sama farba, którą maluje mapa - z wyglądem opublikowanym niebieskiej
  // skali ciągłej (`mapPaintOf`).
  const colorOf = (v: number): string => mapPaintOf(scale, value.scheme, v, "light").style;
  const legendaPusta = scale.classes.length === 0 && !showNoData;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        {labelledBy === undefined && (
          <span id={groupLabelId} className="block text-[11px] font-medium text-muted-foreground">
            {label ?? t("mapEditor.scale.scheme")}
          </span>
        )}
        <div
          role="radiogroup"
          aria-labelledby={labelledBy ?? groupLabelId}
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
        >
          {schemes.map((s) => {
            const wybrany = value.scheme === s;
            return (
              <label
                key={s}
                data-map-scheme={s}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  wybrany ? "border-foreground" : "border-border hover:border-foreground/50",
                )}
              >
                <input
                  type="radio"
                  name={`${baseId}-schemat`}
                  value={s}
                  checked={wybrany}
                  onChange={() => onChange({ scheme: s })}
                  className="sr-only"
                />
                <span aria-hidden className="flex shrink-0 gap-px">
                  {SWATCHES[s].map((c, i) => (
                    <span key={i} className="neh-map-swatch" style={swatchStyle(c)} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">{t(SCHEME_KEYS[s])}</span>
                {wybrany && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              </label>
            );
          })}
        </div>
        {showHint && (
          <p className="text-[10px] text-muted-foreground">{t("mapEditor.scale.divergingHint")}</p>
        )}
      </div>

      {all && (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[11px] text-muted-foreground">
            <span className="block font-medium">{t("mapEditor.scale.classes")}</span>
            <AdminSelect
              className="h-8 w-full text-xs"
              value={String(value.classes)}
              aria-label={t("mapEditor.scale.classes")}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n === 0 || isClassCount(n)) onChange({ classes: n });
              }}
            >
              {CLASS_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {isClassCount(n) ? t(CLASS_KEYS[n]) : t("mapEditor.methods.continuous")}
                </option>
              ))}
            </AdminSelect>
          </label>
          {value.classes > 0 && (
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span className="block font-medium">{t("mapEditor.scale.method")}</span>
              <AdminSelect
                className="h-8 w-full text-xs"
                value={value.method}
                aria-label={t("mapEditor.scale.method")}
                onChange={(e) => {
                  const m = MAP_METHODS.find((x) => x === e.target.value);
                  if (m !== undefined) onChange({ method: m });
                }}
              >
                {MAP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(METHOD_KEYS[m])}
                  </option>
                ))}
              </AdminSelect>
            </label>
          )}
        </div>
      )}

      {all && diverging && (
        <div className="space-y-1">
          <DecimalInput
            value={value.midpoint}
            placeholder={t("mapEditor.scale.midpoint")}
            onCommit={(midpoint) => onChange({ midpoint })}
          />
          <p className="text-[10px] text-muted-foreground">{t("mapEditor.scale.midpointHint")}</p>
        </div>
      )}

      <div className="space-y-1 rounded-md border border-border/60 p-2" data-map-legend-preview>
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("mapEditor.scale.legend")}
        </span>
        {legendaPusta ? (
          <p className="text-[11px] text-muted-foreground">{t("mapEditor.scale.legendEmpty")}</p>
        ) : (
          <MapLegend
            scale={scale}
            colorOf={colorOf}
            method={value.method}
            lang={docLang}
            unit={unit}
            showNoData={showNoData}
          />
        )}
      </div>
    </div>
  );
}
