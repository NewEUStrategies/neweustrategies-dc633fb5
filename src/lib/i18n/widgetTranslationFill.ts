// Uzupełnianie tłumaczeń EN w treści widgetów buildera (PL -> EN).
//
// Warstwa czysta (bez Reacta, bez Supabase, bez sieci) dla skryptu
// `scripts/i18n-translate-widgets.ts`; panel `/admin/i18n` liczy te same braki
// audytem z `widgetTranslationAudit.ts` (wspólne `looksPolish`):
//
//   collectTranslatableTexts(doc, opts) -> unikalne teksty PL do przetłumaczenia
//   applyEnTranslations(doc, dict, opts) -> NOWY dokument z wypełnionymi `_en`
//
// Obie funkcje używają DOKŁADNIE tego samego predykatu `needsTranslation`, więc
// to, co skrypt wysyła do tłumaczenia, jest tym, co potem podmienia - żadnych
// rozjazdów między zbieraniem a zapisem. Dokument wejściowy nigdy nie jest
// mutowany (wynik to kopia drzewa obiektów i list).
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Czy para PL/EN wymaga (do)tłumaczenia. `defaultEn` / `defaultPl` to
 * szablonowa treść z palety - EN zostawione na szablonie przy ZMIENIONYM PL to
 * też brak tłumaczenia, mimo że pole nie jest puste.
 */
export function needsTranslation(
  pl: string,
  en: string | undefined,
  defaultEn?: string,
  defaultPl?: string,
): boolean {
  const plNorm = normalize(pl);
  if (!plNorm) return false;
  const enText = en ?? "";
  const enNorm = normalize(enText);
  if (!enNorm) return true;
  // EN identyczne z PL bywa POPRAWNE - nazwy własne, liczby, „Podcast",
  // „Transport", teksty już napisane po angielsku. Tłumaczymy tylko wtedy, gdy
  // źródło faktycznie wygląda po polsku (audyt klasyfikuje resztę jako
  // ostrzeżenie `same_as_pl`, nie błąd).
  if (enNorm === plNorm) return looksPolish(pl);
  if (looksPolish(enText)) return true;
  const defNorm = normalize(defaultEn ?? "");
  if (!defNorm || enNorm !== defNorm) return false;
  // Nietknięte EN palety jest poprawnym tłumaczeniem nietkniętego PL palety -
  // ta sama reguła co `stale_default` w audycie (PL porównywane z szablonowym
  // PL). Bez tego skrypt nadpisywał kuratorowane EN szablonu tłumaczeniem
  // maszynowym. Gdy szablonowe PL nie jest znane, zostaje dawne przybliżenie
  // (PL różne od szablonowego EN).
  return plNorm !== (defaultPl === undefined ? defNorm : normalize(defaultPl));
}

/** Para PL/EN jednego pola (albo jednego elementu listy) razem z szablonem palety. */
interface TextPair {
  pl: string;
  en: string | undefined;
  defaultEn: string | undefined;
  defaultPl: string | undefined;
}

type PairVisitor = (enKey: string, pair: TextPair, index?: number) => void;

const NO_DEFAULTS: Readonly<Record<string, unknown>> = {};

/**
 * Pary PL/EN jednego rekordu: pole tekstowe = jedna para, lista tekstów = para
 * na element (`index`). JEDYNE miejsce, które czyta kształt pól - zbieranie
 * i zapis widzą więc dokładnie te same pary (obietnica z nagłówka pliku).
 * Szablon list porównujemy element po elemencie: inaczej lista zostawiona na
 * szablonie EN, którą audyt zgłasza jako `stale_default`, nigdy nie trafiała
 * do tłumaczenia.
 */
