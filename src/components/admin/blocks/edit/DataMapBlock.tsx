// Admin edytor bloku "data-map" (kartogram). Siatka kraj - wartość, import
// z pliku, wklejenie z arkusza, wybór skali barw i odniesienia - a nad formą
// PODGLĄD NA ŻYWO: ten sam render, który trafi na stronę publiczną (wspólny
// silnik src/components/charts), w języku dokumentu i z działającym
// najechaniem (tooltip, obrys kraju).
//
// Do PR2 żył w `DataVizBlocks.tsx` razem z edytorem wykresu; tamten plik
// re-eksportuje go dalej, więc dyspozytor i testy importują go jak dotąd.
//
// DANE (PR2) to wspólna siatka `MapDataGrid` - ta sama, którą ma arkusz
// widgetu buildera: kod albo nazwa kraju (rozwiązywana do ISO-2), nazwa
// w języku dokumentu, liczba ze szkicem, uwagi wierszy (nieznany kraj,
// powtórzenie, kraj spoza regionu, brak wartości), wklejenie zakresu
// z Excela, Arkuszy Google albo LibreOffice, menu wiersza. Tabela wklejona
// na kanwie przy zaznaczonym bloku trafia do podglądu tej siatki
// (`useBlockTablePaste`), a nie do nowego bloku tabeli.
//
// ZAPIS: każde działanie to JEDEN `onChange` (`write`), więc jeden krok
// cofania; Ctrl+Z w siatce cofa w historii bloku (`[data-chart-grid]`).
// Wiersze niedokończone (kraj bez liczby, liczba bez kraju) zostają
// w treści, żeby autor widział je po przeładowaniu - rysunek czyta tylko
// kompletne (`parseMapValues`), a pusta wartość to „brak danych".
import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import "@/lib/i18n-map-editor";
import type { Block, Json } from "@/lib/blocks/types";
import { AdminSelect } from "../AdminSelect";
import { useBlockEditorLang } from "../BlockEditorContext";
import { parseDataMapConfig, parseMapRegion } from "@/lib/charts/parse";
import { MAP_REGIONS, mapRegionLabelKey, type MapRegion } from "@/lib/charts/types";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { MapDataGrid, type MapDataGridHandle } from "@/components/admin/charts/MapDataGrid";
import { MapScalePicker, type MapScaleValue } from "@/components/admin/charts/MapScalePicker";
import { useBlockTablePaste } from "@/components/admin/charts/blockTablePaste";
import { useChartEditorT } from "@/components/admin/charts/chartEditorI18n";
import { mapTableValues } from "@/components/admin/charts/mapTableLayout";
import {
  blockMapValues,
  drawnMapValues,
  mapCountryLookup,
  readBlockMapRows,
} from "@/components/admin/charts/mapGridState";
import {
  CaptionMetaFields,
  FieldGroup,
  inputCls,
  ProvenanceSelect,
  readText,
  Shell,
  SourcesEditor,
} from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

/**
 * Pola tekstowe mapy, które parser czyta przez `String(...)`. Treść spoza
 * dziedziny (obiekt po ręcznej edycji JSON-a, import z innego systemu)
 * dawałaby w podglądzie „[object Object]" pod mapą - podgląd dostaje je
 * przez `readText`, czyli jako pustkę, tak samo jak pola formy niżej.
 */
const MAP_TEXT_KEYS = [
  "title",
  "description",
  "unit",
  "source",
  "caption",
  "sourceDate",
  "notesShows",
  "notesSurprising",
  "notesHidden",
] as const;

function previewData(data: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = { ...data };
  for (const key of MAP_TEXT_KEYS) if (key in out) out[key] = readText(out[key]);
  return out;
}

/** Łatka skali z wyboru -> klucze bloku. Pusty środek skali USUWA klucz (parser: 0). */
function scalePatch(patch: Partial<MapScaleValue>): Record<string, Json | undefined> {
  const out: Record<string, Json | undefined> = {};
  if (patch.scheme !== undefined) out.scheme = patch.scheme;
  if (patch.classes !== undefined) out.classes = patch.classes;
  if (patch.method !== undefined) out.method = patch.method;
  if ("midpoint" in patch) out.midpoint = patch.midpoint ?? undefined;
  return out;
}

