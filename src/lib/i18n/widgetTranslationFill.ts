// Uzupełnianie tłumaczeń EN w treści widgetów buildera (PL -> EN).
//
// Warstwa czysta (bez Reacta, bez Supabase, bez sieci) współdzielona przez
// panel `/admin/i18n` i skrypt `scripts/i18n-translate-widgets.ts`:
//
//   collectTranslatableTexts(doc, opts) -> unikalne teksty PL do przetłumaczenia
//   applyEnTranslations(doc, dict, opts) -> NOWY dokument z wypełnionymi `_en`
//
// Obie funkcje używają DOKŁADNIE tego samego predykatu `needsTranslation`, więc
// to, co skrypt wysyła do tłumaczenia, jest tym, co potem podmienia - żadnych
// rozjazdów między zbieraniem a zapisem. Dokument wejściowy nigdy nie jest
// mutowany (kopiujemy tylko gałęzie, które faktycznie się zmieniają).
//
// Obsługiwane kształty pól, zgodnie ze schematami widgetów (`i18nText`,
// `i18nHtml` i ich listowe warianty):
//   - `${base}_pl: string`      -> `${base}_en: string`
//   - `${base}_pl: string[]`    -> `${base}_en: string[]` (element po elemencie)
// Kolekcje (`items`, `slides`, `faq`...) są przechodzone rekurencyjnie, bo to
// zwykłe obiekty w drzewie.
import { looksPolish } from "./widgetTranslationAudit";

/** Domyślna treść widgetu z palety - do wykrycia szablonowej wartości EN. */
export type WidgetDefaultsLookup = (widgetType: string) => Record<string, unknown> | undefined;

export interface FillOptions {
  /** Pomija pola dłuższe niż limit (import legacy HTML potrafi mieć setki kB). */
  maxFieldChars?: number;
  getDefaults?: WidgetDefaultsLookup;
}

const DEFAULT_MAX_FIELD_CHARS = 20_000;

function normalize(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Czy para PL/EN wymaga (do)tłumaczenia. `defaultEn` to szablonowa wartość
 * z palety - EN zostawione na szablonie przy zmienionym PL to też brak
 * tłumaczenia, mimo że pole nie jest puste.
 */
export function needsTranslation(pl: string, en: string | undefined, defaultEn?: string): boolean {
  const plNorm = normalize(pl);
  if (!plNorm) return false;
  const enNorm = normalize(en ?? "");
  if (!enNorm) return true;
  // EN identyczne z PL bywa POPRAWNE - nazwy własne, liczby, „Podcast",
  // „Transport", teksty już napisane po angielsku. Tłumaczymy tylko wtedy, gdy
  // źródło faktycznie wygląda po polsku (audyt klasyfikuje resztę jako
  // ostrzeżenie `same_as_pl`, nie błąd).
  if (enNorm === plNorm) return looksPolish(pl);
  if (looksPolish(en ?? "")) return true;
  const defNorm = normalize(defaultEn ?? "");
  return Boolean(defNorm) && enNorm === defNorm && plNorm !== defNorm;
}

type Visitor = (pl: string, en: string | undefined, defaultEn: string | undefined) => void;

/** Wspólne przejście po drzewie: woła `visit` dla każdej pary PL/EN pola tekstowego. */
function walkPairs(node: unknown, opts: FillOptions, visit: Visitor, widgetType?: string): void {
  if (Array.isArray(node)) {
    for (const child of node) walkPairs(child, opts, visit, widgetType);
    return;
  }
  if (!isRecord(node)) return;

  const type = typeof node["type"] === "string" ? (node["type"] as string) : widgetType;
  const defaults = type ? (opts.getDefaults?.(type) ?? {}) : {};
  const limit = opts.maxFieldChars ?? DEFAULT_MAX_FIELD_CHARS;

  for (const key of Object.keys(node)) {
    if (!key.endsWith("_pl")) continue;
    const base = key.slice(0, -3);
    const pl = node[key];
    const en = node[`${base}_en`];
    const def = defaults[`${base}_en`];
    if (typeof pl === "string") {
      if (pl.length > limit) continue;
      visit(pl, typeof en === "string" ? en : undefined, typeof def === "string" ? def : undefined);
      continue;
    }
    if (Array.isArray(pl) && pl.every((v) => typeof v === "string")) {
      const enList = Array.isArray(en) ? en : [];
      (pl as string[]).forEach((item, index) => {
        if (item.length > limit) return;
        const current = enList[index];
        visit(item, typeof current === "string" ? current : undefined, undefined);
      });
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value) || isRecord(value)) walkPairs(value, opts, visit, type);
  }
}

