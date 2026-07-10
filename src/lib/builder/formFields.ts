// Shared helpers for widget-form fields.
// - readI18nOverride(): safely read per-widget i18n overrides for labels /
//   placeholders (falls back when the config value is missing/empty)
// - parseCustomFields(): parse the widget `customFields` JSON-array field
//   (one object per line, as edited in schemas.ts) into a strict type
// - customFieldsToPayload(): flatten form data for a set of custom fields
//   into a { [id]: string } map (values trimmed, empty removed)

export type Lang = "pl" | "en";

export type CustomFieldType = "text" | "email" | "tel" | "url" | "textarea" | "select" | "checkbox";

export interface CustomFieldOption {
  value: string;
  labelPl?: string;
  labelEn?: string;
}

export interface CustomField {
  id: string;
  type: CustomFieldType;
  labelPl?: string;
  labelEn?: string;
  placeholderPl?: string;
  placeholderEn?: string;
  required?: boolean;
  options?: CustomFieldOption[];
  maxLength?: number;
}

type Cfg = Record<string, unknown>;

/**
 * Read a per-language override from a widget config with a safe fallback.
 * Overrides use the pattern `${key}_${lang}` (e.g. `firstNameLabel_pl`).
 */
export function readI18nOverride(data: Cfg, baseKey: string, lang: Lang, fallback: string): string {
  const v = data[`${baseKey}_${lang}`];
  if (typeof v === "string" && v.trim()) return v;
  const vAlt = data[`${baseKey}_${lang === "pl" ? "en" : "pl"}`];
  if (typeof vAlt === "string" && vAlt.trim()) return vAlt;
  return fallback;
}

const ALLOWED_TYPES: ReadonlySet<CustomFieldType> = new Set([
  "text",
  "email",
  "tel",
  "url",
  "textarea",
  "select",
  "checkbox",
]);

function toStr(v: unknown, max = 500): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}

function parseOptions(raw: unknown): CustomFieldOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CustomFieldOption[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const value = toStr(o.value, 200);
    if (!value) continue;
    out.push({
      value,
      labelPl: toStr(o.labelPl, 200),
      labelEn: toStr(o.labelEn, 200),
    });
  }
  return out.length ? out : undefined;
}

/**
 * Parse the `customFields` widget field. Value shape from schemas.ts is an
 * array of JSON strings (one object per line). We accept:
 *   - string[]  (schema stringArray editor)
 *   - unknown[] (already-parsed objects)
 *   - unknown   (defensive fallthrough)
 * Silently drops malformed entries.
 */
export function parseCustomFields(raw: unknown): CustomField[] {
  if (!raw) return [];
  const items: unknown[] = Array.isArray(raw) ? raw : [];
  const out: CustomField[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let obj: Record<string, unknown> | null = null;
    if (typeof item === "string") {
      const t = item.trim();
      if (!t) continue;
      try {
        const parsed: unknown = JSON.parse(t);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          obj = parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      obj = item as Record<string, unknown>;
    }
    if (!obj) continue;

    const id = toStr(obj.id, 64);
    if (!id || seen.has(id)) continue;
    const rawType = typeof obj.type === "string" ? obj.type.toLowerCase() : "text";
    const type = (
      ALLOWED_TYPES.has(rawType as CustomFieldType) ? rawType : "text"
    ) as CustomFieldType;

    out.push({
      id,
      type,
      labelPl: toStr(obj.labelPl, 200),
      labelEn: toStr(obj.labelEn, 200),
      placeholderPl: toStr(obj.placeholderPl, 200),
      placeholderEn: toStr(obj.placeholderEn, 200),
      required: obj.required === true || obj.required === "1" || obj.required === "true",
      options: parseOptions(obj.options),
      maxLength:
        typeof obj.maxLength === "number" && Number.isFinite(obj.maxLength)
          ? Math.min(4000, Math.max(1, Math.floor(obj.maxLength)))
          : undefined,
    });
    seen.add(id);
  }
  return out;
}

/**
 * Pick the label / placeholder in the current language, with graceful
 * fallback to the other language and finally the field id.
 */
export function pickLabel(field: CustomField, lang: Lang): string {
  return (
    (lang === "pl" ? field.labelPl : field.labelEn) ??
    (lang === "pl" ? field.labelEn : field.labelPl) ??
    field.id
  );
}
export function pickPlaceholder(field: CustomField, lang: Lang): string {
  return (
    (lang === "pl" ? field.placeholderPl : field.placeholderEn) ??
    (lang === "pl" ? field.placeholderEn : field.placeholderPl) ??
    ""
  );
}

/**
 * Extract submitted values for a list of custom fields from a FormData.
 * Returns { [id]: string } - trimmed, empty removed, capped at 500 chars.
 */
export function collectCustomValues(
  fields: readonly CustomField[],
  fd: FormData,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const name = `custom_${f.id}`;
    let val: string;
    if (f.type === "checkbox") {
      val = fd.get(name) === "on" ? "1" : "";
    } else {
      const raw = fd.get(name);
      val = typeof raw === "string" ? raw.trim() : "";
    }
    if (!val) continue;
    out[f.id] = val.slice(0, 500);
  }
  return out;
}

/**
 * Client-side "required" validation for custom fields. Returns a map
 * of { [id]: errorText } for empty required fields.
 */
export function validateCustom(
  fields: readonly CustomField[],
  values: Record<string, string>,
  errorText: string,
): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of fields) {
    if (!f.required) continue;
    if (!values[f.id]) errs[f.id] = errorText;
  }
  return errs;
}
