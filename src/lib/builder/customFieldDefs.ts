// Czysta część modelu pól własnych formularzy (`customFields`): typy, parser
// treści widgetu, rozwiązywanie etykiet/placeholderów i walidacja po stronie
// klienta. Bez Reacta i bez importów wartości - renderer pól
// (`CustomFieldsRenderer`) zostaje w `formFieldConfig.tsx`, który reeksportuje
// stąd całe dotychczasowe API.
//
// GRANICA CHUNKÓW (P3.9). Importuje go WYŁĄCZNIE `formFieldConfig.tsx`
// (reeksport), więc moduł ma te same wejścia co renderer i ląduje w chunku
// formularza `JoinUsForm` bez scalania. Nie wolno go importować z modułów
// chunku wejściowego ani z dyspozytora widgetów (`WidgetView`,
// `ChromeWidgetView`, `widget-view/lazyWidgets`): Rollup z
// `experimentalMinChunkSize` dokleja mały moduł współdzielony przez kilka
// leniwych chunków do najtańszego wspólnego celu, a takim celem bywa chunk
// wejściowy - parser jechałby wtedy w domknięciu bootu każdej strony.
// Konsument z trasy albo widgetu podaje SUROWĄ wartość `content.customFields`
// (prop `customFieldsSource` w `JoinUsForm`), a parsuje ją leniwy chunk
// formularza.

export type CustomFieldType = "text" | "email" | "tel" | "url" | "textarea" | "select" | "checkbox";

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

export function resolveCustomFieldPlaceholder(f: CustomFieldDef, lang: "pl" | "en"): string {
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
  return fields.filter((f) => f.required && !(values[f.id] ?? "").trim()).map((f) => f.id);
}
