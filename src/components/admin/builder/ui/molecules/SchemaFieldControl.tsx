// Molecule: renders a single content field based on its declarative schema entry.
// Used by ContentFields to drive simple widget editors from `WIDGET_SCHEMAS`.
import { useState } from "react";
import { toJson } from "@/lib/builder/types";
import type { Json } from "@/lib/builder/types";
import { asBool } from "@/lib/content-model/contentValue";
import type { SchemaField as SchemaFieldDef } from "@/lib/builder/schemas";
import { Input } from "@/components/ui/input";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { PageUrlAutocomplete } from "./PageUrlAutocomplete";
import { RichHtmlField } from "./RichHtmlField";
import { Image as ImageIcon, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBuilderLabel } from "@/lib/builder/labelsEn";

interface Props {
  field: SchemaFieldDef;
  lang: "pl" | "en";
  content: Record<string, unknown>;
  setContent: (key: string, value: Json) => void;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** One entry per line, trimmed, empties dropped - shared by both array fields. */
const splitLines = (raw: string): string[] =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function SchemaFieldControl({ field, lang, content, setContent }: Props) {
  const { t } = useTranslation();
  // Schema copy is authored in Polish; render it in the admin's UI language.
  const bl = useBuilderLabel();
  const [urlPickerOpen, setUrlPickerOpen] = useState(false);
  if (field.visibleWhen && !field.visibleWhen(content)) return null;

  const langSuffix = lang.toUpperCase();
  const i18nKey = `${field.key}_${lang}`;

  /**
   * Odczyt wartości pola z uwzględnieniem kluczy HISTORYCZNYCH.
   *
   * Bez tego zmiana nazwy klucza w schemacie kosztowała cudzą treść: renderer
   * dalej rozumiał stary klucz (alias), ale panel pokazywał PUSTE pole, więc
   * redaktor widział "nieustawione" nad działającym ustawieniem - i pierwsza
   * edycja czegokolwiek innego utrwalała tę pustkę. Zapisujemy WYŁĄCZNIE klucz
   * kanoniczny, więc treść migruje sama przy pierwszej zmianie pola.
   */
  const read = (key: string): unknown => {
    const primary = content[key];
    if (primary !== undefined && primary !== null && primary !== "") return primary;
    for (const legacy of field.legacyKeys ?? []) {
      // Pole i18n ma klucz bazowy: alias dostaje ten sam sufiks języka.
      const candidate = key === i18nKey ? `${legacy}_${lang}` : legacy;
      const value = content[candidate];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return primary;
  };
  const label = bl(field.label);
  const hint = bl(field.hint);
  const placeholder = bl(field.placeholder);

  switch (field.type) {
    case "text":
      return (
        <PropField label={label} hint={hint}>
          <Input
            value={asString(read(field.key))}
            placeholder={placeholder}
            onChange={(e) => setContent(field.key, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      );

    case "url":
      return (
        <PropField label={label} hint={hint}>
          <div className="flex flex-col gap-1.5">
            <PageUrlAutocomplete
              value={asString(read(field.key))}
              onChange={(v) => setContent(field.key, v)}
              placeholder={placeholder}
              lang={lang}
            />

            <button
              type="button"
              onClick={() => setUrlPickerOpen(true)}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-[6px] border border-border px-2 text-[11px] text-muted-foreground hover:border-brand hover:bg-muted/30 hover:text-foreground"
              title={t("builder.imageSlot.pickFromLibrary")}
              aria-label={t("builder.imageSlot.pickFromLibrary")}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("builder.imageSlot.mediaLibrary")}</span>
            </button>
          </div>
          <MediaPickerDialog
            open={urlPickerOpen}
            onOpenChange={setUrlPickerOpen}
            onPick={(url) => {
              setContent(field.key, url);
              setUrlPickerOpen(false);
            }}
            title={t("builder.imageSlot.pickFromLibrary")}
          />
        </PropField>
      );

    case "icon":
      return (
        <PropField label={label} hint={hint}>
          <LucideIconPicker
            value={asString(read(field.key))}
            onChange={(v) => setContent(field.key, v ?? "")}
            placeholder={placeholder}
          />
        </PropField>
      );

    case "image":
      return (
        <ImageSlot
          label={label}
          icon={<ImageIcon className="w-3 h-3" />}
          value={asString(read(field.key))}
          onChange={(v) => setContent(field.key, v)}
          hint={hint}
        />
      );

    case "i18nText":
      return (
        <PropField label={`${label} (${langSuffix})`} hint={hint}>
          <Input
            value={asString(read(i18nKey))}
            placeholder={placeholder}
            onChange={(e) => setContent(i18nKey, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
      );

    case "i18nHtml":
      return (
        <PropField label={`${label} (${langSuffix})`} hint={hint}>
          <RichHtmlField
            value={asString(read(i18nKey))}
            onChange={(html: string) => setContent(i18nKey, html)}
            rows={field.rows ?? 4}
            ariaLabel={`${label} (${langSuffix})`}
          />
        </PropField>
      );

    case "textarea":
      return (
        <PropField label={label} hint={hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asString(read(field.key))}
            onChange={(e) => setContent(field.key, e.target.value)}
            className="text-xs"
          />
        </PropField>
      );

    case "chartData":
      return (
        <PropField label={label} hint={hint}>
          <div className="space-y-2">
            <Textarea
              rows={field.rows ?? 6}
              value={asString(read(field.key))}
              onChange={(e) => setContent(field.key, e.target.value)}
              className="text-xs font-mono"
              placeholder={t("builder.schemaField.chartDataPlaceholder")}
            />
            <ChartDataSpreadsheetDialog
              value={asString(read(field.key))}
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
      const raw = read(field.key);
      const hasValue = typeof raw === "number" && Number.isFinite(raw);
      const display = hasValue
        ? String(raw)
        : typeof field.default === "number"
          ? String(field.default)
          : "";
      return (
        <PropField label={label} hint={hint}>
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
      const raw = asString(read(field.key));
      const current = raw === "" ? EMPTY : raw || field.options?.[0]?.value || EMPTY;
      return (
        <PropField label={label} hint={hint}>
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
                  {bl(o.label) ?? o.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
      );
    }

    case "color": {
      const value = asString(read(field.key));
      return (
        <PropField label={label} hint={hint}>
          <AdminColorPicker
            value={value}
            onChange={(v) => setContent(field.key, v ?? "")}
            ariaLabel={label}
            allowTransparent={true}
            allowReset={true}
            inheritedValue={field.inheritedValue}
            placeholder={field.placeholder ?? t("builder.schemaField.colorInherits")}
          />
        </PropField>
      );
    }

    case "bool": {
      // Real booleans, never "0"/"1" strings: a string "0" is truthy, which is
      // exactly how several auth-form toggles ended up being impossible to
      // switch off. Readers still coerce via `asBool` for legacy content.
      const checked = asBool(read(field.key), field.default === true);
      return (
        <PropField label={label} hint={hint}>
          <div className="flex h-8 items-center">
            <Switch
              checked={checked}
              onCheckedChange={(next) => setContent(field.key, next)}
              aria-label={label}
            />
          </div>
        </PropField>
      );
    }

    case "stringArray":
      return (
        <PropField label={label} hint={hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asStringArray(read(field.key)).join("\n")}
            onChange={(e) => setContent(field.key, splitLines(e.target.value))}
            className="text-xs font-mono"
          />
        </PropField>
      );

    case "i18nStringArray":
      return (
        <PropField label={`${label} (${langSuffix})`} hint={hint}>
          <Textarea
            rows={field.rows ?? 4}
            value={asStringArray(read(i18nKey)).join("\n")}
            onChange={(e) => setContent(i18nKey, splitLines(e.target.value))}
            className="text-xs font-mono"
            aria-label={`${label} (${langSuffix})`}
          />
        </PropField>
      );
  }
}
