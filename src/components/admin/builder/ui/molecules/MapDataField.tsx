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
// cicho do danych i zniknąć na mapie.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { buildCountryIndex, mapValuesToText, tableToMapValues } from "@/lib/charts/importTable";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import type { MapRegion } from "@/lib/charts/types";
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
          const wynik = tableToMapValues(table, index);
          onChange(mapValuesToText(wynik.values));
          return wynik.problems;
        }}
      />
    </div>
  );
}
