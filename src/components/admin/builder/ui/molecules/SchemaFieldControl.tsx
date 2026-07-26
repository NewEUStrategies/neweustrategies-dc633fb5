// Molecule: renders a single content field based on its declarative schema entry.
// Used by ContentFields to drive simple widget editors from `WIDGET_SCHEMAS`.
import { useState } from "react";
import { toJson } from "@/lib/builder/types";
import type { Json } from "@/lib/builder/types";
import type { SchemaField as SchemaFieldDef } from "@/lib/builder/schemas";
import { Input } from "@/components/ui/input";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PropField } from "../atoms/PropField";
import { ImageSlot } from "../organisms/widget-properties/ImageSlot";
import { ChartDataSpreadsheetDialog } from "./ChartDataSpreadsheetDialog";
import { MediaPickerDialog } from "@/components/admin/media/MediaPickerDialog";
import { LucideIconPicker } from "./LucideIconPicker";
import { Image as ImageIcon, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";



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
  const { t } = useTranslation();
  const [urlPickerOpen, setUrlPickerOpen] = useState(false);
  if (field.visibleWhen && !field.visibleWhen(content)) return null;

  const langSuffix = lang.toUpperCase();
  const i18nKey = `${field.key}_${lang}`;

  switch (field.type) {
    case "text":
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

    case "url":
      return (
        <PropField label={field.label} hint={field.hint}>
          <div className="flex items-center gap-1.5">
            <Input
              value={asString(content[field.key])}
              placeholder={field.placeholder}
              onChange={(e) => setContent(field.key, e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <button
              type="button"
              onClick={() => setUrlPickerOpen(true)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-[6px] border border-border px-2 text-[11px] text-muted-foreground hover:border-brand hover:bg-muted/30 hover:text-foreground"
              title={t("builder.imageSlot.pickFromLibrary", { defaultValue: "Wybierz z biblioteki" })}
              aria-label={t("builder.imageSlot.pickFromLibrary", { defaultValue: "Wybierz z biblioteki" })}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("builder.imageSlot.mediaLibrary", { defaultValue: "Biblioteka" })}</span>
            </button>
          </div>
          <MediaPickerDialog
            open={urlPickerOpen}
            onOpenChange={setUrlPickerOpen}
            onPick={(url) => {
              setContent(field.key, url);
              setUrlPickerOpen(false);
            }}
            title={t("builder.imageSlot.pickFromLibrary", { defaultValue: "Wybierz z biblioteki" })}
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

    case "chartData":
      return (
        <PropField label={field.label} hint={field.hint}>
          <div className="space-y-2">
            <Textarea
              rows={field.rows ?? 6}
              value={asString(content[field.key])}
              onChange={(e) => setContent(field.key, e.target.value)}
              className="text-xs font-mono"
              placeholder="; Seria A; Seria B&#10;2024; 12; 8"
            />
            <ChartDataSpreadsheetDialog
              value={asString(content[field.key])}
              onChange={(v) => setContent(field.key, v)}
              kind={asString(content["kind"])}
              unit={asString(content["unit"])}
              title={asString(content[`title_${lang}`]) || asString(content["title_pl"])}
              lang={lang}
            />
          </div>
        </PropField>
      );

    case "number": {
      const raw = content[field.key];
      const hasValue = typeof raw === "number" && Number.isFinite(raw);
      const display = hasValue
        ? String(raw)
        : typeof field.default === "number"
          ? String(field.default)
          : "";
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
              if (s === "") {
                setContent(field.key, toJson(null));
                return;
              }
              const n = Number(s);
              if (Number.isFinite(n)) setContent(field.key, n);
            }}
            className="h-8 text-xs"
          />
        </PropField>
      );
    }

    case "select": {
      const EMPTY = "__default__";
      const raw = asString(content[field.key]);
      const current = raw === "" ? EMPTY : raw || field.options?.[0]?.value || EMPTY;
      return (
        <PropField label={field.label} hint={field.hint}>
          <Select
            value={current}
            onValueChange={(v) => setContent(field.key, v === EMPTY ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((o) => (
                <SelectItem key={o.value || EMPTY} value={o.value === "" ? EMPTY : o.value}>
                  {o.label ?? o.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
      );
    }

    case "color": {
      const value = asString(content[field.key]);
      return (
        <PropField label={field.label} hint={field.hint}>
          <AdminColorPicker
            value={value}
            onChange={(v) => setContent(field.key, v ?? "")}
            ariaLabel={field.label}
            allowTransparent={true}
            allowReset={true}
            placeholder="dziedziczy z global colors (lub transparent)"
          />
        </PropField>
      );
    }

    case "stringArray":
      return (
        <PropField label={field.label} hint={field.hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asStringArray(content[field.key]).join("\n")}
            onChange={(e) =>
              setContent(
                field.key,
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            className="text-xs font-mono"
          />
        </PropField>
      );
  }
}
