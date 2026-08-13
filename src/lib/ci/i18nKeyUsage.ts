// Czysta logika bramki „cichego rozjazdu słownika".
//
// Bramka parytetu (src/lib/ci/i18nParity.ts) porównuje DWA SŁOWNIKI ze sobą:
// wyłapie klucz obecny w PL i brakujący w EN. Nie wyłapie natomiast przypadku,
// od którego rozjazd zwykle się zaczyna: klucza, który jest UŻYWANY w kodzie,
// a nie istnieje w ŻADNYM słowniku. Taki klucz nie psuje niczego widocznie,
// bo `t()` zwraca albo goły klucz, albo - i to jest gorszy wariant - polski
// `defaultValue` wpisany przy wywołaniu. Efekt: PL wygląda dobrze, EN cicho
// dostaje polski tekst, a parytet świeci na zielono, bo w słownikach nie ma
// czego porównywać.
//
// Ten moduł domyka lukę od strony KODU: skanuje źródła, wyciąga klucze
// przekazane do `t()` (łącznie z template literalami i notką `defaultValue`),
// dokłada klucze referowane pośrednio (stałe/mapy/propsy trzymające ścieżkę
// klucza) i konfrontuje je z gotowymi drzewami zasobów PL/EN.
//
// Moduł nie zna i18next ani systemu plików - dostaje treść plików i drzewa
// zasobów, więc jest w pełni testowalny (patrz src/lib/ci/__tests__).
import { readKey, type ResourceTree } from "./i18nParity";

/** Rodzaj użycia klucza w kodzie. */
export type KeyUsageKind =
  /** `t("network.connect")` - pełna ścieżka klucza. */
  | "literal"
  /** `t(`network.reportReasons.${r}`)` - znany jest tylko prefiks gałęzi. */
  | "prefix"
  /**
   * `t(`blocks.toolbar.padY_${size}`)` - interpolacja domyka NAZWĘ LIŚCIA, nie
   * wybiera go z gałęzi. Rozróżnienie ma znaczenie: `prefix` sprawdza się przez
   * porównanie ZBIORÓW podkluczy, a tutaj żadna gałąź `padY_` nie istnieje -
   * istnieją liście `padY_sm`, `padY_md`. Traktowanie tego jak `prefix` dawało
   * 8 fałszywych `branch_missing` przy skanie całego `src`.
   */
  | "partial"
  /** Ścieżka klucza w stałej / mapie / propsie, oddana do `t()` gdzie indziej. */
  | "reference";

export interface KeyUsage {
  readonly key: string;
  readonly kind: KeyUsageKind;
  readonly file: string;
  /** 1-indeksowana linia wystąpienia (do klikalnego raportu). */
  readonly line: number;
  /** Literał `defaultValue` z opcji `t()` - nośnik cichego rozjazdu. */
  readonly defaultValue: string | null;
  /** Czy wywołanie przekazuje `count` (klucz rozwija się na formy mnogie). */
  readonly plural: boolean;
  /**
   * Czy wywołanie przekazuje `returnObjects: true` - wtedy wartością klucza ma
   * być TABLICA albo obiekt, nie napis (`pricing.faq`, `pricing.comparisonMatrix.rows`).
   * Bez tego rozróżnienia bramka ma dwie dziury naraz: zgłasza istniejące
   * tablice jako brak, a przemilcza wywołanie, które oczekuje napisu tam, gdzie
   * słownik trzyma tablicę - i to drugie renderuje użytkownikowi „[object Object]".
   */
  readonly returnsObjects: boolean;
}

export type KeyUsageReason =
  | "missing_pl"
  | "missing_en"
  | "missing_both"
  /** Gałąź dynamiczna istnieje, ale zbiory podkluczy PL i EN się różnią. */
  | "branch_mismatch"
  /** Prefiks dynamiczny nie prowadzi do gałęzi w słowniku. */
  | "branch_missing"
  /** Rodzic liścia domykanego interpolacją (`padY_${x}`) nie istnieje. */
  | "partial_parent_missing"
  /**
   * Rodzic istnieje, ale zbiory liści o tym początku różnią się między PL i EN -
   * czyli jedna wartość słownika kodu renderuje się w jednym języku, a w drugim
   * zostawia goły klucz. Dokładnie ten defekt co `club.sort.subscribed`.
   */
  | "partial_mismatch";