/** Unikalne teksty PL wymagające tłumaczenia (kolejność = pierwsze wystąpienie). */
export function collectTranslatableTexts(document: unknown, opts: FillOptions = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  walkPairs(document, opts, (pl, en, def) => {
    if (!needsTranslation(pl, en, def)) return;
    if (seen.has(pl)) return;
    seen.add(pl);
    out.push(pl);
  });
  return out;
}

export interface ApplyResult<T = unknown> {
  document: T;
  /** Liczba faktycznie zapisanych pól (nie tekstów - jeden tekst może się powtarzać). */
  applied: number;
  /** Teksty wymagające tłumaczenia, których zabrakło w słowniku. */
  untranslated: number;
}

/**
 * Zwraca NOWY dokument z polami `_en` uzupełnionymi ze słownika `pl -> en`.
 * Brak wpisu w słowniku = pole zostaje nietknięte (liczone w `untranslated`).
 */
export function applyEnTranslations(
  document: unknown,
  dictionary: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  opts: FillOptions = {},
): ApplyResult {
  const dict =
    dictionary instanceof Map ? dictionary : new Map(Object.entries(dictionary as object));
  let applied = 0;
  let untranslated = 0;
  const limit = opts.maxFieldChars ?? DEFAULT_MAX_FIELD_CHARS;

  const clone = (node: unknown, widgetType?: string): unknown => {
    if (Array.isArray(node)) return node.map((child) => clone(child, widgetType));
    if (!isRecord(node)) return node;

    const type = typeof node["type"] === "string" ? (node["type"] as string) : widgetType;
    const defaults = type ? (opts.getDefaults?.(type) ?? {}) : {};
    const next: Record<string, unknown> = { ...node };

    for (const key of Object.keys(node)) {
      if (!key.endsWith("_pl")) continue;
      const base = key.slice(0, -3);
      const pl = node[key];
      const en = node[`${base}_en`];
      const def = defaults[`${base}_en`];

      if (typeof pl === "string") {
        if (pl.length > limit) continue;
        if (
          !needsTranslation(
            pl,
            typeof en === "string" ? en : undefined,
            typeof def === "string" ? def : undefined,
          )
        ) {
          continue;
        }
        const translated = dict.get(pl);
        if (translated === undefined) {
          untranslated += 1;
          continue;
        }
        next[`${base}_en`] = translated;
        applied += 1;
        continue;
      }

      if (Array.isArray(pl) && pl.every((v) => typeof v === "string")) {
        const enList = Array.isArray(en) ? [...(en as unknown[])] : [];
        let touched = false;
        (pl as string[]).forEach((item, index) => {
          if (item.length > limit) return;
          const current = enList[index];
          if (!needsTranslation(item, typeof current === "string" ? current : undefined)) return;
          const translated = dict.get(item);
          if (translated === undefined) {
            untranslated += 1;
            return;
          }
          enList[index] = translated;
          applied += 1;
          touched = true;
        });
        if (touched) next[`${base}_en`] = enList;
      }
    }

    for (const key of Object.keys(next)) {
      const value = next[key];
      if (Array.isArray(value) || isRecord(value)) next[key] = clone(value, type);
    }
    return next;
  };

  return { document: clone(document), applied, untranslated };
}
