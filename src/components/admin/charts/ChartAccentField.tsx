// Pole schematu `chartAccent` - seria (albo kategoria) wyróżniona akcentem.
//
// ZAŚLEPKA P0a. Typ pola istnieje w `FieldType`, a `SchemaFieldControl` kieruje
// go tutaj, zanim edytor wykresu (W5) dostanie listę serii z próbkami ról. Do
// tego czasu pole jest ZWYKŁYM polem liczby związanym z kluczem: zapisuje
// INDEKS liczony od zera (tak czyta go parser), a pusty wpis zapisuje `null`,
// czyli „domyślnie" (pierwsza seria albo największy wycinek). Wpis niebędący
// liczbą nie trafia do treści.
import { Input } from "@/components/ui/input";
import { PropField } from "@/components/admin/builder/ui/atoms/PropField";
import type { SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

export function ChartAccentField({ field, content, setContent }: SchemaFieldEditorProps) {
  const bl = useBuilderLabel();
  const label = bl(field.label);
  const raw = content[field.key];
  const value = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
  return (
    <PropField label={label} hint={bl(field.hint)}>
      <Input
        type="number"
        min={field.min ?? 0}
        max={field.max}
        step={1}
        value={value}
        placeholder={bl(field.placeholder)}
        aria-label={label}
        onChange={(e) => {
          const text = e.target.value.trim();
          if (text === "") {
            setContent(field.key, null);
            return;
          }
          const n = Number(text);
          if (Number.isInteger(n) && n >= 0) setContent(field.key, n);
        }}
        className="h-8 text-xs"
      />
    </PropField>
  );
}
