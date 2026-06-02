// Molecule: renders a single content field based on its declarative schema entry.
// Used by ContentFields to drive simple widget editors from `WIDGET_SCHEMAS`.
import type { Json } from "@/lib/builder/types";
import type { SchemaField as SchemaFieldDef } from "@/lib/builder/schemas";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField } from "../atoms/PropField";
import { ImageSlot } from "../organisms/widget-properties/ImageSlot";
import { Image as ImageIcon } from "lucide-react";

interface Props {
  field: SchemaFieldDef;
  lang: "pl" | "en";
  content: Record<string, unknown>;
  setContent: (key: string, value: Json) => void;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function SchemaFieldControl({ field, lang, content, setContent }: Props) {
  if (field.visibleWhen && !field.visibleWhen(content)) return null;

  const langSuffix = lang.toUpperCase();
  const i18nKey = `${field.key}_${lang}`;

  switch (field.type) {
    case "text":
    case "url":
      return (
        <PropField label={field.label} hint={field.hint}>
          <Input
            value={asString(content[field.key])}
            placeholder={field.placeholder}
            onChange={(e) => setContent(field.key, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      );

    case "i18nText":
      return (
        <PropField label={`${field.label} (${langSuffix})`} hint={field.hint}>
          <Input
            value={asString(content[i18nKey])}
            placeholder={field.placeholder}
            onChange={(e) => setContent(i18nKey, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      );

    case "i18nHtml":
      return (
        <PropField label={`${field.label} (${langSuffix})`} hint={field.hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asString(content[i18nKey])}
            onChange={(e) => setContent(i18nKey, e.target.value)}
            className="text-xs font-mono"
          />
        </PropField>
      );

    case "textarea":
      return (
        <PropField label={field.label} hint={field.hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asString(content[field.key])}
            onChange={(e) => setContent(field.key, e.target.value)}
            className="text-xs"
          />
        </PropField>
      );

    case "number":
      return (
        <PropField label={field.label} hint={field.hint}>
          <Input
            type="number"
            min={field.min}
            max={field.max}
            value={asNumber(content[field.key])}
            onChange={(e) => setContent(field.key, Number(e.target.value))}
            className="h-8 text-xs"
          />
        </PropField>
      );

    case "select":
      return (
        <PropField label={field.label} hint={field.hint}>
          <Select
            value={asString(content[field.key]) || (field.options?.[0]?.value ?? "")}
            onValueChange={(v) => setContent(field.key, v)}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {field.options?.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label ?? o.value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
      );

    case "stringArray":
      return (
        <PropField label={field.label} hint={field.hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asStringArray(content[field.key]).join("\n")}
            onChange={(e) => setContent(
              field.key,
              e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
            )}
            className="text-xs font-mono"
          />
        </PropField>
      );
  }
}