function forEachPair(
  node: Record<string, unknown>,
  defaults: Readonly<Record<string, unknown>>,
  limit: number,
  visit: PairVisitor,
): void {
  for (const key of Object.keys(node)) {
    if (!key.endsWith("_pl")) continue;
    const enKey = `${key.slice(0, -3)}_en`;
    const pl = node[key];
    const en = node[enKey];
    const defEn = defaults[enKey];
    const defPl = defaults[key];
    if (typeof pl === "string") {
      if (pl.length > limit) continue;
      visit(enKey, {
        pl,
        en: asString(en),
        defaultEn: asString(defEn),
        defaultPl: asString(defPl),
      });
      continue;
    }
    if (!isStringList(pl)) continue;
    const enList: unknown[] = Array.isArray(en) ? en : [];
    pl.forEach((item, index) => {
      if (item.length > limit) return;
      visit(
        enKey,
        {
          pl: item,
          en: asString(enList[index]),
          defaultEn: Array.isArray(defEn) ? asString(defEn[index]) : undefined,
          defaultPl: Array.isArray(defPl) ? asString(defPl[index]) : undefined,
        },
        index,
      );
    });
  }
}

/**
 * Szablon palety obowiązujący w poddrzewie `node`: węzeł z `type` wnosi
 * szablon swojego widgetu (liczony RAZ na węzeł, nie na każdy rekord niżej),
 * reszta dziedziczy szablon przodka.
 */
function defaultsFor(
  node: Record<string, unknown>,
  inherited: Readonly<Record<string, unknown>>,
  opts: FillOptions,
): Readonly<Record<string, unknown>> {
  const type = node["type"];
  if (typeof type !== "string") return inherited;
  return opts.getDefaults?.(type) ?? NO_DEFAULTS;
}

/** Wspólne przejście po drzewie: woła `visit` dla każdej pary PL/EN pola tekstowego. */
function walkPairs(
  node: unknown,
  opts: FillOptions,
  visit: PairVisitor,
  inherited: Readonly<Record<string, unknown>> = NO_DEFAULTS,
): void {
  if (Array.isArray(node)) {
    for (const child of node) walkPairs(child, opts, visit, inherited);
    return;
  }
  if (!isRecord(node)) return;

  const defaults = defaultsFor(node, inherited, opts);
  forEachPair(node, defaults, opts.maxFieldChars ?? DEFAULT_MAX_FIELD_CHARS, visit);

  for (const value of Object.values(node)) {
    if (Array.isArray(value) || isRecord(value)) walkPairs(value, opts, visit, defaults);
  }
}

function pairNeedsTranslation(pair: TextPair): boolean {
  return needsTranslation(pair.pl, pair.en, pair.defaultEn, pair.defaultPl);
}

/** Unikalne teksty PL wymagające tłumaczenia (kolejność = pierwsze wystąpienie). */
export function collectTranslatableTexts(document: unknown, opts: FillOptions = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  walkPairs(document, opts, (_enKey, pair) => {
    if (!pairNeedsTranslation(pair)) return;
    if (seen.has(pair.pl)) return;
    seen.add(pair.pl);
    out.push(pair.pl);
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

  const clone = (node: unknown, inherited: Readonly<Record<string, unknown>>): unknown => {
    if (Array.isArray(node)) return node.map((child) => clone(child, inherited));
    if (!isRecord(node)) return node;

    const defaults = defaultsFor(node, inherited, opts);
    const next: Record<string, unknown> = { ...node };
    // Lista EN kopiowana przy PIERWSZYM zapisanym elemencie - lista bez
    // żadnego tłumaczenia zostaje tym samym obiektem co na wejściu.
    const touchedLists = new Map<string, unknown[]>();

    forEachPair(node, defaults, limit, (enKey, pair, index) => {
      if (!pairNeedsTranslation(pair)) return;
      const translated = dict.get(pair.pl);
      if (translated === undefined) {
        untranslated += 1;
        return;
      }
      applied += 1;
      if (index === undefined) {
        next[enKey] = translated;
        return;
      }
      let list = touchedLists.get(enKey);
      if (!list) {
        const en = node[enKey];
        list = Array.isArray(en) ? [...en] : [];
        touchedLists.set(enKey, list);
        next[enKey] = list;
      }
      list[index] = translated;
    });

    for (const key of Object.keys(next)) {
      const value = next[key];
      if (Array.isArray(value) || isRecord(value)) next[key] = clone(value, defaults);
    }
    return next;
  };

  return { document: clone(document, NO_DEFAULTS), applied, untranslated };
}