export interface KeyUsageFinding {
  readonly usage: KeyUsage;
  readonly reason: KeyUsageReason;
  /** Szczegół dla `branch_mismatch` - podklucze obecne tylko po jednej stronie. */
  readonly detail?: string;
}

export interface KeyUsageAudit {
  /** Klucze bez wpisu w PL i/lub EN, użyte bez `defaultValue`. */
  readonly missing: readonly KeyUsageFinding[];
  /**
   * Klucze bez wpisu, ZAMASKOWANE `defaultValue` - najgroźniejsza klasa:
   * język źródłowy wygląda poprawnie, drugi dostaje tekst z kodu.
   */
  readonly masked: readonly KeyUsageFinding[];
  /** Rozjazdy gałęzi dynamicznych (`t(`prefix.${x}`)`). */
  readonly branches: readonly KeyUsageFinding[];
}

export interface KeyUsageOptions {
  /**
   * Prefiksy (korzenie), dla których gołe literały tekstowe w kodzie są
   * traktowane jako referencje do kluczy. Wywołania `t("...")` są zbierane
   * ZAWSZE - również z literówką w korzeniu, bo to właśnie taki błąd bramka
   * ma pokazać.
   */
  readonly referencePrefixes?: readonly string[];
  /** Ścieżki kluczy świadomie nieobecnych w słowniku (np. techniczne stuby). */
  readonly ignoreKeys?: readonly string[];
}

/** Kategorie liczby mnogiej i18next (CLDR) - PL używa też `few`/`many`. */
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"] as const;

/** Klucz i18n: `a.b.c` - segmenty alfanumeryczne, bez spacji i myślników. */
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;

const IDENT_BEFORE_T = /[A-Za-z0-9_$]/;

interface ParsedCall {
  readonly args: readonly string[];
  /** Indeks znaku za zamykającym nawiasem. */
  readonly end: number;
}

/**
 * Wycina argumenty wywołania od pozycji otwierającego nawiasu, balansując
 * nawiasy i pomijając wnętrza łańcuchów oraz komentarzy. Zwraca `null` przy
 * niedomkniętym wywołaniu (np. ucięty plik) - skaner ma nie wybuchać na
 * niepełnym wejściu.
 */
function parseCallArgs(source: string, openParen: number): ParsedCall | null {
  const args: string[] = [];
  let depth = 0;
  let argStart = openParen + 1;
  let quote: string | null = null;
  let index = openParen;

  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];

    if (quote !== null) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", index);
      index = eol === -1 ? source.length : eol;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", index);
      index = close === -1 ? source.length : close + 2;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0 && ch === ")") {
        args.push(source.slice(argStart, index));
        return { args, end: index + 1 };
      }
      index += 1;
      continue;
    }
    if (ch === "," && depth === 1) {
      args.push(source.slice(argStart, index));
      argStart = index + 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  return null;
}

/**
 * Zamienia treść komentarzy na spacje, zachowując długość pliku i podział na
 * linie (offsety i numery linii pozostają dokładne). Dzięki temu oba skanery
 * pracują na kodzie, a przykłady w komentarzach - `// t("network.old")` -
 * nie są liczone jako użycie klucza.
 *
 * Świadome ograniczenie: literały wyrażeń regularnych nie są parsowane, więc
 * regex zawierający dosłowne `//` zostałby wzięty za komentarz. W kodzie
 * aplikacji taki wzorzec nie występuje.
 */
