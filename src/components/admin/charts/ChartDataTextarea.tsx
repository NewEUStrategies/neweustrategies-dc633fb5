// Pole tekstowe danych wykresu w panelu widgetu - zwykła textarea, która
// wklejony ARKUSZ przekłada na format średnikowy (`clipboardToChartText`).
// Pisanie i wklejanie zwykłego tekstu działają jak dotąd; problemy wklejki
// (obcięcie, komórki nieliczbowe, zgadnięty nagłówek) stoją pod polem tak
// długo, jak pole trzyma tekst z tej wklejki - następna edycja albo Ctrl+Z
// w historii buildera zdejmują opis danych, których już nie ma.
//
// WKLEJONA TABELA ZASTĘPUJE DANE JAK IMPORT W ARKUSZU. Kolory serii
// (`seriesColors`) są pozycyjne, a akcenty (`accentSeries`, `accentCategory`)
// to indeksy - zapis samego `data` zostawiał je na starych miejscach, więc
// tabela z kolumnami w innej kolejności przenosiła wyróżnienie i kolory na
// inne serie. Z `onPatch` wklejka idzie przez `gridReplace` (kolor i akcent
// za NAZWĄ serii, jak import pliku w arkuszu) i zapisuje dane razem z nimi
// JEDNĄ łatką.
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { clipboardPayloadOf } from "@/lib/charts/clipboardTable";
import { parseChartData } from "@/lib/charts/csv";
import type { ImportProblem } from "@/lib/charts/importTable";
import type { ContentPatch } from "@/lib/builder/schemas";
import { ImportProblemList } from "./ImportProblemList";
import { clipboardToChartText } from "./textareaPaste";
import { gridReplace, readWidgetGrid, widgetGridPatch, type EditorDocLang } from "./chartGridState";

interface Props {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  /** Pełna treść widgetu - kolory i akcenty, które wklejona tabela przenosi za nazwą serii. */
  content?: Readonly<Record<string, unknown>>;
  /** Zapis wielu kluczy jako jeden krok historii; bez niego wklejka zapisuje samo pole. */
  onPatch?: (patch: ContentPatch) => void;
  /** Klucz pola danych w treści widgetu; domyślnie `data`. */
  dataKey?: string;
  /** Język dokumentu - nazwa domyślna serii pustej siatki. */
  lang?: EditorDocLang;
}

export function ChartDataTextarea({
  value,
  onChange,
  rows,
  placeholder,
  className,
  content,
  onPatch,
  dataKey = "data",
  lang = "pl",
}: Props) {
  const [wklejka, setWklejka] = useState<{
    text: string;
    problems: readonly ImportProblem[];
  } | null>(null);
  const problems = wklejka !== null && wklejka.text === value ? wklejka.problems : [];
  return (
    <div className="space-y-1.5">
      <Textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const wynik = clipboardToChartText(clipboardPayloadOf(e));
          if (wynik === null) return;
          e.preventDefault();
          if (onPatch === undefined) {
            onChange(wynik.text);
            setWklejka(wynik);
            return;
          }
          const next = gridReplace(
            readWidgetGrid(value, content ?? {}, lang),
            parseChartData(wynik.text),
          );
          const patch = widgetGridPatch(next, dataKey);
          onPatch(patch);
          setWklejka({ text: String(patch[dataKey] ?? ""), problems: wynik.problems });
        }}
      />
      <ImportProblemList problems={problems} />
    </div>
  );
}
