// Audyt tłumaczeń treści widgetów buildera (PL -> EN).
//
// Cała treść publiczna mieszka w widgetach: każde pole tekstowe jest zapisane
// jako para `${key}_pl` / `${key}_en` (patrz `schemas.ts`, typy `i18nText`
// i `i18nHtml`). Renderer robi fallback na PL, gdy EN jest puste - dzięki temu
// strona nigdy nie jest pusta, ale JEDNOCZEŚNIE brak tłumaczenia jest
// niewidoczny dla redakcji. Ten moduł czyni go widocznym.
//
// Wykrywane klasy defektów (kolejność = malejąca pewność, że to błąd):
//
//   1. `stale_default`  - EN jest dokładnie domyślną wartością widgetu z
//      palety, a PL już nie. Klasyczny efekt "dodałem widget, przetłumaczyłem
//      tylko PL": nagłówek "Poznaj nas bliżej" renderuje po angielsku
//      szablonowe "Join us".
//   2. `pl_text_in_en`  - w polu EN siedzi tekst polski (diakrytyki lub
//      polskie słowa funkcyjne).
//   3. `missing`        - PL wypełnione, EN puste -> render pokaże polski
//      tekst na stronie /en.
//   4. `same_as_pl`     - EN identyczne z PL. Bywa poprawne (nazwy własne,
//      "Podcast"), więc to ostrzeżenie, nie błąd.
//
// Moduł jest czysty i wolny od Reacta / Supabase: przyjmuje dowolny JSON
// buildera i (opcjonalnie) funkcję zwracającą domyślną treść widgetu, żeby nie
// wciągać ciężkiego `registry.tsx` do warstwy danych ani do testów.

export type WidgetI18nIssueKind = "stale_default" | "pl_text_in_en" | "missing" | "same_as_pl";

export type WidgetI18nSeverity = "error" | "warning";

export interface WidgetI18nIssue {
  /** Id węzła widgetu w drzewie buildera (do deep-linku w edytorze). */
  widgetId: string;
  widgetType: string;
  /** Klucz bazowy bez sufiksu, np. "text" dla pary text_pl/text_en. */
  field: string;
  kind: WidgetI18nIssueKind;
  severity: WidgetI18nSeverity;
  /** Skrócone podglądy wartości (bez HTML) do listy w panelu. */
  pl: string;
  en: string;
}

export type WidgetDefaultsLookup = (widgetType: string) => Record<string, unknown> | undefined;

const SEVERITY: Record<WidgetI18nIssueKind, WidgetI18nSeverity> = {
  stale_default: "error",
  pl_text_in_en: "error",
  missing: "error",
  same_as_pl: "warning",
};

/** Polskie diakrytyki + częste słowa funkcyjne, których angielski nie używa. */
const PL_DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const PL_STOPWORDS =
  /\b(oraz|jest|są|nie|dla|przez|który|która|które|naszych|naszego|nasze|nasza|nasz|wię(cej)?|zobacz|czytaj|strona|wpis|wpisy|jak|czym|się|tego|tych|aby|żeby|poznaj|dołącz|zapisz|wszystkie|polityka|prywatności|regulamin)\b/i;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalizacja do porównań: bez HTML, bez nadmiarowych spacji, lowercase. */
function normalize(value: string): string {
  return stripHtml(value).toLowerCase();
}

/** Zamienia wartość pola (string albo lista stringów) na tekst do porównania. */
function toText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (value as string[]).join(" | ");
  }
  return null;
}

/**
 * Czy tekst wygląda na polski (używane wyłącznie dla wartości pól EN).
 *
 * Polskie słowo funkcyjne przesądza sprawę od razu. Same diakrytyki nie
 * wystarczą: poprawnie przetłumaczony adres („ul. Tytusa Chałubińskiego 8,
 * 00-613 Warszawa") albo nazwa własna („Fundacja New European Strategies")
 * niosą polskie znaki, ale zdaniem nie są - dlatego dla dłuższych tekstów
 * wymagamy, by wyrazy z diakrytykami stanowiły zauważalny UŁAMEK całości.
 */