export function maskComments(source: string): string {
  const out = source.split("");
  let quote: string | null = null;
  let index = 0;

  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  while (index < source.length) {
    const ch = source[index];
    if (quote !== null) {
      if (ch === "\\") {
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === "/" && source[index + 1] === "/") {
      const eol = source.indexOf("\n", index);
      const end = eol === -1 ? source.length : eol;
      blank(index, end);
      index = end;
      continue;
    }
    if (ch === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index);
      const end = close === -1 ? source.length : close + 2;
      blank(index, end);
      index = end;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function unquote(raw: string): string | null {
  const text = raw.trim();
  if (text.length < 2) return null;
  const quote = text[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  if (text[text.length - 1] !== quote) return null;
  const inner = text.slice(1, -1);
  // Łańcuch sklejany (`"a" + b`) albo interpolowany template - nie literał.
  if (inner.includes(quote)) return null;
  return inner;
}

/**
 * Statyczna głowa template literala z informacją, CO domyka interpolacja:
 *   `network.a.${x}`        -> { head: "network.a",            kind: "prefix"  }
 *   `blocks.pad_${size}`    -> { head: "blocks.pad_",          kind: "partial" }
 *
 * Kropka na końcu głowy znaczy „wybierz podklucz z tej gałęzi"; jej brak znaczy
 * „dolep resztę do nazwy liścia". To dwa różne sprawdzenia i pomylenie ich daje
 * fałszywe `branch_missing` (gałąź `pad_` nie istnieje, bo istnieją `pad_sm`,
 * `pad_md`).
 */
function templateHead(raw: string): { head: string; kind: "prefix" | "partial" } | null {
  const text = raw.trim();
  if (!text.startsWith("`")) return null;
  const hole = text.indexOf("${");
  if (hole === -1) return null;
  const head = text.slice(1, hole);
  if (head.endsWith(".")) {
    const trimmed = head.replace(/\.+$/, "");
    return trimmed.length > 0 ? { head: trimmed, kind: "prefix" } : null;
  }
  // Głowa bez kropki musi mieć co najmniej jeden segment rodzica, inaczej nie ma
  // czego sprawdzać (`${x}.foo` albo `foo${x}` bez ścieżki).
  return head.includes(".") ? { head, kind: "partial" } : null;
}

/**
 * `defaultValue` w OBU formach, jakie przyjmuje i18next:
 *
 *   t("k", { defaultValue: "..." })              - opcja w obiekcie
 *   t("k", "...")   /   t("k", "...", { ... })   - drugi argument POZYCYJNY
 *
 * Forma pozycyjna była dla tego skanera niewidzialna i to ona siedziała
 * w `SiteSettingsHistoryDialog.tsx`: dziesięć kluczy nieobecnych w słowniku,
 * z polskim tekstem wpisanym w kod, czyli angielski interfejs renderował
 * polszczyznę. Sam brak klucza skaner zgłaszał - ale jako `missing_both`,
 * więc licznik `masked` pokazywał ZERO przy realnym długu tej klasy.
 * Klasyfikacja nie jest kosmetyką: `missing` widać w przeglądarce od razu
 * (goły klucz), `masked` wygląda poprawnie w jednym języku i wychodzi tylko
 * po przełączeniu na drugi.
 */
function readDefaultValue(second: string | undefined): string | null {
  if (second === undefined) return null;
  // Drugi argument będący literałem to `defaultValue` - obiekt opcji nie
  // przechodzi przez `unquote`, więc rozgałęzienie jest bezpieczne.
  const positional = unquote(second);
  if (positional !== null) return positional;
  const match = /defaultValue\s*:\s*(["'`])((?:[^\\]|\\.)*?)\1/.exec(second);
  return match ? match[2] : null;
}

/**
 * Argumenty `t()`, które mogą być OBIEKTEM OPCJI: wszystko po kluczu, poza
 * pozycyjnym `defaultValue` (ten jest literałem napisowym).
 *
 * i18next przyjmuje `t(k, opts)` ORAZ `t(k, default, opts)`, więc opcje stoją
 * raz na drugiej, raz na trzeciej pozycji. Pytanie tylko o drugi argument dawało
 * dziurę bliźniaczą do tej z `defaultValue`: przy pozycyjnym domyślniku ginął
 * `count`, czyli klucz z formami mnogimi wyglądał na klucz pojedynczy.
 */
function optionArgs(args: readonly (string | undefined)[]): string[] {
  return args
    .slice(1)
    .filter((arg): arg is string => arg !== undefined)
    .filter((arg) => unquote(arg) === null);
}

function hasCount(args: readonly (string | undefined)[]): boolean {
  return optionArgs(args).some((arg) => /(^|[^A-Za-z0-9_$])count\s*[:,}]/.test(arg));
}

function hasReturnObjects(args: readonly (string | undefined)[]): boolean {
  return optionArgs(args).some((arg) => /returnObjects\s*:\s*true/.test(arg));
}

/**
 * Zasięgi `keyPrefix` w pliku - `useTranslation(ns, { keyPrefix: "admin" })`
 * skleja prefiks z KAŻDYM kluczem wołanym przez `t()` z tego haka.
 *
 * PO CO TO ISTNIEJE. Bez tego skaner raportuje `t("themeOptions.loading")`
 * jako klucz nieistniejący, choć hak dokleja `admin.` i panel renderuje się
 * poprawnie. Na `ThemeOptionsPane.tsx` dawało to 182 fałszywe alarmy naraz -
 * czyli tyle, że bramka rozszerzona na całe `src` byłaby nie do włączenia.
 *
 * ZASIĘG LICZONY POZYCJĄ, nie parsowaniem AST: `useTranslation()` stoi na
 * początku ciała komponentu, a `t()` niżej, więc dla każdego wywołania `t()`
 * obowiązuje NAJBLIŻSZY POPRZEDZAJĄCY hak. Ten sam plik może mieszać haki
 * z prefiksem i bez (`ThemeOptionsPane` ma 5 z i 2 bez) i ta reguła to
 * rozstrzyga poprawnie. Heurystyka, nie dowód - dlatego bramka ma kanarek
 * (`scanKeyUsage` musi znaleźć znane klucze), który wyłapie jej rozjazd.
 */
interface PrefixScope {
  readonly at: number;
  readonly keyPrefix: string | null;
}

function readKeyPrefixScopes(source: string): PrefixScope[] {
  const scopes: PrefixScope[] = [];
  for (const match of source.matchAll(/\buseTranslation\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    const call = parseCallArgs(source, open);
    if (call === null) {
      scopes.push({ at: match.index, keyPrefix: null });
      continue;
    }
    const options = call.args[1];
    const prefix =
      options === undefined ? null : /keyPrefix\s*:\s*(["'`])([^"'`]*)\1/.exec(options);
    scopes.push({ at: match.index, keyPrefix: prefix === null ? null : prefix[2] });
  }
  return scopes;
}

function prefixAt(scopes: readonly PrefixScope[], index: number): string | null {
  let active: string | null = null;
  for (const scope of scopes) {
    if (scope.at > index) break;
    active = scope.keyPrefix;
  }
  return active;
}

/**
 * Klucze przekazane do `t()` w jednym pliku. Wywołanie rozpoznajemy po
 * `t(` niepoprzedzonym znakiem identyfikatora, więc łapiemy zarówno `t(...)`,
 * jak i `i18n.t(...)`, a `split(`/`filter(`/`at(` zostają poza skanem.
 */
export function scanTranslationCalls(file: string, rawSource: string): KeyUsage[] {
  const source = maskComments(rawSource);
  const scopes = readKeyPrefixScopes(source);
  const out: KeyUsage[] = [];
  for (let i = 0; i < source.length - 1; i += 1) {
    if (source[i] !== "t" || source[i + 1] !== "(") continue;
    const before = i > 0 ? source[i - 1] : "";
    if (before !== "" && IDENT_BEFORE_T.test(before)) continue;

    const call = parseCallArgs(source, i + 1);
    if (call === null) continue;
    const [first, second] = call.args;
    if (first === undefined) continue;

    const line = lineOf(source, i);
    const defaultValue = readDefaultValue(second);
    const plural = hasCount(call.args);
    const returnsObjects = hasReturnObjects(call.args);
    // `i18n.t(...)` / `i18next.t(...)` omija hak, wiec NIE dostaje `keyPrefix`.
    // `t(...)` z destrukturyzacji haka - dostaje prefiks obowiazujacy w tym miejscu.
    const viaHook = before !== ".";
    const scoped = viaHook ? prefixAt(scopes, i) : null;
    const withScope = (key: string): string => (scoped === null ? key : `${scoped}.${key}`);

    const literal = unquote(first);
    if (literal !== null && KEY_SHAPE.test(literal)) {
      out.push({
        key: withScope(literal),
        kind: "literal",
        file,
        line,
        defaultValue,
        plural,
        returnsObjects,
      });
      continue;
    }
    const template = templateHead(first);
    if (template === null) continue;
    // `partial` ma w kluczu końcówkę nazwy liścia (`padY_`), więc nie przechodzi
    // przez `KEY_SHAPE` - ten wzorzec opisuje pełną ścieżkę. Walidujemy rodzica.
    const shapeOk =
      template.kind === "prefix"
        ? KEY_SHAPE.test(template.head)
        : KEY_SHAPE.test(template.head.slice(0, template.head.lastIndexOf(".")));
    if (shapeOk) {
      out.push({
        key: withScope(template.head),
        kind: template.kind,
        file,
        line,
        defaultValue,
        plural,
        returnsObjects,
      });
    }
  }
  return out;
}

/**
 * Gołe literały w kształcie klucza (stałe, mapy kodów błędów, propsy typu
 * `emptyKey="network.introductions.emptyBridge"`). Ograniczone do podanych
 * korzeni, żeby nie łapać ścieżek importów ani nazw pól.
 */
export function scanKeyReferences(
  file: string,
  rawSource: string,
  referencePrefixes: readonly string[],
): KeyUsage[] {
  if (referencePrefixes.length === 0) return [];
  const source = maskComments(rawSource);
  const out: KeyUsage[] = [];
  const literals = /(["'`])([A-Za-z0-9_.]+)\1/g;
  let match = literals.exec(source);
  while (match !== null) {
    const key = match[2];
    const rooted = referencePrefixes.some((p) => key === p || key.startsWith(`${p}.`));
    if (rooted && KEY_SHAPE.test(key)) {
      out.push({
        key,
        kind: "reference",
        file,
        line: lineOf(source, match.index),
        defaultValue: null,
        plural: false,
        returnsObjects: false,
      });
    }
    match = literals.exec(source);
  }
  return out;
}

/** Pełny skan jednego pliku (wywołania + referencje), bez duplikatów. */
export function scanKeyUsage(
  file: string,
  source: string,
  options: KeyUsageOptions = {},
): KeyUsage[] {
  const calls = scanTranslationCalls(file, source);
  const references = scanKeyReferences(file, source, options.referencePrefixes ?? []);
  const seen = new Set(calls.map((u) => `${u.kind}:${u.key}`));
  const extra = references.filter((u) => {
    const literalDup = seen.has(`literal:${u.key}`) || seen.has(`prefix:${u.key}`);
    if (literalDup || seen.has(`reference:${u.key}`)) return false;
    seen.add(`reference:${u.key}`);
    return true;
  });
  return [...calls, ...extra];
}

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Czy klucz ma w drzewie wartość tekstową - wprost lub przez formy mnogie. */
function hasLeaf(tree: ResourceTree, key: string): boolean {
  if (typeof readKey(tree, key) === "string") return true;
  return PLURAL_SUFFIXES.some((suffix) => typeof readKey(tree, `${key}${suffix}`) === "string");
}

/**
 * Klucz wołany z `returnObjects: true` jest zaspokojony przez TABLICĘ albo
 * obiekt - takie są `pricing.faq` i `pricing.comparisonMatrix.rows`, i taki
 * kształt zwraca i18next. Bez tego oba wyglądały na brak w słowniku, choć
 * leżą w nim w obu językach.
 *
 * Ale tylko dla wywołań, które o obiekt POPROSIŁY: `t("pricing.faq")` bez
 * `returnObjects` dostaje od i18next tablicę, którą React wyrenderuje jako
 * napis - i to jest defekt, którego bramka nie ma prawa przemilczeć.
 */
function hasEntry(tree: ResourceTree, key: string, wantsObject: boolean): boolean {
  if (!wantsObject) return hasLeaf(tree, key);
  const node = readKey(tree, key);
  return Array.isArray(node) || (node !== null && typeof node === "object");
}

/** Podklucze gałęzi bez wariantów mnogich (PL ma `few`/`many`, EN nie). */
function branchMembers(node: ResourceTree): Set<string> {
  const out = new Set<string>();
  for (const name of Object.keys(node)) {
    out.add(name.replace(/_(zero|one|two|few|many|other)$/, ""));
  }
  return out;
}

/**
 * Konfrontuje użycia kluczy z drzewami PL/EN. Rozdziela braki „widoczne"
 * od zamaskowanych `defaultValue`, bo tylko te drugie potrafią przejechać
 * przez review niezauważone.
 */
export function auditKeyUsage(
  usages: readonly KeyUsage[],
  trees: { readonly pl: ResourceTree; readonly en: ResourceTree },
  options: KeyUsageOptions = {},
): KeyUsageAudit {
  const ignore = new Set(options.ignoreKeys ?? []);
  const missing: KeyUsageFinding[] = [];
  const masked: KeyUsageFinding[] = [];
  const branches: KeyUsageFinding[] = [];

  for (const usage of usages) {
    if (ignore.has(usage.key)) continue;

    if (usage.kind === "partial") {
      // `blocks.toolbar.padY_${x}` -> rodzic `blocks.toolbar`, początek `padY_`.
      const cut = usage.key.lastIndexOf(".");
      const parent = usage.key.slice(0, cut);
      const stem = usage.key.slice(cut + 1);
      const plNode = readKey(trees.pl, parent);
      const enNode = readKey(trees.en, parent);
      if (!isTree(plNode) || !isTree(enNode)) {
        branches.push({ usage, reason: "partial_parent_missing" });
        continue;
      }
      const withStem = (node: ResourceTree): Set<string> =>
        new Set([...branchMembers(node)].filter((m) => m.startsWith(stem)));
      const plLeaves = withStem(plNode);
      const enLeaves = withStem(enNode);
      const onlyPl = [...plLeaves].filter((m) => !enLeaves.has(m));
      const onlyEn = [...enLeaves].filter((m) => !plLeaves.has(m));
      if (onlyPl.length > 0 || onlyEn.length > 0) {
        branches.push({
          usage,
          reason: "partial_mismatch",
          detail: `tylko PL: [${onlyPl.join(", ")}] / tylko EN: [${onlyEn.join(", ")}]`,
        });
      }
      continue;
    }

    if (usage.kind === "prefix") {
      const plNode = readKey(trees.pl, usage.key);
      const enNode = readKey(trees.en, usage.key);
      if (!isTree(plNode) || !isTree(enNode)) {
        branches.push({ usage, reason: "branch_missing" });
        continue;
      }
      const plMembers = branchMembers(plNode);
      const enMembers = branchMembers(enNode);
      const onlyPl = [...plMembers].filter((m) => !enMembers.has(m));
      const onlyEn = [...enMembers].filter((m) => !plMembers.has(m));
      if (onlyPl.length > 0 || onlyEn.length > 0) {
        branches.push({
          usage,
          reason: "branch_mismatch",
          detail: `tylko PL: [${onlyPl.join(", ")}] / tylko EN: [${onlyEn.join(", ")}]`,
        });
      }
      continue;
    }

    const inPl = hasEntry(trees.pl, usage.key, usage.returnsObjects);
    const inEn = hasEntry(trees.en, usage.key, usage.returnsObjects);
    if (inPl && inEn) continue;

    const reason: KeyUsageReason =
      !inPl && !inEn ? "missing_both" : inPl ? "missing_en" : "missing_pl";
    const finding: KeyUsageFinding = { usage, reason };
    if (usage.defaultValue !== null) masked.push(finding);
    else missing.push(finding);
  }

  return { missing, masked, branches };
}

export function keyUsageFailed(audit: KeyUsageAudit): boolean {
  return audit.missing.length > 0 || audit.masked.length > 0 || audit.branches.length > 0;
}

function renderFinding(finding: KeyUsageFinding): string {
  const { usage } = finding;
  const where = `${usage.file}:${usage.line}`;
  const detail = finding.detail !== undefined ? ` (${finding.detail})` : "";
  const masked = usage.defaultValue !== null ? ` [defaultValue: "${usage.defaultValue}"]` : "";
  return `  - ${usage.key} @ ${where} -> ${finding.reason}${detail}${masked}`;
}

/** Czytelny raport dla komunikatu asercji w bramce. */
export function renderKeyUsageReport(audit: KeyUsageAudit): string {
  const lines: string[] = [];
  if (audit.masked.length > 0) {
    lines.push(
      `Klucze bez wpisu w słowniku, ZAMASKOWANE defaultValue (${audit.masked.length}) - drugi język dostaje tekst z kodu:`,
      ...audit.masked.map(renderFinding),
    );
  }
  if (audit.missing.length > 0) {
    lines.push(
      `Klucze użyte w kodzie bez wpisu w słowniku (${audit.missing.length}):`,
      ...audit.missing.map(renderFinding),
    );
  }
  if (audit.branches.length > 0) {
    lines.push(
      `Gałęzie kluczy dynamicznych z rozjazdem PL/EN (${audit.branches.length}):`,
      ...audit.branches.map(renderFinding),
    );
  }
  return lines.length === 0 ? "Brak rozjazdów słownika." : lines.join("\n");
}
