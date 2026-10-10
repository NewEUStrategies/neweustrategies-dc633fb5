// Pole schematu `chartSeriesColors` - kolory serii widgetu wykresu.
//
// Zapis zostaje napisem POZYCYJNYM numerów slotów („3;4;8" - seria 1, 2, 3;
// puste miejsce = kolor domyślny serii), bo tak czyta go adapter widgetu
// (`widgetChartConfig`). Panel nie pokazuje jednak tego napisu: przy każdej
// serii z danych widgetu stoi próbka KOLORU NARYSOWANEGO (`seriesPaint`
// z rangą), a pod paletą ról pierwsze serie zamiast próbnika mają etykietę
// roli - ich kolor zmienia wybór serii wyróżnionej, nie slot. Rodzaj z własną
// farbą mówi swoje (`drawnSeriesSwatches`): kolumna osi X chmury nie ma
// próbki, a małe panele mają jedną farbę panelu bez próbnika.
import { useState } from "react";
import { PropField } from "@/components/admin/builder/ui/atoms/PropField";
import type { SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import { parseChartData } from "@/lib/charts/csv";
import { parseChartKind } from "@/lib/charts/parse";
import { isChartPalette } from "@/lib/charts/seriesStyle";
import { accentIndex, parseSeriesColors, widgetSeriesColors } from "./chartGridState";
import { drawnSeriesSwatches } from "./chartColorSlots";
import { ChartColorPicker, ColorSwatch, SeriesRoleChip } from "./ChartColorPicker";
import { useChartEditorT } from "./chartEditorI18n";

/** Klucz danych widgetu wykresu (schemat: pole `chartData` o kluczu `data`). */
const DATA_KEY = "data";

const napis = (v: unknown): string => (typeof v === "string" ? v : "");

export function ChartSeriesColorsField({ field, content, setContent }: SchemaFieldEditorProps) {
  const bl = useBuilderLabel();
  const t = useChartEditorT();
  const [otwarty, setOtwarty] = useState<number | null>(null);
  const label = bl(field.label);

  const { categories, series } = parseChartData(napis(content[DATA_KEY]));
  const sloty = parseSeriesColors(content[field.key]);
  const serie = series.map((s, i) => ({ ...s, colorSlot: sloty[i] ?? s.colorSlot }));
  const akcent = accentIndex(content.accentSeries, serie.length) ?? 0;
  // Próbki z tej samej farby co rysunek RODZAJU (chmura bez kolumny osi X,
  // małe panele jedną farbą bez próbnika) - `drawnSeriesSwatches`.
  const probki =
    drawnSeriesSwatches(
      parseChartKind(napis(content.kind)),
      { categories, series: serie },
      akcent,
      isChartPalette(content.palette) ? content.palette : "focus",
    ) ?? [];
  const nazwa = (i: number) => serie[i]?.name || t("chartEditor.grid.seriesN", { n: i + 1 });

  return (
    <PropField label={label} hint={bl(field.hint)}>
      {serie.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("chartEditor.colors.empty")}</p>
      ) : (
        <ul className="space-y-1" aria-label={label}>
          {serie.map((s, i) => {
            const probka = probki[i] ?? null;
            return (
              <li key={i} className="flex items-center gap-2 text-xs">
                {probka === null ? (
                  // Seria bez farby na rysunku (kolumna osi X chmury).
                  <span aria-hidden className="mx-1 inline-block h-4 w-4 shrink-0" />
                ) : !probka.pickable ? (
                  <ColorSwatch color={probka.color} className="mx-1" />
                ) : (
                  <ChartColorPicker
                    slot={s.colorSlot}
                    paint={probka.color}
                    label={t("chartEditor.colors.pickerLabel", { name: nazwa(i) })}
                    open={otwarty === i}
                    onOpenChange={(o) => setOtwarty(o ? i : null)}
                    onChange={(slot) =>
                      setContent(
                        field.key,
                        widgetSeriesColors(
                          serie.map((x, j) => (j === i ? { ...x, colorSlot: slot } : x)),
                        ),
                      )
                    }
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{nazwa(i)}</span>
                {probka !== null && probka.role !== null && <SeriesRoleChip role={probka.role} />}
              </li>
            );
          })}
        </ul>
      )}
      {probki.some((p) => p !== null && p.role !== null) && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {t("chartEditor.colors.customHint")}
        </p>
      )}
    </PropField>
  );
}
