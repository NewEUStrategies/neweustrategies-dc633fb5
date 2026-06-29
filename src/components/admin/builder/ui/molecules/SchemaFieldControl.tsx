// Molecule: renders a single content field based on its declarative schema entry.
// Used by ContentFields to drive simple widget editors from `WIDGET_SCHEMAS`.
import { toJson } from "@/lib/builder/types";
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

    case "image":
      return (
        <ImageSlot
          label={field.label}
          icon={<ImageIcon className="w-3 h-3" />}
          value={asString(content[field.key])}
          onChange={(v) => setContent(field.key, v)}
          hint={field.hint}
        />
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

    case "number": {
      const raw = content[field.key];
      const hasValue = typeof raw === "number" && Number.isFinite(raw);
      const display = hasValue ? String(raw) : (typeof field.default === "number" ? String(field.default) : "");
      return (
        <PropField label={field.label} hint={field.hint}>
          <Input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={display}
            placeholder={typeof field.default === "number" ? String(field.default) : undefined}
            onChange={(e) => {
              const s = e.target.value;
              if (s === "") { setContent(field.key, toJson(null)); return; }
              const n = Number(s);
              if (Number.isFinite(n)) setContent(field.key, n);
            }}
            className="h-8 text-xs"
          />
        </PropField>
      );
    }

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

    case "color": {
      const value = asString(content[field.key]);
      const safe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : "";
      return (
        <PropField label={field.label} hint={field.hint}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={safe || "#888888"}
              onChange={(e) => setContent(field.key, e.target.value)}
              className="h-8 w-10 rounded border border-border bg-background cursor-pointer p-0"
              aria-label={field.label}
            />
            <Input
              value={value}
              placeholder="#RRGGBB lub puste"
              onChange={(e) => setContent(field.key, e.target.value)}
              className="h-8 text-xs flex-1"
            />
            {value ? (
              <button
                type="button"
                onClick={() => setContent(field.key, "")}
                className="h-8 px-2 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded"
                aria-label="Wyczyść kolor"
              >
                Reset
              </button>
            ) : null}
          </div>
        </PropField>
      );
    }

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
