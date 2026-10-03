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
  // Bez treści PL nie ma czego tłumaczyć: pusta para, wartość nietekstowa
  // albo treść tylko po angielsku (np. cytat źródłowy) - żadna z nich nie jest
  // defektem PL->EN. Jedno wyjście zamiast trzech osobnych sprawdzeń, które
  // i tak kończyły się tym samym `null`.
  const plNorm = normalize(toText(pl) ?? "");
  if (!plNorm) return null;
  const enText = toText(en) ?? "";
  const enNorm = normalize(enText);

  const defPl = normalize(toText(defaults.pl) ?? "");
  const defEn = normalize(toText(defaults.en) ?? "");
  if (defEn && enNorm === defEn && plNorm !== defPl) return "stale_default";

  if (!enNorm) return "missing";
  if (looksPolish(enText)) return "pl_text_in_en";
  if (enNorm === plNorm) return "same_as_pl";
  return null;
}

interface WidgetRef {
  id: string;
  type: string;
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

  /** Pary `_pl`/`_en` jednego rekordu treści, zgłaszane pod widgetem `widget`. */
  const auditPairs = (
    widget: WidgetRef,
    record: Record<string, unknown>,
    defaults: Record<string, unknown>,
  ) => {
    for (const key of Object.keys(record)) {
      if (!key.endsWith("_pl")) continue;
      const plText = toText(record[key]);
      if (plText === null) continue;
      const base = key.slice(0, -3);
      const enKey = `${base}_en`;
      const kind = classifyPair(plText, record[enKey], { pl: defaults[key], en: defaults[enKey] });
      if (!kind) continue;
      issues.push({
        widgetId: widget.id,
        widgetType: widget.type,
        field: base,
        kind,
        severity: SEVERITY[kind],
        pl: preview(plText),
        en: preview(toText(record[enKey]) ?? ""),
      });
    }
  };

  // `owner` = widget, w którego treści właśnie jesteśmy. Kolekcje wewnątrz
  // widgetu (items, slides, faq...) są audytowane NA KAŻDEJ GŁĘBOKOŚCI:
  // domyślne treści palety mają pary dwa poziomy niżej (mega-menu
  // `columns[].links[]` i `columns[].featured`, program wydarzenia
  // `days[].sessions[]`, sponsorzy `tiers[].sponsors[]`), a renderer robi dla
  // nich ten sam fallback na PL. Wcześniejsza wersja schodziła tylko o jeden
  // poziom kolekcji, więc te pola były niewidoczne dla audytu, choć
  // `widgetTranslationFill` je tłumaczy. Defaultów dla kolekcji nie znamy,
  // więc tam bez stale_default.
  const walk = (node: unknown, owner: WidgetRef | null): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, owner);
      return;
    }
    if (!isRecord(node)) return;
    if (seen.has(node)) return;
    seen.add(node);

    const type = node["type"];
    const content = node["content"];
    if (typeof type === "string" && isRecord(content)) {
      const widget: WidgetRef = { id: typeof node["id"] === "string" ? node["id"] : "", type };
      // `content` oznaczony jako odwiedzony - inaczej jego pary wróciłyby
      // drugi raz jako „kolekcja", już bez porównania z szablonem.
      seen.add(content);
      auditPairs(widget, content, getDefaults(type) ?? {});
      for (const value of Object.values(content)) walk(value, widget);
      // Poza `content` (style, ustawienia, dzieci) treści widgetu nie ma -
      // szukamy tam wyłącznie kolejnych widgetów.
      for (const [key, value] of Object.entries(node)) {
        if (key !== "content") walk(value, null);
      }
      return;
    }
    if (owner) auditPairs(owner, node, {});
    for (const value of Object.values(node)) walk(value, owner);
  };

  walk(document, null);
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
