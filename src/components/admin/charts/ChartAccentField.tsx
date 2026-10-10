// Pole schematu `chartAccent` - seria (`accentSeries`) albo wycinek
// (`accentCategory`) wyróżniony akcentem palety ról.
//
// Zapis jest INDEKSEM liczonym od zera, jak w bloku CMS i w parserze, ale
// autor wybiera NAZWĘ - listę budują serie albo kategorie z danych widgetu.
// Wybór domyślny (pierwsza seria, największy wycinek) zapisuje `null`, czyli
// „brak wyboru", a nie jawne zero: arkusz danych zapisuje go tak samo, więc
// obie drogi dają ten sam stan treści.
import { PropField } from "@/components/admin/builder/ui/atoms/PropField";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import type { SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import { parseChartData } from "@/lib/charts/csv";
import { accentIndex } from "./chartGridState";
import { useChartEditorT } from "./chartEditorI18n";

/** Klucz danych widgetu wykresu (schemat: pole `chartData` o kluczu `data`). */
const DATA_KEY = "data";

const napis = (v: unknown): string => (typeof v === "string" ? v : "");

export function ChartAccentField({ field, content, setContent }: SchemaFieldEditorProps) {
  const bl = useBuilderLabel();
  const t = useChartEditorT();
  const label = bl(field.label);
  const kategoria = field.key === "accentCategory";
  const { categories, series } = parseChartData(napis(content[DATA_KEY]));
  const pozycje = kategoria ? categories : series.map((s) => s.name);
  const biezacy = accentIndex(content[field.key], pozycje.length);
  const wartosc = biezacy === null ? (kategoria ? "" : "0") : String(biezacy);
  const nazwa = (i: number) =>
    pozycje[i] ||
    t(kategoria ? "chartEditor.grid.categoryN" : "chartEditor.grid.seriesN", { n: i + 1 });

  return (
    <PropField label={label} hint={bl(field.hint)}>
      {pozycje.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("chartEditor.colors.empty")}</p>
      ) : (
        <AdminSelect
          className="h-8 text-xs"
          value={wartosc}
          aria-label={label}
          onChange={(e) => {
            const raw = e.target.value;
            const n = raw === "" ? null : Number(raw);
            // Pierwsza seria to wybór domyślny - zapis jako brak wyboru.
            setContent(field.key, n === null || (!kategoria && n === 0) ? null : n);
          }}
        >
          {kategoria && <option value="">{t("chartEditor.accent.categoryAuto")}</option>}
          {pozycje.map((_, i) => (
            <option key={i} value={String(i)}>
              {nazwa(i)}
            </option>
          ))}
        </AdminSelect>
      )}
    </PropField>
  );
}
