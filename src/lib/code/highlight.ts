// Lekki, bezzależnościowy highlighter bloku kodu (E5 z audytu: registry
// obiecywało "blok kodu z podświetlaniem", renderer emitował goły tekst).
// Czysty tokenizer regex -> lista tokenów; ZERO HTML w wejściu/wyjściu
// (React renderuje tokeny jako <span>, więc XSS nie ma powierzchni), zero
// zależności CDN/npm, deterministyczny wynik = bezpieczny dla SSR i edge
// cache. Twardy inwariant: konkatenacja tokenów odtwarza wejście 1:1.

export type TokenKind =
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "property"
  | "variable"
  | "type";

export interface HighlightToken {
  text: string;
  /** null = tekst bez wyróżnienia. */
  kind: TokenKind | null;
}

interface LangSpec {
  /** Wzorzec z grupami nazwanymi; flaga g wymagana (skan od lewej). */
  pattern: RegExp;
  /** Słowa kluczowe (dla grupy `word`). */
  keywords?: ReadonlySet<string>;
  /** Porównanie słów kluczowych bez rozróżniania wielkości (SQL). */
  caseInsensitiveKeywords?: boolean;
  /** Słowa zaczynające się wielką literą oznaczaj jako typ (JS/TS). */
  capitalizedAsType?: boolean;
}

const JS_KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "keyof",
  "let",
  "new",
  "null",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const PY_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

const SQL_KEYWORDS = new Set([
  "add",
  "all",
  "alter",
  "and",
  "as",
  "asc",
  "begin",
  "between",
  "by",
  "case",
  "check",
  "column",
  "commit",
  "constraint",
  "create",
  "cross",
  "default",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "end",
  "exists",
  "false",
  "from",
  "full",
  "function",
  "grant",
  "group",
  "having",
  "if",
  "in",
  "index",
  "inner",
  "insert",
  "into",
  "is",
  "join",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "outer",
  "policy",
  "primary",
  "references",
  "returning",
  "returns",
  "revoke",
  "right",
  "rollback",
  "select",
  "set",
  "table",
  "then",
  "trigger",
  "true",
  "union",
  "unique",
  "update",
  "using",
  "values",
  "view",
  "when",
  "where",
  "with",
]);

const BASH_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "exit",
  "export",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "local",
  "return",
  "then",
  "until",
  "while",
]);

const YAML_KEYWORDS = new Set(["true", "false", "null", "yes", "no", "on", "off"]);

