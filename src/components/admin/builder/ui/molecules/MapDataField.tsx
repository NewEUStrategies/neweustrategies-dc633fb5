// Molekuła: pole danych mapy w panelu widgetu - textarea, import z pliku
// i arkusz mapy („Edytuj w arkuszu").
//
// DLACZEGO OSOBNY KOMPONENT, A NIE GAŁĄŹ `switch` W `SchemaFieldControl`.
// Import nazw krajów potrzebuje zasobu geometrii, czyli `useQuery`. Hook
// w gałęzi `switch` łamie stałą kolejność hooków - panel, który raz pokaże
// pole mapy, a raz pole tekstowe, wołałby o różną liczbę hooków. Wydzielenie
// komponentu jest tu jedynym poprawnym rozwiązaniem, nie kwestią stylu.
//
// SKOROWIDZ IDZIE Z REGIONU WIDGETU, nie z globalnej listy krajów: kraj,
// którego wybrany region nie rysuje, ma wyjść jako nierozpoznany, a nie wejść
// cicho do danych i zniknąć na mapie. Region przychodzi tu JUŻ SPARSOWANY
// (`parseMapRegion` w `SchemaFieldControl`), więc typ `MapRegion` jest
// prawdziwy, a nie życzeniowy.
//
// WKLEJENIE ARKUSZA (PR2). Textarea czyta format „ISO2; wartość" (`csv.ts`),
// a zakres z Excela przychodzi tabulatorami: „PL<TAB>12,5" nie pasowało do
// kodu i wiersz ginął bez słowa. Tabela ze schowka (HTML arkusza albo tekst
// z tabulatorami) zamienia się teraz na ten format - kod ISO-2, średnik,
// kropka dziesiętna - przez `clipboardToMapText`, z tym samym rozpoznaniem
// układu co podgląd siatki („Lp. | Kraj | Wartość", tabela obrócona, „kod |
// nazwa | wartość"). Problemy (nieznane kraje, pominięte kolumny) stoją pod
// polem, dopóki pole trzyma tekst z tej wklejki. Zwykły tekst wkleja się po
// staremu.
//
// WKLEJENIE NIE KASUJE POLA. Tabela zastępuje treść tylko wtedy, gdy pole
// jest puste albo zaznaczone w całości. W każdym innym razie kraje wklejone
// DOCHODZĄ do wierszy pola (`mergeWidgetMapText`): jeden wiersz skopiowany
// z arkusza dopisuje albo poprawia jeden kraj, a reszta zostaje. Gdy z tabeli
// nie wyszedł żaden kraj, pole zostaje takie, jakie było, a pod nim stoją
// problemy - dawniej taka wklejka zostawiała pole puste.
//
// Import i arkusz zapisują pole jednym zapisem; arkusz (`MapDataDialog`)
// pokazuje nazwy krajów, uwagi wierszy i podgląd mapy.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { ImportProblemList } from "@/components/admin/charts/ImportProblemList";
import { MapDataDialog } from "@/components/admin/charts/MapDataDialog";
import { mapTableValues } from "@/components/admin/charts/mapTableLayout";
import { mapCountryLookup, mergeWidgetMapText } from "@/components/admin/charts/mapGridState";
import { clipboardToMapText } from "@/components/admin/charts/textareaPaste";
import { useChartEditorT } from "@/components/admin/charts/chartEditorI18n";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { clipboardPayloadOf } from "@/lib/charts/clipboardTable";
import { mapValuesToText, type ImportProblem } from "@/lib/charts/importTable";
import type { MapRegion } from "@/lib/charts/types";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch } from "@/lib/builder/schemas";
import "@/lib/i18n-map-editor";

interface Props {
  value: string;
  onChange: (next: string) => void;
  region: MapRegion;
  rows?: number;
  placeholder?: string;
  /**
   * Pełna treść widgetu, język i zapis - od P0a podaje je `SchemaFieldControl`.
   * Arkusz mapy czyta z treści ustawienia podglądu (tylko przy otwartym
   * oknie) i zapisuje dane jedną łatką (`setContentPatch`).
   */
  content?: Record<string, unknown>;
  lang?: "pl" | "en";
  setContent?: (key: string, value: Json) => void;
  setContentPatch?: (patch: ContentPatch) => void;
}

/** Stała pustka - nowy obiekt w każdym renderze unieważniałby podgląd arkusza. */
const BEZ_TRESCI: Record<string, unknown> = {};

export function MapDataField({
  value,
  onChange,
  region,
  rows,
  placeholder,
  content,
  lang = "pl",
  setContent,
  setContentPatch,
}: Props) {
  const t = useChartEditorT(lang);
  const geo = useQuery(geoAssetQueryOptions(region));
  const countries = Array.isArray(geo.data?.countries) ? geo.data.countries : undefined;
  // Skorowidz regionu, a do jego wczytania - światowy (`mapCountryLookup`).
  const index = useMemo(() => mapCountryLookup(countries).index, [countries]);
  const [wklejka, setWklejka] = useState<{
    text: string;
    problems: readonly ImportProblem[];
  } | null>(null);
  const problems = wklejka !== null && wklejka.text === value ? wklejka.problems : [];

  return (
    <div className="space-y-2">
      <Textarea
        rows={rows ?? 6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const wynik = clipboardToMapText(clipboardPayloadOf(e), index);
          if (wynik === null) return;
          e.preventDefault();
          const pole = e.currentTarget;
          const calePole =
            value.trim() === "" ||
            (pole.selectionStart === 0 && pole.selectionEnd === pole.value.length);
          const text =
            wynik.values.length === 0
              ? value
              : calePole
                ? wynik.text
                : mergeWidgetMapText(value, wynik.values);
          if (text !== value) onChange(text);
          setWklejka({ text, problems: wynik.problems });
        }}
        className="text-xs font-mono"
        placeholder={placeholder}
      />
      <ImportProblemList problems={problems} lang={lang} />
      <DataImportControl
        hint={t("mapEditor.import.hint")}
        preview="map"
        countryIndex={index}
        onRows={(table, layout) => {
          const wynik = mapTableValues(table, index, layout);
          onChange(mapValuesToText(wynik.values));
          return wynik.problems;
        }}
      />
      <MapDataDialog
        value={value}
        onChange={onChange}
        region={region}
        content={content ?? BEZ_TRESCI}
        lang={lang}
        setContent={setContent}
        setContentPatch={setContentPatch}
      />
    </div>
  );
}
