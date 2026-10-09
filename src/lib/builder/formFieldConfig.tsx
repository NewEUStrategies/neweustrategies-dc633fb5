// Shared plumbing for the "hybrid" per-widget form-field customisation model.
//
// Widgets declare in their content:
//   - per-predefined-field overrides: show{Key}, require{Key}, {key}Label_pl|_en,
//     {key}Placeholder_pl|_en (see src/lib/builder/schemas.ts helpers).
//   - customFields: JSON array of extra inputs, stored as a `stringArray`
//     (one JSON object per line) so the editor stays a plain textarea.
//
// This module centralises: parsing customFields, resolving i18n label /
// placeholder from content with sensible fallbacks, and rendering the custom
// inputs. All form widgets (Join Us, Contact Form, Newsletter, auth) can share
// the same primitives to guarantee identical UX + validation.
//
// Czysta część (typy, parser, etykiety, walidacja) żyje w `customFieldDefs.ts`
// i jest tu reeksportowana bez zmian API (P3.9). Ten moduł niesie renderer,
// a z nim `FormSelect` (Radix Select) i kompozytor wiadomości ze wzmiankami,
// więc importuje go wyłącznie leniwy chunk formularza - nigdy dyspozytor
// widgetów ani moduł chunku wejściowego.

import { useMemo, type CSSProperties } from "react";
import { FormSelect } from "@/components/atoms/FormSelect";
import { MessageComposerField } from "@/components/forms/MessageComposerField";
import { cn } from "@/lib/utils";
import {
  resolveCustomFieldLabel,
  resolveCustomFieldPlaceholder,
  type CustomFieldDef,
} from "./customFieldDefs";

export {
  parseCustomFields,
  pickI18n,
  resolveCustomFieldLabel,
  resolveCustomFieldPlaceholder,
  validateCustomFields,
} from "./customFieldDefs";
export type { CustomFieldType, CustomFieldOption, CustomFieldDef } from "./customFieldDefs";

interface RendererProps {
  fields: CustomFieldDef[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
  lang: "pl" | "en";
  className?: string;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  inputEditTarget?: string;
}

/** Renders the configured custom inputs. Controlled: parent owns the value map
 *  and forwards it as `_custom` to the server function. */
export function CustomFieldsRenderer({
  fields,
  values,
  onChange,
  lang,
  className,
  inputClassName,
  inputStyle,
  inputEditTarget,
}: RendererProps) {
  const stable = useMemo(() => fields, [fields]);
  if (!stable.length) return null;

  const baseInput =
    inputClassName || "px-3 py-2 rounded border border-input bg-background text-sm w-full";

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {stable.map((f) => {
        const label = resolveCustomFieldLabel(f, lang);
        const placeholder = resolveCustomFieldPlaceholder(f, lang);
        const value = values[f.id] ?? "";
        const commonAria = {
          "aria-label": label,
          "aria-required": f.required || undefined,
        } as const;

        if (f.type === "textarea") {
          return (
            <MessageComposerField
              key={f.id}
              className="sm:col-span-2"
              label={label}
              value={value}
              onChange={(next) => onChange(f.id, next)}
              placeholder={placeholder}
              required={f.required}
              maxLength={f.maxLength ?? 2000}
              rows={4}
              lang={lang}
              textareaClassName="min-h-[80px]"
              textareaStyle={inputStyle}
              dataEditTarget={inputEditTarget}
            />
          );
        }

        if (f.type === "select") {
          const options = (f.options ?? []).map((o) => ({
            value: o.value,
            label: (lang === "en" ? o.labelEn : o.labelPl) || o.labelPl || o.labelEn || o.value,
          }));
          return (
            <div key={f.id} className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {label}
                {f.required && <span className="ml-1 text-destructive">*</span>}
              </span>
              <FormSelect
                aria-label={commonAria["aria-label"]}
                value={value}
                onValueChange={(v) => onChange(f.id, v)}
                required={f.required}
                options={options}
                placeholder={placeholder || (lang === "en" ? "Choose..." : "Wybierz...")}
                className={baseInput}
                style={inputStyle}
                data-edit-target={inputEditTarget}
              />
            </div>
          );
        }

        if (f.type === "checkbox") {
          const checked = value === "1" || value === "true";
          return (
            <label
              key={f.id}
              className="sm:col-span-2 flex items-start gap-2 text-sm text-muted-foreground"
              style={inputStyle}
              data-edit-target={inputEditTarget}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(f.id, e.target.checked ? "1" : "")}
                required={f.required}
                aria-required={f.required || undefined}
                className="mt-0.5"
              />
              <span>
                {label}
                {f.required && <span className="ml-1 text-destructive">*</span>}
              </span>
            </label>
          );
        }

        const inputType =
          f.type === "email"
            ? "email"
            : f.type === "tel"
              ? "tel"
              : f.type === "url"
                ? "url"
                : "text";

        return (
          <input
            key={f.id}
            type={inputType}
            value={value}
            onChange={(e) => onChange(f.id, e.target.value)}
            placeholder={placeholder ? (f.required ? `${placeholder} *` : placeholder) : label}
            required={f.required}
            aria-required={f.required || undefined}
            aria-label={label}
            maxLength={f.maxLength ?? 300}
            className={baseInput}
            style={inputStyle}
            data-edit-target={inputEditTarget}
          />
        );
      })}
    </div>
  );
}