// Kolejność alternatyw = priorytet: komentarz > łańcuch > liczba > słowo.
const LANG_SPECS: Record<string, LangSpec> = {
  js: {
    pattern:
      /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`)|(?<number>\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?n?\b|\b0[xXbBoO][\da-fA-F_]+\b)|(?<word>[A-Za-z_$][\w$]*)/g,
    keywords: JS_KEYWORDS,
    capitalizedAsType: true,
  },
  python: {
    pattern:
      /(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(?<number>\b\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\b)|(?<word>[A-Za-z_][\w]*)/g,
    keywords: PY_KEYWORDS,
    capitalizedAsType: true,
  },
  sql: {
    pattern:
      /(?<comment>--[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>'(?:[^']|'')*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<word>[A-Za-z_][\w$]*)/g,
    keywords: SQL_KEYWORDS,
    caseInsensitiveKeywords: true,
  },
  bash: {
    pattern:
      /(?<comment>(?:^|(?<=\s))#[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'[^']*')|(?<variable>\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\$\d)|(?<number>\b\d+\b)|(?<word>[A-Za-z_][\w-]*)/g,
    keywords: BASH_KEYWORDS,
  },
  json: {
    // Klucz obiektu (łańcuch przed dwukropkiem) dostaje osobny kind property.
    pattern:
      /(?<property>"(?:[^"\\]|\\.)*"(?=\s*:))|(?<string>"(?:[^"\\]|\\.)*")|(?<number>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<word>\b(?:true|false|null)\b)/g,
    keywords: new Set(["true", "false", "null"]),
  },
  css: {
    pattern:
      /(?<comment>\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(?<keyword>@[\w-]+)|(?<property>(?<=^|[;{\s])[-\w]+(?=\s*:))|(?<number>-?\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|vmin|vmax|%|s|ms|deg|fr|ch|ex)?\b|#[\da-fA-F]{3,8}\b)/g,
  },
  yaml: {
    pattern:
      /(?<comment>#[^\n]*)|(?<property>(?<=^[ \t-]*)[\w./-]+(?=\s*:))|(?<string>"(?:[^"\\]|\\.)*"|'[^']*')|(?<number>\b\d+(?:\.\d+)?\b)|(?<word>[A-Za-z_][\w-]*)/gm,
    keywords: YAML_KEYWORDS,
    caseInsensitiveKeywords: true,
  },
};

/** Aliasowanie nazw języka wpisywanych w edytorze na specyfikacje. */
const LANG_ALIASES: Record<string, string> = {
  js: "js",
  jsx: "js",
  ts: "js",
  tsx: "js",
  javascript: "js",
  typescript: "js",
  mjs: "js",
  cjs: "js",
  json: "json",
  jsonc: "json",
  py: "python",
  python: "python",
  sql: "sql",
  psql: "sql",
  plpgsql: "sql",
  postgres: "sql",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  css: "css",
  scss: "css",
  yaml: "yaml",
  yml: "yaml",
};

/** Języki znaczników obsługiwane osobną ścieżką (tagi/atrybuty). */
const MARKUP_LANGS = new Set(["html", "xml", "svg", "vue", "markup"]);

function tokenizeWithSpec(code: string, spec: LangSpec): HighlightToken[] {
  const out: HighlightToken[] = [];
  let last = 0;
  spec.pattern.lastIndex = 0;
  for (const m of code.matchAll(spec.pattern)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: code.slice(last, idx), kind: null });
    const groups = m.groups ?? {};
    let kind: TokenKind | null = null;
    const text = m[0];
    if (groups.comment !== undefined) kind = "comment";
    else if (groups.string !== undefined) kind = "string";
    else if (groups.property !== undefined) kind = "property";
    else if (groups.variable !== undefined) kind = "variable";
    else if (groups.number !== undefined) kind = "number";
    else if (groups.keyword !== undefined) kind = "keyword";
    else if (groups.word !== undefined) {
      const word = groups.word;
      const key = spec.caseInsensitiveKeywords ? word.toLowerCase() : word;
      if (spec.keywords?.has(key)) kind = "keyword";
      else if (spec.capitalizedAsType && /^[A-Z]/.test(word)) kind = "type";
      else kind = null;
    }
    out.push({ text, kind });
    last = idx + text.length;
  }
  if (last < code.length) out.push({ text: code.slice(last), kind: null });
  return out;
}

/** HTML/XML: komentarze, tagi (nazwa=keyword, atrybut=property, wartość=string). */
function tokenizeMarkup(code: string): HighlightToken[] {
  const out: HighlightToken[] = [];
  const re = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^<>]*\/?>)/g;
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: code.slice(last, idx), kind: null });
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: "comment" });
    } else {
      // Wnętrze tagu: rozbij na nazwę, atrybuty i wartości.
      const tag = m[2];
      const inner =
        /(<\/?)([A-Za-z][\w:-]*)|([A-Za-z_][\w:-]*)(?==)|("(?:[^"\\]|\\.)*"|'[^']*')|(\/?>)/g;
      let tLast = 0;
      for (const t of tag.matchAll(inner)) {
        const tIdx = t.index ?? 0;
        if (tIdx > tLast) out.push({ text: tag.slice(tLast, tIdx), kind: null });
        if (t[1] !== undefined) {
          out.push({ text: t[1], kind: null });
          out.push({ text: t[2], kind: "keyword" });
        } else if (t[3] !== undefined) {
          out.push({ text: t[3], kind: "property" });
        } else if (t[4] !== undefined) {
          out.push({ text: t[4], kind: "string" });
        } else if (t[5] !== undefined) {
          out.push({ text: t[5], kind: null });
        }
        tLast = tIdx + t[0].length;
      }
      if (tLast < tag.length) out.push({ text: tag.slice(tLast), kind: null });
    }
    last = idx + m[0].length;
  }
  if (last < code.length) out.push({ text: code.slice(last), kind: null });
  return out;
}

/** Scal sąsiednie tokeny bez wyróżnienia (mniej spanów w DOM). */
function mergePlain(tokens: HighlightToken[]): HighlightToken[] {
  const out: HighlightToken[] = [];
  for (const t of tokens) {
    if (t.text.length === 0) continue;
    const prev = out[out.length - 1];
    if (prev && prev.kind === null && t.kind === null) prev.text += t.text;
    else out.push({ ...t });
  }
  return out;
}

/**
 * Tokenizuje kod dla wskazanego języka. Nieznany język = jeden token plain
 * (blok renderuje się jak dotąd, bez kolorów). Inwariant: konkatenacja
 * `text` wszystkich tokenów jest równa wejściu.
 */
export function highlightCode(code: string, lang: string): HighlightToken[] {
  if (code.length === 0) return [];
  const normalized = (lang ?? "").trim().toLowerCase();
  if (MARKUP_LANGS.has(normalized)) return mergePlain(tokenizeMarkup(code));
  const spec = LANG_SPECS[LANG_ALIASES[normalized] ?? ""];
  if (!spec) return [{ text: code, kind: null }];
  return mergePlain(tokenizeWithSpec(code, spec));
}

/** Języki, dla których highlighter ma realną gramatykę (etykieta w UI). */
export function isHighlightableLang(lang: string): boolean {
  const normalized = (lang ?? "").trim().toLowerCase();
  return MARKUP_LANGS.has(normalized) || LANG_ALIASES[normalized] !== undefined;
}
