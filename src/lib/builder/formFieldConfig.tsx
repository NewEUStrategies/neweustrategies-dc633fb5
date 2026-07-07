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

import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type CustomFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "checkbox";

export interface CustomFieldOption {
  value: string;
  labelPl?: string;
  labelEn?: string;
}

export interface CustomFieldDef {
  id: string;
  type: CustomFieldType;
  labelPl?: string;
  labelEn?: string;
  placeholderPl?: string;
  placeholderEn?: string;
  required?: boolean;
  maxLength?: number;
  options?: CustomFieldOption[];
}

/** True if `v` is a valid CustomFieldDef; forgiving about missing optional
 *  keys, strict about the required `id` + `type` shape. */
function isCustomFieldDef(v: unknown): v is CustomFieldDef {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return false;
  const t = o.type;
  return (
    t === "text" ||
    t === "email" ||
    t === "tel" ||
    t === "url" ||
    t === "textarea" ||
    t === "select" ||
    t === "checkbox"
  );
}

/** Parses the raw `customFields` value from widget content into a strict list.
 *  Accepts three shapes: a real array of objects, a stringArray (each line a
 *  JSON object), or a single JSON string containing an array. */
export function parseCustomFields(raw: unknown): CustomFieldDef[] {
  if (!raw) return [];
  const out: CustomFieldDef[] = [];
  const push = (v: unknown) => {
    if (isCustomFieldDef(v)) out.push(v);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        try {
          const parsed = JSON.parse(item);
          if (Array.isArray(parsed)) parsed.forEach(push);
          else push(parsed);
        } catch {
          /* skip malformed line */
        }
      } else {
        push(item);
      }
    }
    return out;
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) parsed.forEach(push);
      else push(parsed);
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Picks a language-scoped string from content (`${key}_pl|_en`) with fallback
 *  chain: current lang → PL → default. */
export function pickI18n(
  content: Record<string, unknown> | undefined,
  key: string,
  lang: "pl" | "en",
  fallback = "",
): string {
  if (!content) return fallback;
  const langed = content[`${key}_${lang}`];
  if (typeof langed === "string" && langed.trim()) return langed;
  const pl = content[`${key}_pl`];
  if (typeof pl === "string" && pl.trim()) return pl;
  return fallback;
}

export function resolveCustomFieldLabel(f: CustomFieldDef, lang: "pl" | "en"): string {
  const primary = lang === "en" ? f.labelEn : f.labelPl;
  if (primary && primary.trim()) return primary;
  const secondary = lang === "en" ? f.labelPl : f.labelEn;
  return secondary?.trim() || f.id;
}

export function resolveCustomFieldPlaceholder(
  f: CustomFieldDef,
  lang: "pl" | "en",
): string {
  const primary = lang === "en" ? f.placeholderEn : f.placeholderPl;
  if (primary && primary.trim()) return primary;
  const secondary = lang === "en" ? f.placeholderPl : f.placeholderEn;
  return secondary?.trim() || "";
}

/** Client-side validation: returns list of field ids that are required and
 *  empty. Server re-validates via `enforce_form_field_policy` + widget schema. */
export function validateCustomFields(
  fields: CustomFieldDef[],
  values: Record<string, string>,
): string[] {
  return fields
    .filter((f) => f.required && !(values[f.id] ?? "").trim())
    .map((f) => f.id);
}

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
    inputClassName ||
    "px-3 py-2 rounded border border-input bg-background text-sm w-full";

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
            <label key={f.id} className="sm:col-span-2 block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {label}
                {f.required && <span className="ml-1 text-destructive">*</span>}
              </span>
              <textarea
                {...commonAria}
                value={value}
                onChange={(e) => onChange(f.id, e.target.value)}
                placeholder={placeholder}
                required={f.required}
                maxLength={f.maxLength ?? 2000}
                rows={4}
                className={cn(baseInput, "resize-y min-h-[80px]")}
                style={inputStyle}
                data-edit-target={inputEditTarget}
              />
            </label>
          );
        }

        if (f.type === "select") {
          return (
            <label key={f.id} className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {label}
                {f.required && <span className="ml-1 text-destructive">*</span>}
              </span>
              <select
                {...commonAria}
                value={value}
                onChange={(e) => onChange(f.id, e.target.value)}
                required={f.required}
                className={baseInput}
                style={inputStyle}
                data-edit-target={inputEditTarget}
              >
                <option value="">{placeholder || "-"}</option>
                {(f.options ?? []).map((o) => {
                  const oLabel =
                    (lang === "en" ? o.labelEn : o.labelPl) || o.labelPl || o.labelEn || o.value;
                  return (
                    <option key={o.value} value={o.value}>
                      {oLabel}
                    </option>
                  );
                })}
              </select>
            </label>
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
          f.type === "email" ? "email" : f.type === "tel" ? "tel" : f.type === "url" ? "url" : "text";

        return (
          <input
            key={f.id}
            type={inputType}
            value={value}
            onChange={(e) => onChange(f.id, e.target.value)}
            placeholder={
              placeholder ? (f.required ? `${placeholder} *` : placeholder) : label
            }
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
