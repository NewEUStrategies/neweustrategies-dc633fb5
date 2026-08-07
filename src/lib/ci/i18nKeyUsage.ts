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
}

export type KeyUsageReason =
  | "missing_pl"
  | "missing_en"
  | "missing_both"
  /** Gałąź dynamiczna istnieje, ale zbiory podkluczy PL i EN się różnią. */
  | "branch_mismatch"
  /** Prefiks dynamiczny nie prowadzi do gałęzi w słowniku. */
  | "branch_missing";

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

/** Statyczny prefiks template literala: `network.a.${x}` -> `network.a`. */
function templatePrefix(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith("`")) return null;
  const hole = text.indexOf("${");
  if (hole === -1) return null;
  const head = text.slice(1, hole);
  const trimmed = head.replace(/\.+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function readDefaultValue(options: string | undefined): string | null {
  if (options === undefined) return null;
  const match = /defaultValue\s*:\s*(["'`])((?:[^\\]|\\.)*?)\1/.exec(options);
  return match ? match[2] : null;
}

function hasCount(options: string | undefined): boolean {
  return options !== undefined && /(^|[^A-Za-z0-9_$])count\s*[:,}]/.test(options);
}

/**
 * Klucze przekazane do `t()` w jednym pliku. Wywołanie rozpoznajemy po
 * `t(` niepoprzedzonym znakiem identyfikatora, więc łapiemy zarówno `t(...)`,
 * jak i `i18n.t(...)`, a `split(`/`filter(`/`at(` zostają poza skanem.
 */
export function scanTranslationCalls(file: string, rawSource: string): KeyUsage[] {
  const source = maskComments(rawSource);
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
    const plural = hasCount(second);

    const literal = unquote(first);
    if (literal !== null && KEY_SHAPE.test(literal)) {
      out.push({ key: literal, kind: "literal", file, line, defaultValue, plural });
      continue;
    }
    const prefix = templatePrefix(first);
    if (prefix !== null && KEY_SHAPE.test(prefix)) {
      out.push({ key: prefix, kind: "prefix", file, line, defaultValue, plural });
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

    const inPl = hasLeaf(trees.pl, usage.key);
    const inEn = hasLeaf(trees.en, usage.key);
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