export function DataMapBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  // Napisy edytora w języku PANELU; nazwy krajów, liczby i podgląd - w języku
  // DOKUMENTU (karta PL/EN edytora wpisu).
  const t = useChartEditorT();
  const docLang = useBlockEditorLang();
  const gridRef = useRef<MapDataGridHandle>(null);

  // Region idzie przez parser bloku, a nie przez porównanie z dwoma literałami:
  // ta sama droga, co w renderze publicznym, więc podgląd nad formą pokazuje
  // DOKŁADNIE to, co zobaczy czytelnik - także wtedy, gdy w treści siedzi
  // region z nowszej wersji edytora.
  const region: MapRegion = parseMapRegion(block.data.region);
  const rows = useMemo(() => readBlockMapRows(block.data.values), [block.data.values]);
  const previewConfig = useMemo(() => parseDataMapConfig(previewData(block.data)), [block.data]);

  // Kraje z tego samego statycznego zasobu, który rysuje mapę - zero
  // dodatkowych danych w bundlu, nazwy i skorowidz zawsze zgodne z geometrią.
  const geo = useQuery(geoAssetQueryOptions(region));
  const countries = Array.isArray(geo.data?.countries) ? geo.data.countries : undefined;
  const lookup = useMemo(() => mapCountryLookup(countries), [countries]);

  // TABELA WKLEJONA NA KANWIE przy zaznaczonym bloku trafia do podglądu
  // siatki - ten sam podgląd układu, co wklejka całej tabeli w siatkę.
  useBlockTablePaste(block.id, (table) =>
    gridRef.current?.openTablePreview(
      table.rows,
      table.truncated ? [{ code: "pasteTruncated" }] : [],
      "paste",
    ),
  );

  // Zapis z USUWANIEM: `undefined` znaczy „usuń klucz z treści" - jedno
  // wywołanie, jeden `onChange`, jeden krok cofania.
  const write = (changes: Record<string, Json | undefined>) =>
    onChange({
      ...block,
      data: Object.fromEntries(
        Object.entries({ ...block.data, ...changes }).filter(
          (entry): entry is [string, Json] => entry[1] !== undefined,
        ),
      ),
    });

  // Mini-legenda liczy domenę z krajów NARYSOWANYCH - tak samo jak mapa.
  const drawn = useMemo(
    () => drawnMapValues(previewConfig.values, lookup.ids),
    [previewConfig.values, lookup.ids],
  );
  // „Brak danych" w legendzie, gdy region ma kraj bez wartości - przed
  // wczytaniem zasobu zakładamy, że ma (tak samo robi legenda mapy).
  const showNoData = useMemo(() => {
    if (lookup.ids === null) return true;
    const zWartoscia = new Set(previewConfig.values.map((v) => v.id));
    return [...lookup.ids].some((id) => !zWartoscia.has(id));
  }, [lookup.ids, previewConfig.values]);

  return (
    <Shell label={bt.editor("dataMap", "shellLabel")}>
      <ChoroplethMap
        config={{ ...previewConfig, animate: false }}
        lang={docLang}
        className="my-0"
      />

      <div className="grid grid-cols-2 gap-2">
        <AdminSelect
          className={inputCls}
          value={region}
          onChange={(e) => write({ region: e.target.value })}
        >
          {/* Opcje WYPROWADZONE ze źródła regionów - wcześniej stały tu dwa
              ręcznie wpisane `<option>`, więc dołożenie regionu wymagało
              dotknięcia edytora i było o jedno przeoczenie od regionu, którego
              autor nie mógł wybrać, choć silnik już go umiał narysować. */}
          {MAP_REGIONS.map((r) => (
            <option key={r} value={r}>
              {bt.editor("dataMap", mapRegionLabelKey(r))}
            </option>
          ))}
        </AdminSelect>
        <input
          className={inputCls}
          value={readText(block.data.unit)}
          placeholder={bt.editor("dataMap", "unit")}
          onChange={(e) => write({ unit: e.target.value })}
        />
      </div>
      <input
        className={inputCls}
        value={readText(block.data.title)}
        placeholder={bt.editor("dataMap", "title")}
        onChange={(e) => write({ title: e.target.value })}
      />
      <input
        className={inputCls}
        value={readText(block.data.description)}
        placeholder={bt.editor("common", "subtitle")}
        onChange={(e) => write({ description: e.target.value })}
      />

      <FieldGroup label={t("mapEditor.block.dataGroup")}>
        {/* IMPORT Z PLIKU stoi NAD siatką, bo ją ZASTĘPUJE. Przed zapisem
            pokazuje podgląd układu: nagłówek, obrót, format liczb, kolumnę
            krajów i wartości. Skorowidz nazw powstaje z TEGO SAMEGO zasobu,
            który rysuje mapę. */}
        <DataImportControl
          hint={t("mapEditor.import.hint")}
          preview="map"
          countryIndex={lookup.index}
          onRows={(table, layout) => {
            const dane = mapTableValues(table, lookup.index, layout);
            write({ values: blockMapValues(dane.values) });
            return dane.problems;
          }}
        />
        <MapDataGrid
          ref={gridRef}
          rows={rows}
          onChange={(next) => write({ values: blockMapValues(next) })}
          countries={countries}
          docLang={docLang}
        />
      </FieldGroup>

      <FieldGroup label={t("mapEditor.scale.group")}>
        <MapScalePicker
          value={{
            scheme: previewConfig.scheme,
            classes: previewConfig.classes,
            method: previewConfig.method,
            midpoint: previewConfig.midpoint,
          }}
          onChange={(patch) => write(scalePatch(patch))}
          values={drawn}
          showNoData={showNoData}
          unit={previewConfig.unit}
          docLang={docLang}
        />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.showLegend !== false}
            onChange={(e) => write({ showLegend: e.target.checked })}
          />
          {bt.editor("common", "legend")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={block.data.animate !== false}
            onChange={(e) => write({ animate: e.target.checked })}
          />
          {bt.editor("common", "animate")}
        </label>
      </div>
      <input
        className={inputCls}
        value={readText(block.data.source)}
        placeholder={bt.editor("dataMap", "source")}
        onChange={(e) => write({ source: e.target.value })}
      />

      <FieldGroup label={t("mapEditor.block.referencesGroup")}>
        <ProvenanceSelect data={block.data} write={write} />
        <CaptionMetaFields
          data={block.data}
          write={write}
          captionLabel={t("mapEditor.block.caption")}
          missingNotesText={t("mapEditor.block.missingNotes")}
        />
        <SourcesEditor data={block.data} write={write} hint={t("mapEditor.block.sourcesHint")} />
      </FieldGroup>
    </Shell>
  );
}
