// Pole schematu `chartSeriesColors` - kolory serii widgetu wykresu.
//
// ZAŚLEPKA P0a. Typ pola istnieje w `FieldType`, a `SchemaFieldControl` kieruje
// go tutaj, zanim edytor wykresu (W5) dostanie wybór koloru z próbkami. Do tego
// czasu pole jest ZWYKŁYM polem tekstowym związanym z kluczem: zapis jest
// napisem POZYCYJNYM numerów slotów palety ("3;4;8" - seria 1, 2, 3), pusty
// napis oznacza kolory domyślne. Panel działa więc od pierwszego dnia, a pełny
// komponent podmienia wyłącznie ten plik.
import { Input } from "@/components/ui/input";
import { PropField } from "@/components/admin/builder/ui/atoms/PropField";
import type { SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

export function ChartSeriesColorsField({ field, content, setContent }: SchemaFieldEditorProps) {
  const bl = useBuilderLabel();
  const label = bl(field.label);
  const raw = content[field.key];
  return (
    <PropField label={label} hint={bl(field.hint)}>
      <Input
        value={typeof raw === "string" ? raw : ""}
        placeholder={bl(field.placeholder)}
        aria-label={label}
        onChange={(e) => setContent(field.key, e.target.value)}
        className="h-8 text-xs"
      />
    </PropField>
  );
}
