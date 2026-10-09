// Pole schematu `mapScheme` - schemat barw kartogramu.
//
// ZAŚLEPKA P0a. Typ pola istnieje w `FieldType`, a `SchemaFieldControl` kieruje
// go tutaj, zanim edytor mapy (W6) dostanie wybór schematu z próbkami skali. Do
// tego czasu pole jest ZWYKŁĄ listą wyboru z opcji schematu (etykiety źródłowe
// po polsku, angielskie przez `BUILDER_LABELS_EN`), a bez opcji - polem
// tekstowym. Pusty zapis znaczy „domyślny schemat" parsera.
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField } from "@/components/admin/builder/ui/atoms/PropField";
import type { SchemaFieldEditorProps } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

/** Wartość listy wyboru dla pustego zapisu - Radix nie przyjmuje `""`. */
const EMPTY = "__default__";

export function MapSchemeField({ field, content, setContent }: SchemaFieldEditorProps) {
  const bl = useBuilderLabel();
  const label = bl(field.label);
  const raw = content[field.key];
  const value = typeof raw === "string" ? raw : "";
  const options = field.options ?? [];

  if (options.length === 0) {
    return (
      <PropField label={label} hint={bl(field.hint)}>
        <Input
          value={value}
          placeholder={bl(field.placeholder)}
          aria-label={label}
          onChange={(e) => setContent(field.key, e.target.value.trim())}
          className="h-8 text-xs"
        />
      </PropField>
    );
  }

  const current = value === "" ? (options[0]?.value ?? "") : value;
  return (
    <PropField label={label} hint={bl(field.hint)}>
      <Select
        value={current === "" ? EMPTY : current}
        onValueChange={(v) => setContent(field.key, v === EMPTY ? "" : v)}
      >
        <SelectTrigger className="h-8 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value || EMPTY} value={o.value === "" ? EMPTY : o.value}>
              {bl(o.label) ?? o.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PropField>
  );
}
