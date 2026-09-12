// Molekuła: pole danych mapy w panelu widgetu - textarea + import z pliku.
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
// prawdziwy, a nie życzeniowy - wcześniej wołający zawężał go porównaniem
// z dwoma literałami i skorowidz dostawał Europę dla każdego regionu spoza
// tej pary.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { buildCountryIndex, mapValuesToText, tableToMapValues } from "@/lib/charts/importTable";
import { parseMapData } from "@/lib/charts/csv";
import { manualColorAdvice } from "@/lib/charts/mapColorAdvice";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { MAP_MANUAL_COLOR_WARN_AT, type MapRegion } from "@/lib/charts/types";
import "@/lib/i18n-admin-blocks";

interface Props {
  value: string;
  onChange: (next: string) => void;
  region: MapRegion;
  rows?: number;
  placeholder?: string;
}

export function MapDataField({ value, onChange, region, rows, placeholder }: Props) {
  const bt = useBlocksI18n();
  const geo = useQuery(geoAssetQueryOptions(region));
  const index = useMemo(() => buildCountryIndex(geo.data?.countries ?? []), [geo.data]);
  // Te same ostrzeżenia, co w bloku CMS. Bez nich autor widgetu mógł pomalować
  // trzydzieści krajów trzydziestoma barwami i nie dostać sygnału, który druga
  // powierzchnia uznaje za na tyle ważny, że go pokazuje - a rozjazd między
  // powierzchniami to dokładnie ta klasa błędu, którą ten moduł ma zamykać.
  const wpisy = useMemo(() => parseMapData(value), [value]);
  const rada = useMemo(() => manualColorAdvice(wpisy), [wpisy]);

  return (
    <div className="space-y-2">
      <Textarea
        rows={rows ?? 6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs font-mono"
        placeholder={placeholder}
      />
      <DataImportControl
        hint={bt.editor("dataImport", "hintMap")}
        onRows={(table) => {
          // Poprzednie wpisy WCHODZĄ do importu: plik ze statystyki nie niesie
          // barw, więc bez nich odświeżenie liczb kasowało całe kolorowanie.
          const wynik = tableToMapValues(table, index, wpisy);
          onChange(mapValuesToText(wynik.values));
          return wynik.problems;
        }}
      />
      {rada.tooMany !== null && (
        <Ostrzezenie
          text={bt.editor("dataMap", "tooManyColors", {
            count: rada.tooMany,
            limit: MAP_MANUAL_COLOR_WARN_AT,
          })}
        />
      )}
      {rada.cvdPairs.map((para) => (
        <Ostrzezenie
          key={`${para.a}-${para.b}-${para.kind}`}
          text={bt.editor("dataMap", "cvdPair", {
            a: para.a,
            b: para.b,
            kind: bt.editor("dataMap", `cvd_${para.kind}`),
          })}
        />
      ))}
    </div>
  );
}

/** Ostrzeżenie dyscypliny - mówi, co się psuje, i NIE blokuje zapisu. */
function Ostrzezenie({ text }: { text: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-[11px] leading-snug"
      style={{ color: "var(--chart-negative-text)" }}
    >
      <TriangleAlert className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
