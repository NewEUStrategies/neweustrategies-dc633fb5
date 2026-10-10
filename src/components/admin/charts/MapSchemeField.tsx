// Pole schematu `mapScheme` - schemat barw kartogramu w panelu widgetu.
//
// Ten sam wybór, co w bloku CMS (`MapScalePicker`): grupa przycisków
// radiowych z próbkami klas policzonymi modelem skali mapy i nazwą
// kanoniczną schematu, a pod nią mini-legenda na AKTUALNYCH danych widgetu.
// Pole zapisuje WYŁĄCZNIE klucz schematu (`setContent`) - liczba klas,
// metoda podziału i środek skali są w schemacie widgetu osobnymi polami
// (`dataVizSchemas/dataMap.ts`), więc bramka wierności ustawień widzi każde
// z nich jako oferowane, a mini-legenda tylko je czyta.
//
// Odczyt idzie przez adapter widgetu (`widgetMapConfig`) na WYBRANYCH
// kluczach - pusta albo nieznana wartość daje to, co narysuje mapa
// (niebieski, skala ciągła), a panel nie czyta treści hurtem.
//
// Etykieta pola stoi RAZ: rysuje ją `PropField`, a grupa radiowa bierze z niej
// nazwę dostępną (`labelledBy`), zamiast pokazywać własny drugi napis.
import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import "@/lib/i18n-map-editor";
import { PropField } from "@/components/admin/builder/ui/atoms/PropField";
import type { SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { widgetMapConfig } from "@/lib/charts/widgetConfig";
import { isMapScheme, MAP_SCHEMES, type MapScheme } from "@/lib/charts/types";
import { MapScalePicker } from "./MapScalePicker";
import { drawnMapValues } from "./mapGridState";

export function MapSchemeField({ field, content, lang, setContent }: SchemaFieldEditorProps) {
  const bl = useBuilderLabel();
  const label = bl(field.label) ?? field.label;
  const labelId = useId();

  // Klucze czytane POJEDYNCZO - te, które mini-legenda naprawdę potrzebuje.
  const region = content.region;
  const data = content.data;
  const scheme = content[field.key];
  const classes = content.classes;
  const method = content.method;
  const midpoint = content.midpoint;
  const unit = content.unit;
  const cfg = useMemo(
    () => widgetMapConfig({ region, data, scheme, classes, method, midpoint, unit }, lang),
    [region, data, scheme, classes, method, midpoint, unit, lang],
  );

  // Domena legendy z krajów NARYSOWANYCH - tak samo liczy ją mapa.
  const geo = useQuery(geoAssetQueryOptions(cfg.region));
  const countries = Array.isArray(geo.data?.countries) ? geo.data.countries : undefined;
  const regionIds = useMemo(
    () => (countries === undefined ? null : new Set(countries.map((c) => c.id))),
    [countries],
  );
  const values = useMemo(() => drawnMapValues(cfg.values, regionIds), [cfg.values, regionIds]);
  // „Brak danych" w legendzie wtedy, gdy mapa ma kraj bez wartości - przed
  // wczytaniem zasobu zakładamy, że ma (tak samo robi legenda mapy).
  const showNoData = useMemo(() => {
    if (regionIds === null) return true;
    const zWartoscia = new Set(cfg.values.map((v) => v.id));
    return [...regionIds].some((id) => !zWartoscia.has(id));
  }, [regionIds, cfg.values]);

  // Opcje schematu: z pola (kolejność i zestaw schematu panelu), ale tylko
  // te, które zna typ - nieznana wartość nie może wyjść jako przycisk bez nazwy.
  const offered = (field.options ?? []).map((o) => o.value).filter(isMapScheme);
  const schemes: readonly MapScheme[] = offered.length > 0 ? offered : MAP_SCHEMES;

  return (
    <PropField label={<span id={labelId}>{label}</span>} hint={bl(field.hint)}>
      <MapScalePicker
        parts="scheme"
        value={{
          scheme: cfg.scheme,
          classes: cfg.classes,
          method: cfg.method,
          midpoint: cfg.midpoint,
        }}
        onChange={(patch) => {
          if (patch.scheme !== undefined) setContent(field.key, patch.scheme);
        }}
        values={values}
        showNoData={showNoData}
        unit={cfg.unit}
        docLang={lang}
        lang={lang}
        schemes={schemes}
        labelledBy={labelId}
        showHint={false}
      />
    </PropField>
  );
}