export function looksPolish(value: string): boolean {
  const text = stripHtml(value);
  if (text.length < 3) return false;
  if (PL_STOPWORDS.test(text)) return true;
  if (!PL_DIACRITICS.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return true;
  const diacritic = words.filter((w) => PL_DIACRITICS.test(w)).length;
  return diacritic / words.length > 0.15;
}

function preview(value: string, max = 120): string {
  const text = stripHtml(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Klasyfikuje pojedynczą parę PL/EN. `null` = pole jest w porządku. */
export function classifyPair(
  pl: unknown,
  en: unknown,
  defaults: { pl?: unknown; en?: unknown } = {},
): WidgetI18nIssueKind | null {
  const plText = toText(pl);
  const enText = toText(en);
  if (plText === null && enText === null) return null;

  const plNorm = normalize(plText ?? "");
  const enNorm = normalize(enText ?? "");
  if (!plNorm && !enNorm) return null;
  // Treść tylko po angielsku (np. cytat źródłowy) nie jest defektem PL->EN.
  if (!plNorm) return null;

  const defPl = normalize(toText(defaults.pl) ?? "");
  const defEn = normalize(toText(defaults.en) ?? "");
  if (defEn && enNorm === defEn && plNorm !== defPl) return "stale_default";

  if (!enNorm) return "missing";
  if (looksPolish(enText ?? "")) return "pl_text_in_en";
  if (enNorm === plNorm) return "same_as_pl";
  return null;
}

/**
 * Przechodzi całe drzewo buildera i zwraca listę defektów tłumaczeń, po jednym
 * na pole. Odporne na dowolny kształt JSON-a (stare rewizje, popupy, globalne
 * widgety) - interesują nas wyłącznie węzły z `type` i obiektem `content`.
 */
export function auditBuilderI18n(
  document: unknown,
  getDefaults: WidgetDefaultsLookup = () => undefined,
): WidgetI18nIssue[] {
  const issues: WidgetI18nIssue[] = [];
  const seen = new Set<object>();

  const visitContent = (widgetId: string, widgetType: string, content: Record<string, unknown>) => {
    const defaults = getDefaults(widgetType) ?? {};
    for (const key of Object.keys(content)) {
      if (!key.endsWith("_pl")) continue;
      const base = key.slice(0, -3);
      const kind = classifyPair(content[key], content[`${base}_en`], {
        pl: defaults[key],
        en: defaults[`${base}_en`],
      });
      if (!kind) continue;
      issues.push({
        widgetId,
        widgetType,
        field: base,
        kind,
        severity: SEVERITY[kind],
        pl: preview(toText(content[key]) ?? ""),
        en: preview(toText(content[`${base}_en`]) ?? ""),
      });
    }
    // Kolekcje wewnątrz widgetu (items, slides, faq...) - obiekty z własnymi
    // parami `_pl`/`_en`. Defaultów dla nich nie znamy, więc bez stale_default.
    for (const value of Object.values(content)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!isRecord(item)) continue;
        for (const key of Object.keys(item)) {
          if (!key.endsWith("_pl")) continue;
          const base = key.slice(0, -3);
          const kind = classifyPair(item[key], item[`${base}_en`]);
          if (!kind) continue;
          issues.push({
            widgetId,
            widgetType,
            field: base,
            kind,
            severity: SEVERITY[kind],
            pl: preview(toText(item[key]) ?? ""),
            en: preview(toText(item[`${base}_en`]) ?? ""),
          });
        }
      }
    }
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!isRecord(node)) return;
    if (seen.has(node)) return;
    seen.add(node);

    const type = node["type"];
    const content = node["content"];
    if (typeof type === "string" && isRecord(content)) {
      const id = typeof node["id"] === "string" ? node["id"] : "";
      visitContent(id, type, content);
    }
    for (const value of Object.values(node)) walk(value);
  };

  walk(document);
  return issues;
}

export interface WidgetI18nSummary {
  total: number;
  errors: number;
  warnings: number;
  byKind: Record<WidgetI18nIssueKind, number>;
}

export function summarizeI18nIssues(issues: readonly WidgetI18nIssue[]): WidgetI18nSummary {
  const byKind: Record<WidgetI18nIssueKind, number> = {
    stale_default: 0,
    pl_text_in_en: 0,
    missing: 0,
    same_as_pl: 0,
  };
  let errors = 0;
  for (const issue of issues) {
    byKind[issue.kind] += 1;
    if (issue.severity === "error") errors += 1;
  }
  return { total: issues.length, errors, warnings: issues.length - errors, byKind };
}
