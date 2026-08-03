// Inwariant świeżości widgetów: zapytanie, które zależy od JĘZYKA, musi mieć
// język w kluczu cache.
//
// PROBLEM, KTÓRY TEN MODUŁ LIKWIDUJE
// `queryFn` slidera sortował po kolumnie `title_pl` albo `title_en`, a klucz
// zapytania języka nie zawierał. PL i EN dzieliły więc JEDEN wpis cache:
// ktokolwiek wszedł pierwszy, ustawiał kolejność dla obu wersji językowych na
// cały czas świeżości (a przy prefetchu SSR - także dla HTML-a serwera).
// Naprawa była punktowa (jeden test na jedno zapytanie), więc następne
// zapytanie mogło wprowadzić tę klasę od nowa i nic by nie zapłonęło.
//
// DWA NARZĘDZIA, DWIE POWIERZCHNIE
//  1. `langParamStyle` - konwencja parametru: fabryka bierze `lang` (używa) albo
//     `_lang` (jawnie ignoruje). Bramka konfrontuje deklarację z FAKTEM:
//     `lang` ⇒ klucze PL i EN muszą się różnić, `_lang` ⇒ muszą być identyczne.
//     Podkreślnik przestaje być komentarzem, a staje się sprawdzalną obietnicą.
//  2. `auditInlineQueries` - zapytania pisane wprost w komponencie (bez
//     fabryki). Czyta źródło i pyta: czy `queryFn` sięga po `lang`, a klucz go
//     nie niesie?
//
// Moduł jest czysty (bez Reacta, Supabase i I/O) - analizator sam jest
// testowany na syntetycznych wejściach, bo statyczna analiza bez testów to
// zgadywanie z pewną miną.

/** Jak fabryka zapytania traktuje język. */
export type LangParamStyle = "used" | "unused" | "absent";

/** Wycina listę parametrów eksportowanej funkcji / strzałki o danej nazwie. */
export function extractParamList(source: string, exportName: string): string | null {
  const patterns = [
    new RegExp(`export\\s+const\\s+${exportName}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\(`),
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\s*(?:<[^>]*>)?\\s*\\(`),
  ];
  for (const re of patterns) {
    const m = re.exec(source);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) return source.slice(open + 1, i);
      }
    }
  }
  return null;
}

/**
 * Czy fabryka bierze język i czy deklaruje, że go używa.
 *
 * `lang` = używa (klucz MUSI zależeć od języka), `_lang` = przyjmuje dla
 * symetrii wywołań i świadomie ignoruje (klucz NIE MOŻE zależeć od języka).
 */
export function langParamStyle(source: string, exportName: string): LangParamStyle {
  const params = extractParamList(source, exportName);
  if (params === null) return "absent";
  // Parametry rozbijamy po przecinkach na poziomie 0 nawiasów i generyków, żeby
  // `Record<string, string>` nie rozpadł się na dwa "parametry".
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  for (const part of parts) {
    const name = part.trim().split(/[:=]/)[0].trim();
    if (name === "lang") return "used";
    if (name === "_lang") return "unused";
  }
  return "absent";
}

/** Czy dwa klucze zapytań są różne (porównanie strukturalne, nie referencyjne). */
export function queryKeysDiffer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Jedno zapytanie zapisane wprost w kodzie komponentu. */
export interface InlineQueryFinding {
  readonly path: string;
  readonly line: number;
  readonly keyExpression: string;
}

const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** Usuwa linie komentarzy - "lang" w komentarzu nie jest odczytem języka. */
function stripComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !COMMENT_LINE.test(line))
    .join("\n");
}

/** Wyrażenie po `key:` do najbliższego przecinka na poziomie 0. */
function valueAfter(block: string, key: string): string {
  const at = block.indexOf(`${key}:`);
  if (at === -1) return "";
  let depth = 0;
  let out = "";
  for (let i = at + key.length + 1; i < block.length; i += 1) {
    const ch = block[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth -= 1;
    }
    if (ch === "," && depth === 0) break;
    out += ch;
  }
  return out;
}

/** Blok obiektu literalnego zawierającego dany indeks. */
function enclosingObject(text: string, index: number): string {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) return "";
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * JEDYNY sygnał "to zapytanie zależy od języka": `queryFn` sięga po zmienną
 * `lang` (wprost, albo przez interpolację `_${lang}` / `pickI18n(…, lang)`).
 *
 * Świadomie NIE ścigamy samych nazw kolumn (`name_pl`, `title_en`): zapytanie,
 * które selectuje OBA języki i pozwala wybrać w renderze, jest wzorcem
 * POPRAWNYM - i takie właśnie są `CategoriesView` oraz `TagsView`. Gdyby ich
 * klucz niósł język, obie wersje płaciłyby po jednym zapytaniu za te same
 * wiersze.
 */
const LANG_TOKEN = /\blang\b/;

/**
 * Zapytania pisane wprost w komponencie, których `queryFn` zależy od języka, a
 * `queryKey` go nie niesie.
 *
 * Rozwiązujemy JEDEN poziom lokalnych wiązań: klucz `[ROOT, input]`, gdzie
 * `const input = fooInput(c, lang)`, liczy się jako niosący język.
 */
export function auditInlineQueries(
  files: ReadonlyArray<{ path: string; text: string }>,
): ReadonlyArray<InlineQueryFinding> {
  const findings: InlineQueryFinding[] = [];
  for (const file of files) {
    const text = stripComments(file.text);
    for (const match of text.matchAll(/queryKey\s*:/g)) {
      const block = enclosingObject(text, match.index);
      if (!block) continue;
      const keyExpr = valueAfter(block, "queryKey");
      const fnExpr = valueAfter(block, "queryFn");
      if (!fnExpr) continue;
      const localizes = LANG_TOKEN.test(fnExpr);
      if (!localizes) continue;
      if (LANG_TOKEN.test(keyExpr)) continue;
      // Klucz może nieść język przez lokalną zmienną zbudowaną z `lang`.
      const identifiers = keyExpr.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
      const viaBinding = identifiers.some((id) =>
        new RegExp(`(?:const|let)\\s+${id}\\s*(?::[^=]+)?=[^;\\n]*\\blang\\b`).test(text),
      );
      if (viaBinding) continue;
      findings.push({
        path: file.path,
        line: text.slice(0, match.index).split("\n").length,
        keyExpression: keyExpr.trim(),
      });
    }
  }
  return findings;
}
