// ARKUSZ DANYCH MAPY W BUILDERZE - siatka kraj - wartość z podglądem mapy.
//
// Pole danych widgetu mapy to textarea „ISO2; wartość" - wygodna do
// wklejenia gotowej listy, ale bez nazw krajów, bez uwag i bez podglądu:
// literówka w kodzie znikała z mapy bez słowa. Ten dialog daje tę samą
// siatkę, co blok CMS (`MapDataGrid`: kod albo nazwa kraju, nazwa w języku
// treści, uwagi wierszy, wklejenie zakresu, menu wiersza) i obok niej mapę
// liczoną TYM SAMYM adapterem, co widok widgetu na stronie
// (`widgetMapConfig`) - jedynym świadomym wyjątkiem jest wyłączona animacja.
//
// ZAPIS. Siatka mapy nie ma pisanych na żywo etykiet (kod i liczba
// zatwierdzają się przy opuszczeniu komórki), więc każda zmiana idzie od
// razu, JEDNĄ łatką (`setContentPatch` z kluczem danych) - jedno działanie
// to jeden krok historii buildera, a Ctrl+Z w siatce cofa go w historii
// buildera (`[data-chart-grid]`, skróty buildera). Zamknięcie W KAŻDY sposób
// (Zamknij, Escape, klik poza oknem) najpierw zatwierdza szkic komórki
// z fokusem (`commitFocusedGridCell`) - inaczej wpisana i niezatwierdzona
// liczba ginęła razem z oknem.
//
// ECHO WŁASNEGO ZAPISU NIE PRZEBUDOWUJE SIATKI: tekst ostatnio wysłany jest
// zapamiętany, a siatka czyta treść od nowa tylko po otwarciu albo po
// zmianie Z ZEWNĄTRZ (cofnięcie w historii buildera).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet as SheetIcon, Undo2 } from "lucide-react";
import "@/lib/i18n-map-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChoroplethMap } from "@/components/charts/ChoroplethMap";
import { DataImportControl } from "@/components/admin/blocks/DataImportControl";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { widgetMapConfig } from "@/lib/charts/widgetConfig";
import type { MapRegion } from "@/lib/charts/types";
import type { Json } from "@/lib/builder/types";
import type { ContentPatch } from "@/lib/builder/schemas";
import { MapDataGrid } from "./MapDataGrid";
import { commitFocusedGridCell } from "./gridKeyboard";
import { mapTableValues } from "./mapTableLayout";
import {
  mapCountryLookup,
  readWidgetMapRows,
  widgetMapText,
  type MapEditorRow,
} from "./mapGridState";
import { useChartEditorT } from "./chartEditorI18n";

interface Props {
  /** Tekst pola danych („ISO2; wartość" na wiersz). */
  value: string;
  onChange: (next: string) => void;
  /** Region widgetu JUŻ sparsowany - skorowidz i nazwy krajów idą z jego zasobu. */
  region: MapRegion;
  /** Pełna treść widgetu - podgląd mapy z tymi samymi ustawieniami co kanwa. */
  content: Record<string, unknown>;
  lang: "pl" | "en";
  setContent?: (key: string, value: Json) => void;
  setContentPatch?: (patch: ContentPatch) => void;
  /** Klucz pola danych w treści widgetu; domyślnie `data` (schemat mapy). */
  dataKey?: string;
}

export function MapDataDialog({
  value,
  onChange,
  region,
  content,
  lang,
  setContentPatch,
  dataKey = "data",
}: Props) {
  const t = useChartEditorT(lang);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly MapEditorRow[]>(() => readWidgetMapRows(value));
  // Stan z chwili OTWARCIA - punkt „Przywróć".
  const initialRef = useRef<readonly MapEditorRow[]>(rows);
  // Tekst ostatnio wysłany (albo wczytany) - rozpoznaje echo własnego zapisu.
  const lastSyncedRef = useRef<string>(value);

  // Zasób regionu tylko przy otwartym oknie - zamknięty dialog nie dociąga
  // niczego (pole danych ma własny skorowidz do wklejki i importu).
  const geo = useQuery({ ...geoAssetQueryOptions(region), enabled: open });
  const countries = Array.isArray(geo.data?.countries) ? geo.data.countries : undefined;
  const lookup = useMemo(() => mapCountryLookup(countries), [countries]);

  const wejscie = useRef(value);
  wejscie.current = value;
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const justOpened = !wasOpenRef.current;
    wasOpenRef.current = true;
    if (!justOpened && value === lastSyncedRef.current) return;
    const next = readWidgetMapRows(wejscie.current);
    setRows(next);
    if (justOpened) initialRef.current = next;
    lastSyncedRef.current = wejscie.current;
  }, [open, value]);

  // Kanały zapisu z NAJŚWIEŻSZEGO renderu - rodzic podaje nowe funkcje przy
  // każdym renderze.
  const kanaly = useRef({ onChange, setContentPatch, dataKey });
  kanaly.current = { onChange, setContentPatch, dataKey };

  /** Zapis wierszy do treści widgetu - jedna łatka, jeden krok historii. */
  const zapisz = (next: readonly MapEditorRow[]) => {
    const text = widgetMapText(next);
    if (text === lastSyncedRef.current) return;
    lastSyncedRef.current = text;
    const k = kanaly.current;
    if (k.setContentPatch) k.setContentPatch({ [k.dataKey]: text });
    else k.onChange(text);
  };

  const onGridChange = (next: readonly MapEditorRow[]) => {
    setRows(next);
    zapisz(next);
  };

  // Podgląd liczony WYŁĄCZNIE przy otwartym oknie: składa się z całej treści
  // widgetu, a panel z zamkniętym dialogiem nie może czytać treści hurtem
  // (bramka wierności ustawień liczy odczyty klucz po kluczu).
  const previewConfig = useMemo(() => {
    if (!open) return null;
    const merged: Record<string, unknown> = { ...content, [dataKey]: widgetMapText(rows) };
    return { ...widgetMapConfig(merged, lang), animate: false };
  }, [open, content, dataKey, rows, lang]);

  // Zamknięcie W KAŻDY sposób: najpierw szkic komórki z fokusem.
  const zmienOtwarcie = (next: boolean) => {
    if (!next) commitFocusedGridCell();
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={zmienOtwarcie}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <SheetIcon className="h-3.5 w-3.5" aria-hidden />
          {t("mapEditor.dialog.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base font-semibold">
            {t("mapEditor.dialog.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("mapEditor.dialog.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[70vh] grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="space-y-3 overflow-auto border-r p-4">
            <DataImportControl
              hint={t("mapEditor.import.hint")}
              preview="map"
              countryIndex={lookup.index}
              onRows={(table, layout) => {
                const dane = mapTableValues(table, lookup.index, layout);
                onGridChange(dane.values.map((v) => ({ id: v.id, value: v.value })));
                return dane.problems;
              }}
            />
            <MapDataGrid
              rows={rows}
              onChange={onGridChange}
              countries={countries}
              docLang={lang}
              lang={lang}
              onFlush={() => false}
            />
            <div className="flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-8 gap-1.5 text-xs"
                onClick={() => onGridChange(initialRef.current)}
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> {t("mapEditor.dialog.reset")}
              </Button>
            </div>
          </div>
          <div className="overflow-auto bg-muted/20 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("mapEditor.dialog.preview")}
            </div>
            <div className="rounded-md border bg-background p-3">
              {previewConfig !== null && (
                <ChoroplethMap config={previewConfig} lang={lang} className="my-0" />
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/20 px-5 py-3">
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            onClick={() => zmienOtwarcie(false)}
          >
            {t("mapEditor.dialog.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
