// BRAMKA: KAŻDY `dangerouslySetInnerHTML` W `src/` DOCHODZI DO DOM-U PRZEZ
// ZAUFANY SANITIZER.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──
// Repozytorium ma poprawne sanitizery (lib/sanitize, lib/sanitizePure,
// lib/seo/jsonld) i 84 miejsca wstrzykujące surowy HTML w 56 plikach
// produkcyjnych. Reguła „przepuść to przez sanitizer" żyła WYŁĄCZNIE
// w komentarzu (src/lib/sanitize.ts:2-4) - ani jedna bramka CI, ani jedna
// reguła ESLint, ani jeden test nie sprawdzał jej dla choćby jednego sinka.
// Czterdzieści jeden z tych miejsc renderuje `builder_data` JSONB, treści
// wpisów, kopię wydarzeń i dokumenty wgrane przez użytkownika. Żywego XSS-a
// dziś nie ma - bramka istnieje po to, żeby 85. sink nie był pierwszym
// niesanityzowanym, a jego autor dowiedział się o tym w CI, a nie z incydentu.
//
// Rodzaj sinka JEST częścią algorytmu, nie ozdobą. `sanitizeHtml` ma
// `FORBID_TAGS: ["style", …]` (sanitize.ts:37), więc przepuszczenie przez niego
// zawartości `<style>` skasowałoby motyw, tokeny marki i układ całej strony
// publicznej. Dlatego `<style>` akceptuje WYŁĄCZNIE `hardenStyleCss`,
// `<script type="application/ld+json">` wyłącznie `safeJsonLd`, a zwykły
// `<script>` (skrypty bootowe przed pierwszym malowaniem) nie ma sanitizera
// i wymaga imiennego wpisu w allowliście.
//
// ── CZEGO NIE MIERZY - świadomie ──
//  * Nie zastępuje `react/no-danger`. Ta reguła ostrzega o KAŻDYM wystąpieniu,
//    więc na 84 sinkach byłaby 84 razy wyciszona `eslint-disable` i nie
//    odróżniłaby wartości sanityzowanej od surowej. `eslint-plugin-react`
//    nie jest zresztą w repo wpięty (eslint.config.js:46-49) - to świadomie
//    odrzucona alternatywa, nie brak.
//  * NIE WIDZI `src/lib/files/officeParse.ts`, bo w tym pliku nie ma
//    `dangerouslySetInnerHTML` - sanityzacja dzieje się tam w warstwie
//    parsowania, a sink stoi w DocumentViewerBody.tsx. Dług tego pliku
//    (bezpośrednie wywołanie DOMPurify z pominięciem kanarka silnika) jest
//    NIEZALEŻNY i bramka nie może go wymuszać; pilnuje go wpis allowlisty
//    dla DocumentViewerBody wraz z uzasadnieniem.
//  * Nie mierzy poprawności samych sanitizerów - od tego są
//    src/lib/__tests__/sanitizeScriptPrefixBypass.test.ts i kanarek
//    src/lib/sanitizeEngineGuard.ts.
//  * Nie śledzi wartości przez granicę modułu. Stała zaimportowana z innego
//    pliku jest dla bramki nierozstrzygalna - i ma być: dlatego wymaga wpisu
//    w allowliście z pisemnym uzasadnieniem, a nie cichego przepuszczenia.
//
// NAJGROŹNIEJSZY TRYB AWARII TO CICHA ZIELONOŚĆ, NIE FAŁSZYWY ALARM. Bramka,
// która pomyli się na bilansie klamer i zgubi połowę sinków, wygląda dokładnie
// jak bramka przechodząca. Dlatego `dangerousHtmlFailed` oblewa również na
// `totalSinks === 0` (wzorem gateCoverage.ts), a test jednostkowy przypina
// DOKŁADNĄ liczbę sinków znalezionych w pliku syntetycznym.

import { bezKomentarzy } from "./sourceScan";

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/** Rodzaj elementu, do którego wstrzykiwany jest HTML - decyduje o sanitizerze. */
export type SinkKind = "style" | "script" | "jsonld" | "html" | "unknown";

export type SinkStatus = "sanitized" | "literal" | "allowlisted" | "violation";

export interface RawSink {
  readonly file: string;
  readonly line: number;
  readonly sink: SinkKind;
  /** Pełna treść atrybutu `dangerouslySetInnerHTML={…}` bez zewnętrznych klamer. */
  readonly attribute: string;
  /** Wyrażenie przypisane do `__html`; `null`, gdy klucza `__html` nie ma. */
  readonly expression: string | null;
}

export interface HtmlSink {
  readonly file: string;
  readonly line: number;
  readonly sink: SinkKind;
  readonly expression: string;
  readonly status: SinkStatus;
  /** Nazwa sanitizera, który uznano za dowód - `null` dla literałów i naruszeń. */
  readonly sanitizer: string | null;
  readonly remedy: string;
}

/**
 * Wpis zwolnienia. Klucz to PARA (plik, nazwa symbolu) - nigdy numer linii
 * ani treść literału. Definicja mieszka tutaj, a nie w `scripts/`, bo
 * `tsconfig.json` typuje wyłącznie `src/**` - moduł bramki nie może zależeć
 * od katalogu, którego `tsc` nie widzi.
 */
export interface DangerousHtmlAllowEntry {
  /** Ścieżka względna repo, separator `/`. */
  readonly file: string;
  readonly sink: "style" | "script" | "jsonld" | "html";
  /** Nazwa stałej/zmiennej wstawianej do `__html` (np. "THEME_INIT_SCRIPT"). */
  readonly symbol: string;
  /** PO POLSKU: dlaczego to jest bezpieczne bez sanitizera. Min. 40 znaków. */
  readonly reason: string;
}

export interface DangerousHtmlStats {
  readonly scannedFiles: number;
  readonly totalSinks: number;
  readonly sanitized: number;
  readonly literal: number;
  readonly allowlisted: number;
}

export interface DangerousHtmlReport {
  readonly violations: readonly HtmlSink[];
  readonly staleAllowlist: readonly DangerousHtmlAllowEntry[];
  readonly stats: DangerousHtmlStats;
}

/** Katalogi i pliki poza zasięgiem bramki (kopia contentLayering.ts:162-169). */
export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return false;
  // Moduł samej bramki CYTUJE wzorce sinków, ale niczego nie renderuje.
  if (file.endsWith("src/lib/ci/dangerousHtml.ts")) return false;
  return true;
}

// ---------------------------------------------------------------- skanowanie

/**
 * Indeks tuż za napisem zaczynającym się na `i`. Napis szablonowy pochłania
 * także wstawki `${…}` wraz z zagnieżdżonymi napisami - bez tego bilans klamer
 * rozjeżdża się na pierwszym `` `${a ? "}" : ""}` `` i bramka gubi sinki.
 */
function pominNapis(src: string, i: number): number {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return i + 1;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === q) return j + 1;
    if (q === "`" && c === "$" && src[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        const d = src[j];
        if (d === '"' || d === "'" || d === "`") {
          j = pominNapis(src, j);
          continue;
        }
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        j += 1;
      }
      continue;
    }
    j += 1;
  }
  return j;
}

interface Skan {
  readonly depth: Int32Array;
  readonly napis: Uint8Array;
}

/** Głębokość nawiasowa i maska „to jest wnętrze napisu" dla każdego znaku. */
function skanuj(text: string): Skan {
  const depth = new Int32Array(text.length);
  const napis = new Uint8Array(text.length);
  let d = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = Math.min(pominNapis(text, i), text.length);
      for (let k = i; k < end; k += 1) {
        depth[k] = d;
        napis[k] = 1;
      }
      i = end;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth[i] = d;
      d += 1;
      i += 1;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      d -= 1;
      depth[i] = d;
      i += 1;
      continue;
    }
    depth[i] = d;
    i += 1;
  }
  return { depth, napis };
}

/** Indeks klamry domykającej klamrę otwierającą na `open` (lub -1). */
function domkniecieKlamry(src: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = pominNapis(src, i);
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

const SINK_RE = /\bdangerouslySetInnerHTML\s*=\s*\{/g;
const IDENT_START = /[A-Za-z_$]/;

/** Numer linii (1-based) dla przesunięcia w źródle. */
function numerLinii(lineStarts: readonly number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lineStarts[mid] ?? 0) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** Indeks otwierającego cudzysłowu dla cudzysłowu zamykającego na `i` (lub -1). */
function poprzedniNapis(src: string, i: number): number {
  const q = src[i];
  let j = i - 1;
  while (j >= 0) {
    if (src[j] === q && src[j - 1] !== "\\") return j;
    j -= 1;
  }
  return -1;
}

/** Indeks `{` domykanej przez `}` na pozycji `i` (lub -1). */
function dopasujWstecz(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j >= 0) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      const otw = poprzedniNapis(src, j);
      if (otw === -1) return -1;
      j = otw - 1;
      continue;
    }
    if (c === "}") depth += 1;
    else if (c === "{") {
      depth -= 1;
      if (depth === 0) return j;
    }
    j -= 1;
  }
  return -1;
}

const ATTR_CHAR = /[\w$\-.:[\]]/;

/**
 * Znacznik, wewnątrz którego stoi atrybut na pozycji `p`.
 *
 * „Cofnij się do najbliższego `<`" NIE WYSTARCZA: `<` bywa operatorem
 * porównania i nawiasem generyka, a tekst JSX (`panel „Blok" po prawej`)
 * potrafi zawierać niesparowany cudzysłów, który przy skanie od początku
 * pliku połyka pół komponentu. Dlatego cofamy się LOKALNIE: przeskakujemy
 * zrównoważone `{…}` (wyrażenia w propsach - tam mieszka `x < 3 ? … : …`)
 * i wartości w cudzysłowach, a nazwę znacznika przyjmujemy dopiero, gdy
 * bezpośrednio poprzedza ją `<`.
 */
function znajdzZnacznik(masked: string, p: number): { name: string; tag: string } | null {
  let i = p - 1;
  while (i >= 0) {
    while (i >= 0 && /\s/.test(masked[i])) i -= 1;
    if (i < 0) return null;
    const c = masked[i];
    if (c === "}") {
      const otw = dopasujWstecz(masked, i);
      if (otw === -1) return null;
      i = otw - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const otw = poprzedniNapis(masked, i);
      if (otw === -1) return null;
      i = otw - 1;
      continue;
    }
    if (c === "=") {
      i -= 1;
      continue;
    }
    if (ATTR_CHAR.test(c)) {
      let j = i;
      while (j >= 0 && ATTR_CHAR.test(masked[j])) j -= 1;
      if (masked[j] === "<" && IDENT_START.test(masked[j + 1] ?? "")) {
        return { name: masked.slice(j + 1, i + 1), tag: masked.slice(j, p) };
      }
      i = j;
      continue;
    }
    return null;
  }
  return null;
}

const JSONLD_TYPE_RE = /type\s*=\s*["']application\/ld\+json["']/;

function rodzajSinka(masked: string, p: number): SinkKind {
  const znacznik = znajdzZnacznik(masked, p);
  if (znacznik === null) return "unknown";
  const name = znacznik.name.toLowerCase();
  if (name === "style") return "style";
  if (name === "script") return JSONLD_TYPE_RE.test(znacznik.tag) ? "jsonld" : "script";
  return "html";
}

/** Wartość klucza `__html` w treści atrybutu (bez zewnętrznych klamer). */
function wartoscHtml(attribute: string): string | null {
  const skan = skanuj(attribute);
  for (let i = 0; i < attribute.length; i += 1) {
    if (skan.napis[i] === 1 || skan.depth[i] !== 1) continue;
    if (!attribute.startsWith("__html", i)) continue;
    const przed = attribute.slice(0, i).trimEnd().slice(-1);
    if (przed !== "" && przed !== "{" && przed !== ",") continue;
    let j = i + "__html".length;
    while (j < attribute.length && /\s/.test(attribute[j])) j += 1;
    if (attribute[j] !== ":") continue;
    j += 1;
    let end = attribute.length;
    for (let k = j; k < attribute.length; k += 1) {
      if (skan.napis[k] === 1) continue;
      if (skan.depth[k] === 1 && attribute[k] === ",") {
        end = k;
        break;
      }
      if (skan.depth[k] < 1) {
        end = k;
        break;
      }
    }
    return attribute.slice(j, end).trim();
  }
  return null;
}

/** Wszystkie sinki w jednym pliku - komentarze zamaskowane PRZED skanem. */
export function extractHtmlSinks(src: ScannedSource): readonly RawSink[] {
  // WYMÓG, NIE OPTYMALIZACJA: 14 plików produkcyjnych wspomina
  // `dangerouslySetInnerHTML` wyłącznie w komentarzu. Bramka bez maskowania
  // wywróciłaby się na własnej dokumentacji (patrz sourceScan.ts:4-12).
  const masked = bezKomentarzy(src.source);
  const lineStarts: number[] = [0];
  for (let i = 0; i < masked.length; i += 1) if (masked[i] === "\n") lineStarts.push(i + 1);

  const out: RawSink[] = [];
  SINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SINK_RE.exec(masked)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = domkniecieKlamry(masked, open);
    if (close === -1) continue;
    const attribute = masked.slice(open + 1, close);
    out.push({
      file: src.file,
      line: numerLinii(lineStarts, match.index),
      sink: rodzajSinka(masked, match.index),
      attribute,
      expression: wartoscHtml(attribute),
    });
    SINK_RE.lastIndex = close;
  }
  return out;
}

// ------------------------------------------------------------- klasyfikacja

/**
 * Sanitizery, którym bramka wierzy, wraz z modułem kanonicznym i rodzajem
 * sinka, do którego pasują. Sprawdzenie importu jest load-bearing: bez niego
 * lokalne `const sanitizeHtml = (s: string) => s` uciszyłoby całą bramkę.
 */
const TRUSTED_SANITIZERS: ReadonlyMap<
  string,
  { readonly modules: readonly string[]; readonly kinds: readonly SinkKind[] }
> = new Map([
  ["sanitizeHtml", { modules: ["@/lib/sanitize"], kinds: ["html"] as readonly SinkKind[] }],
  ["sanitizeMarkdownHtml", { modules: ["@/lib/sanitize"], kinds: ["html"] as readonly SinkKind[] }],
  [
    "ssrSanitizeHtml",
    {
      modules: ["@/lib/ssrSanitizeHtml", "@/lib/sanitize"],
      kinds: ["html"] as readonly SinkKind[],
    },
  ],
  [
    "hardenStyleCss",
    {
      modules: ["@/lib/sanitizePure", "@/lib/sanitize"],
      kinds: ["style"] as readonly SinkKind[],
    },
  ],
  ["safeJsonLd", { modules: ["@/lib/seo/jsonld"], kinds: ["jsonld"] as readonly SinkKind[] }],
]);

/**
 * Lokalne delegaty sanitizerów - cienkie funkcje, które NIC nie robią poza
 * wywołaniem zaufanego sanitizera. Wiązane PARĄ (nazwa, moduł definiujący),
 * bo sama nazwa `clean` czy `sanitize` nic nie dowodzi.
 */
const LOCAL_SANITIZERS: readonly {
  readonly name: string;
  readonly modules: readonly string[];
  readonly kinds: readonly SinkKind[];
}[] = [
  // data.ts:104-106 - deleguje wprost do `sanitizeHtml`.
  {
    name: "sanitize",
    modules: ["@/components/blocks/renderer/data"],
    kinds: ["html"],
  },
  // InteractiveViews.tsx:19-21 - definicja w tym samym pliku, deleguje do `sanitizeHtml`.
  {
    name: "clean",
    modules: ["@/components/blocks/InteractiveViews"],
    kinds: ["html"],
  },
  // footnotes.ts:49-51 - `sanitize(text)`, czyli ta sama polityka co bloki;
  // barrel `renderer/index` re-eksportuje tę nazwę bez zmiany treści.
  {
    name: "renderFootnoteHtml",
    modules: ["@/components/blocks/renderer/footnotes", "@/components/blocks/renderer"],
    kinds: ["html"],
  },
];

/**
 * Dekoratory, które DOKŁADAJĄ znaczniki do już sanityzowanego HTML-a i nie
 * wnoszą nowej treści z zewnątrz. Zdejmujemy je i oceniamy argument.
 */
const PASSTHROUGH_WRAPPERS: ReadonlyMap<string, readonly string[]> = new Map([
  ["decorateCmsStatusIcons", ["@/lib/content/cmsInlineIcons"]],
  ["enhanceContentImages", ["@/lib/content/enhanceImages"]],
]);

/**
 * Buildery, które składają HTML wyłącznie z wartości przefiltrowanych u siebie
 * - mają własne testy, więc bramka traktuje je jak dowód.
 */
const TRUSTED_BUILDERS: ReadonlyMap<string, string> = new Map([
  // atoms.tsx:82-88 - identyfikatory przechodzą przez SAFE_ANCHOR_RE, a HTML
  // to wyłącznie pusty `<span id=… data-anchor-alias=…>`.
  ["legacyAnchorsHtml", "atoms.tsx::legacyAnchorsHtml"],
  // footnotes.ts:82,91 - mapa `fnHtml` jest wypełniana WYŁĄCZNIE wynikami
  // `sanitize(...)` w pre-passie `precomputeFootnotes`; bez tego wpisu bramka
  // nie przepuściłaby molecules.tsx:646 ani atoms.tsx:203.
  ["fnHtml.get", "footnotes.ts::precomputeFootnotes"],
]);

/**
 * Źródła wartości, które nie mogą zawierać `<`, więc wolno je wstawiać do
 * literału CSS/HTML. `useId()` to identyfikator generowany przez Reacta
 * (kształt `:r0:`), a `JSON.stringify` ucieka cudzysłowy - obie postacie
 * pojawiają się w nazwach animacji i selektorach `[data-…]`.
 */
const TRUSTED_VALUE_SOURCES: ReadonlySet<string> = new Set(["useId", "JSON.stringify"]);

/** Metody, które na bezpiecznej wartości nie wprowadzają nowych znaków. */
const SAFE_CHAIN_METHODS: ReadonlySet<string> = new Set([
  "replace",
  "replaceAll",
  "trim",
  "slice",
  "toString",
  "toFixed",
  "toLowerCase",
  "toUpperCase",
]);

/**
 * `JSON.stringify` NIE JEST sam z siebie ucieczką dla `<`:
 * `JSON.stringify("</script>")` wraca z nietkniętym `</script>`, które domyka
 * element `<script>` albo `<style>`. Uznajemy go za bezpieczny tylko wtedy,
 * gdy serializowana wartość sama jest stałą/literałem z repo albo gdy wynik
 * przechodzi przez `.replace(/</…)` - dokładnie tak, jak robi to
 * AlertBar.tsx:129-131.
 */
function stringifyBezpieczne(expr: string, open: number, ctx: Kontekst, depth: number): boolean {
  if (/\.\s*replace\s*\(\s*\/</.test(expr)) return true;
  if (open === -1) return false;
  const skan = skanuj(expr);
  let close = -1;
  for (let i = open + 1; i < expr.length; i += 1) {
    if (skan.napis[i] === 1) continue;
    if (expr[i] === ")" && skan.depth[i] === skan.depth[open]) {
      close = i;
      break;
    }
  }
  if (close === -1) return false;
  const args = podzielNaPoziomie(expr.slice(open + 1, close), [","]);
  return args.length > 0 && bezpiecznaWartosc(args[0], ctx, depth + 1);
}

const MAX_DEPTH = 6;

const REMEDY_BY_KIND: ReadonlyMap<SinkKind, string> = new Map([
  [
    "style",
    'Owiń wartość w `hardenStyleCss(...)` z `@/lib/sanitizePure` - `sanitizeHtml` ma `FORBID_TAGS: ["style"]` i skasowałby motyw.',
  ],
  [
    "jsonld",
    "Serializuj graf przez `safeJsonLd(...)` z `@/lib/seo/jsonld` - samo `JSON.stringify` pozwala domknąć `</script>`.",
  ],
  [
    "script",
    "Skrypt inline nie ma sanitizera: buduj go ze stałych i `JSON.stringify`, a miejsce dopisz do `scripts/lib/dangerousHtmlAllowlist.ts` z uzasadnieniem.",
  ],
  [
    "html",
    "Przepuść wartość przez `sanitizeHtml`/`sanitizeMarkdownHtml` z `@/lib/sanitize` w miejscu renderu.",
  ],
  [
    "unknown",
    "Bramka nie ustaliła znacznika; rozbij JSX albo dopisz wpis do allowlisty z uzasadnieniem.",
  ],
]);

interface Kontekst {
  readonly file: string;
  readonly masked: string;
  readonly kind: SinkKind;
  readonly imports: ReadonlyMap<string, string>;
}

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;

/** Mapa „nazwa lokalna -> moduł", z relatywnymi ścieżkami sprowadzonymi do `@/`. */
function mapaImportow(masked: string, file: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(masked)) !== null) {
    const modul = normalizujModul(m[2], file);
    const clause = m[1];
    const braced = /\{([\s\S]*)\}/.exec(clause)?.[1];
    if (braced !== undefined) {
      for (const part of braced.split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (name) out.set(name.replace(/^type\s+/, "").trim(), modul);
      }
    }
    const domyslny = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause)?.[1];
    if (domyslny) out.set(domyslny, modul);
  }
  return out;
}

/** `./data` z `src/a/b.tsx` -> `@/a/data`; `@/x` zostaje bez zmian. */
function normalizujModul(specifier: string, fromFile: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const segments = fromFile.replaceAll("\\", "/").split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const joined = segments.join("/").replace(/\.(tsx?|jsx?)$/, "");
  return joined.startsWith("src/") ? `@/${joined.slice(4)}` : joined;
}

/** Czy `name` pochodzi w tym pliku z jednego z `modules` (albo jest tu zdefiniowane). */
function pochodziZ(ctx: Kontekst, name: string, modules: readonly string[]): boolean {
  const wlasny = normalizujModul(`./${ctx.file.split("/").pop() ?? ""}`, ctx.file);
  if (modules.includes(wlasny)) return true;
  const modul = ctx.imports.get(name);
  return modul !== undefined && modules.includes(modul);
}

function podzielNaPoziomie(text: string, ops: readonly string[]): string[] {
  const skan = skanuj(text);
  const parts: string[] = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    if (skan.napis[i] === 1 || skan.depth[i] !== 0) {
      i += 1;
      continue;
    }
    const op = ops.find((o) => text.startsWith(o, i));
    if (op === undefined) {
      i += 1;
      continue;
    }
    parts.push(text.slice(last, i));
    i += op.length;
    last = i;
  }
  parts.push(text.slice(last));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Rozbicie `warunek ? a : b` na ramiona (albo `null`, gdy to nie ternary). */
function rozbijTernary(text: string): [string, string] | null {
  const skan = skanuj(text);
  for (let i = 0; i < text.length; i += 1) {
    if (skan.napis[i] === 1 || skan.depth[i] !== 0 || text[i] !== "?") continue;
    if (text[i + 1] === "?" || text[i + 1] === "." || text[i - 1] === "?") continue;
    let zagniezdzenia = 0;
    for (let j = i + 1; j < text.length; j += 1) {
      if (skan.napis[j] === 1 || skan.depth[j] !== 0) continue;
      if (text[j] === "?" && text[j + 1] !== "?" && text[j + 1] !== "." && text[j - 1] !== "?")
        zagniezdzenia += 1;
      else if (text[j] === ":") {
        if (zagniezdzenia === 0) return [text.slice(i + 1, j).trim(), text.slice(j + 1).trim()];
        zagniezdzenia -= 1;
      }
    }
    return null;
  }
  return null;
}

/** Treści wstawek `${…}` napisu szablonowego. */
function wstawkiSzablonu(tpl: string): string[] {
  const out: string[] = [];
  let i = 1;
  while (i < tpl.length) {
    const c = tpl[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") break;
    if (c === "$" && tpl[i + 1] === "{") {
      const start = i + 2;
      let depth = 1;
      let j = start;
      while (j < tpl.length && depth > 0) {
        const d = tpl[j];
        if (d === '"' || d === "'" || d === "`") {
          j = pominNapis(tpl, j);
          continue;
        }
        if (d === "{") depth += 1;
        else if (d === "}") depth -= 1;
        if (depth === 0) break;
        j += 1;
      }
      out.push(tpl.slice(start, j));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

const CALL_RE = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/;

/** Rozbicie `nazwa(arg, arg)` - tylko gdy CAŁY tekst jest jednym wywołaniem. */
function rozbijWywolanie(text: string): { callee: string; args: string[] } | null {
  const m = CALL_RE.exec(text);
  if (m === null) return null;
  const open = text.indexOf("(", m[1].length);
  const skan = skanuj(text);
  let close = -1;
  for (let i = open + 1; i < text.length; i += 1) {
    if (skan.napis[i] === 1) continue;
    if (text[i] === ")" && skan.depth[i] === 0) {
      close = i;
      break;
    }
  }
  if (close !== text.trimEnd().length - 1) return null;
  const inner = text.slice(open + 1, close);
  return { callee: m[1], args: podzielNaPoziomie(inner, [","]) };
}

/** Wiązania `const NAZWA = …` w pliku (może być ich kilka - sprawdzamy wszystkie). */
function wiazania(masked: string, name: string): string[] {
  const out: string[] = [];
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = decl.exec(masked)) !== null) {
    let i = m.index + m[0].length;
    let depth = 0;
    let eq = -1;
    while (i < masked.length) {
      const c = masked[i];
      if (c === '"' || c === "'" || c === "`") {
        i = pominNapis(masked, i);
        continue;
      }
      if (c === "(" || c === "[" || c === "{" || c === "<") depth += 1;
      else if (c === ")" || c === "]" || c === "}" || c === ">") depth -= 1;
      else if (c === ";" || c === "\n") {
        if (depth <= 0 && c === ";") break;
      } else if (c === "=" && depth <= 0 && masked[i + 1] !== "=" && masked[i + 1] !== ">") {
        eq = i;
        break;
      }
      i += 1;
    }
    if (eq === -1) continue;
    out.push(czytajWyrazenie(masked, eq + 1));
  }
  // Destrukturyzacja `const { safe, liveNotes } = useMemo(…)`.
  const destr = new RegExp(`\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=`, "g");
  let d: RegExpExecArray | null;
  while ((d = destr.exec(masked)) !== null) {
    const pola = d[1].split(",").map((p) => p.trim().split(":")[0].trim());
    if (!pola.includes(name)) continue;
    const init = czytajWyrazenie(masked, d.index + d[0].length);
    const wartosc = wlasciwoscObiektu(init, name);
    if (wartosc !== null) out.push(wartosc);
  }
  return out;
}

/** Wyrażenie od `start` do średnika na poziomie zerowym. */
function czytajWyrazenie(masked: string, start: number): string {
  let depth = 0;
  let i = start;
  while (i < masked.length) {
    const c = masked[i];
    if (c === '"' || c === "'" || c === "`") {
      i = pominNapis(masked, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (c === ";" && depth === 0) break;
    i += 1;
  }
  return masked.slice(start, i).trim();
}

/** Wartość właściwości `name:` w dowolnym literale obiektowym wewnątrz `text`. */
function wlasciwoscObiektu(text: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*:`, "g");
  const skan = skanuj(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (skan.napis[m.index] === 1) continue;
    const poziom = skan.depth[m.index];
    const start = m.index + m[0].length;
    let end = text.length;
    for (let k = start; k < text.length; k += 1) {
      if (skan.napis[k] === 1) continue;
      if (skan.depth[k] === poziom && text[k] === ",") {
        end = k;
        break;
      }
      if (skan.depth[k] < poziom) {
        end = k;
        break;
      }
    }
    return text.slice(start, end).trim();
  }
  return null;
}

/** Wyrażenia zwracane przez `useMemo(() => …)` / `useCallback(() => …)`. */
function cialoArrow(arg: string): string[] {
  const strzalka = arg.indexOf("=>");
  if (strzalka === -1) return [];
  const body = arg.slice(strzalka + 2).trim();
  if (!body.startsWith("{")) return [body];
  const out: string[] = [];
  const re = /\breturn\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(czytajWyrazenie(body, m.index + m[0].length));
  return out;
}

interface Ocena {
  readonly ok: boolean;
  readonly status: SinkStatus;
  readonly sanitizer: string | null;
  readonly powod: string;
}

const LITERAL: Ocena = { ok: true, status: "literal", sanitizer: null, powod: "" };

function zlaczOceny(oceny: readonly Ocena[]): Ocena {
  const zle = oceny.find((o) => !o.ok);
  if (zle !== undefined) return zle;
  const san = oceny.find((o) => o.status === "sanitized");
  return san ?? LITERAL;
}

function naruszenie(powod: string): Ocena {
  return { ok: false, status: "violation", sanitizer: null, powod };
}

/** Czy wyrażenie jest bezpieczną wartością skalarną (nie może wnieść `<`). */
function bezpiecznaWartosc(text: string, ctx: Kontekst, depth: number): boolean {
  const expr = text.trim().replace(/\s+as\s+[\w<>[\]|.\s]+$/, "");
  if (expr === "") return true;
  if (/^-?\d[\d_.e+-]*$/.test(expr)) return true;
  if (/^(?:true|false|undefined|null)$/.test(expr)) return true;
  if (/^["']/.test(expr)) return true;
  if (expr.startsWith("`"))
    return wstawkiSzablonu(expr).every((w) => bezpiecznaWartosc(w, ctx, depth + 1));
  if (depth > MAX_DEPTH) return false;
  // `useId().replace(/:/g, "")` - łańcuch metod na bezpiecznym korzeniu.
  const korzen = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(expr)?.[1];
  if (korzen !== undefined && TRUSTED_VALUE_SOURCES.has(korzen)) {
    const reszta = expr.slice(expr.indexOf("("));
    const metody = reszta.match(/\)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g) ?? [];
    const lancuchOk = metody.every((m) =>
      SAFE_CHAIN_METHODS.has(/\.\s*([A-Za-z_$][\w$]*)/.exec(m)?.[1] ?? ""),
    );
    if (!lancuchOk) return false;
    if (korzen === "JSON.stringify")
      return stringifyBezpieczne(expr, expr.indexOf("("), ctx, depth);
    return true;
  }
  // Lokalny alias `const cssText = (v: string) => JSON.stringify(v)`
  // (VisualCanvas.tsx:778) - ta sama reguła co dla gołego `JSON.stringify`.
  const wywolanie = rozbijWywolanie(expr);
  if (wywolanie !== null && !wywolanie.callee.includes(".")) {
    for (const b of wiazania(ctx.masked, wywolanie.callee)) {
      if (/=>\s*JSON\.stringify\s*\(/.test(b))
        return stringifyBezpieczne(expr, expr.indexOf("("), ctx, depth);
    }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    // ŚWIADOMIE ZACHOWAWCZO: gdy ta sama nazwa jest wiązana w pliku kilka razy
    // (np. `const safe = …` w `renderParagraph` i w `renderHtml`), wymagamy
    // dowodu od KAŻDEGO wiązania. Bramka nie zna zasięgów, więc alternatywą
    // byłoby zgadywanie, które wiązanie widzi ten sink - a pomyłka w tę stronę
    // jest cicho zielona.
    const b = wiazania(ctx.masked, expr);
    return b.length > 0 && b.every((v) => bezpiecznaWartosc(v, ctx, depth + 1));
  }
  return false;
}

/**
 * Rozwinięcie wartości do dowodu bezpieczeństwa. REKURENCJA Z LICZNIKIEM, bo
 * jeden poziom NIE WYSTARCZA: atoms.tsx wiąże `textFnRaw = fnHtml.get(...)`,
 * potem `textFn = textFnRaw === undefined ? undefined : decorate(textFnRaw)`,
 * a sink czyta `textFn` - i to dopiero trzy kroki.
 */
export function resolveExpression(expr: string, source: string, depth: number): string {
  const masked = bezKomentarzy(source);
  let biezace = expr.trim();
  for (let i = 0; i < depth; i += 1) {
    if (!/^[A-Za-z_$][\w$]*$/.test(biezace)) return biezace;
    const b = wiazania(masked, biezace);
    if (b.length !== 1) return biezace;
    biezace = b[0];
  }
  return biezace;
}

function ocen(text: string, ctx: Kontekst, depth: number): Ocena {
  if (depth > MAX_DEPTH)
    return naruszenie(
      "przekroczono limit rozwijania wartości - wciągnij sanityzację do miejsca renderu albo dopisz wpis do allowlisty",
    );
  let expr = text.trim().replace(/\s+as\s+[\w<>[\]|.\s]+$/, "");
  while (expr.startsWith("(") && domkniecieNawiasu(expr) === expr.length - 1) {
    expr = expr.slice(1, -1).trim();
  }
  if (expr === "") return LITERAL;

  const puste = /^(?:undefined|null|""|''|``)$/;

  const alternatywy = podzielNaPoziomie(expr, ["??", "||"]);
  if (alternatywy.length > 1) {
    const ramiona = alternatywy.filter((a) => !puste.test(a));
    return zlaczOceny(ramiona.map((a) => ocen(a, ctx, depth + 1)));
  }

  const ternary = rozbijTernary(expr);
  if (ternary !== null) {
    const ramiona = ternary.filter((a) => !puste.test(a));
    return zlaczOceny(ramiona.map((a) => ocen(a, ctx, depth + 1)));
  }

  const konkatenacja = podzielNaPoziomie(expr, ["+"]);
  if (konkatenacja.length > 1) {
    return zlaczOceny(konkatenacja.map((a) => ocen(a, ctx, depth + 1)));
  }

  if (/^["']/.test(expr)) return LITERAL;

  if (expr.startsWith("`")) {
    // Literał szablonowy: tekst statyczny jest bezpieczny, każda wstawka
    // przechodzi PEŁNĄ klasyfikację - to właśnie tu `${kolor}` z bazy
    // wchodzi do `<style>` i domyka element.
    return zlaczOceny(wstawkiSzablonu(expr).map((w) => ocen(w, ctx, depth + 1)));
  }

  if (/^-?\d/.test(expr) || /^(?:true|false|undefined|null)$/.test(expr)) return LITERAL;

  // Wartość, która NIE MOŻE wnieść `<` (liczba, `JSON.stringify`, `useId()`
  // z łańcuchem `.replace`), jest bezpieczna w każdym rodzaju sinka - także
  // w `<style>`, gdzie nazwa animacji jest jedyną wstawką.
  if (bezpiecznaWartosc(expr, ctx, depth)) return LITERAL;

  const wywolanie = rozbijWywolanie(expr);
  if (wywolanie !== null) {
    const { callee, args } = wywolanie;

    const trusted = TRUSTED_SANITIZERS.get(callee);
    if (trusted !== undefined) {
      if (!pochodziZ(ctx, callee, trusted.modules))
        return naruszenie(
          `\`${callee}\` nie jest tu zaimportowane z ${trusted.modules.join(" ani ")} - lokalna funkcja o tej nazwie niczego nie dowodzi`,
        );
      if (!trusted.kinds.includes(ctx.kind))
        return naruszenie(
          `\`${callee}\` nie pasuje do sinka \`${ctx.kind}\` - ${REMEDY_BY_KIND.get(ctx.kind) ?? ""}`,
        );
      return { ok: true, status: "sanitized", sanitizer: callee, powod: "" };
    }

    const lokalny = LOCAL_SANITIZERS.find((l) => l.name === callee);
    if (lokalny !== undefined && pochodziZ(ctx, callee, lokalny.modules)) {
      if (!lokalny.kinds.includes(ctx.kind))
        return naruszenie(`\`${callee}\` nie pasuje do sinka \`${ctx.kind}\``);
      return { ok: true, status: "sanitized", sanitizer: callee, powod: "" };
    }

    const wrapper = PASSTHROUGH_WRAPPERS.get(callee);
    if (wrapper !== undefined && pochodziZ(ctx, callee, wrapper)) {
      return args.length === 0 ? LITERAL : ocen(args[0], ctx, depth + 1);
    }

    if (TRUSTED_BUILDERS.has(callee)) return LITERAL;

    if (callee === "useMemo" || callee === "useCallback") {
      const zwroty = args.length > 0 ? cialoArrow(args[0]) : [];
      if (zwroty.length === 0) return naruszenie("nie udało się odczytać ciała `useMemo`");
      return zlaczOceny(zwroty.map((z) => ocen(z, ctx, depth + 1)));
    }

    if (!callee.includes(".")) {
      const b = wiazania(ctx.masked, callee);
      const arrow = b.flatMap((v) => cialoArrow(v));
      if (arrow.length > 0) return zlaczOceny(arrow.map((z) => ocen(z, ctx, depth + 1)));
    }

    if (callee === "JSON.stringify")
      return naruszenie(
        '`JSON.stringify` nie ucieka `<`, więc wartość może domknąć element - dołóż `.replace(/</g, "\\\\u003c")` albo użyj `safeJsonLd`',
      );
    return naruszenie(`wartość pochodzi z \`${callee}(...)\`, którego bramka nie zna`);
  }

  if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
    const b = wiazania(ctx.masked, expr);
    if (b.length === 0)
      return naruszenie(
        `\`${expr}\` nie jest wiązane w tym pliku (stała importowana albo prop) - bramka nie przekracza granicy modułu`,
      );
    return zlaczOceny(b.map((v) => ocen(v, ctx, depth + 1)));
  }

  return naruszenie(
    `wartość \`${skroc(expr)}\` nie daje się sprowadzić do sanitizera ani literału`,
  );
}

function domkniecieNawiasu(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = pominNapis(text, i) - 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skroc(text: string): string {
  const jedna = text.replace(/\s+/g, " ").trim();
  return jedna.length > 90 ? `${jedna.slice(0, 87)}…` : jedna;
}

/** Nazwa symbolu pod kluczem `__html` - klucz allowlisty razem z plikiem. */
export function sinkSymbol(expression: string): string {
  const maskowane = expression.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1?/g, (m) =>
    " ".repeat(m.length),
  );
  return /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(maskowane)?.[0] ?? "";
}

export function classifySink(
  raw: RawSink,
  source: string,
  allowlist: readonly DangerousHtmlAllowEntry[],
): HtmlSink {
  const masked = bezKomentarzy(source);
  const ctx: Kontekst = {
    file: raw.file,
    masked,
    kind: raw.sink,
    imports: mapaImportow(masked, raw.file),
  };
  const expression = raw.expression ?? "";

  const wpis = (powod: string): HtmlSink => {
    const symbol = sinkSymbol(expression);
    const zwolnienie = allowlist.find(
      (a) => a.file === raw.file && a.sink === raw.sink && a.symbol === symbol,
    );
    if (zwolnienie !== undefined) {
      return {
        file: raw.file,
        line: raw.line,
        sink: raw.sink,
        expression: skroc(expression),
        status: "allowlisted",
        sanitizer: null,
        remedy: zwolnienie.reason,
      };
    }
    return {
      file: raw.file,
      line: raw.line,
      sink: raw.sink,
      expression: skroc(expression),
      status: "violation",
      sanitizer: null,
      remedy: `${powod}. ${REMEDY_BY_KIND.get(raw.sink) ?? ""}`,
    };
  };

  if (raw.expression === null) {
    return wpis(
      "atrybut nie ma klucza `__html` - obiekt `{ __html }` buduj w miejscu renderu; przekazany z zewnątrz ukrywa źródło wartości przed bramką",
    );
  }
  if (raw.sink === "unknown") {
    return wpis("bramka nie ustaliła znacznika otaczającego atrybut");
  }

  const ocena = ocen(expression, ctx, 0);
  if (!ocena.ok) return wpis(ocena.powod);
  return {
    file: raw.file,
    line: raw.line,
    sink: raw.sink,
    expression: skroc(expression),
    status: ocena.status,
    sanitizer: ocena.sanitizer,
    remedy: "",
  };
}

export function scanDangerousHtml(
  sources: readonly ScannedSource[],
  allowlist: readonly DangerousHtmlAllowEntry[],
): DangerousHtmlReport {
  const violations: HtmlSink[] = [];
  const uzyte = new Set<string>();
  let totalSinks = 0;
  let sanitized = 0;
  let literal = 0;
  let allowlisted = 0;

  for (const src of sources) {
    if (!/dangerouslySetInnerHTML/.test(src.source)) continue;
    for (const raw of extractHtmlSinks(src)) {
      totalSinks += 1;
      const sink = classifySink(raw, src.source, allowlist);
      if (sink.status === "sanitized") sanitized += 1;
      else if (sink.status === "literal") literal += 1;
      else if (sink.status === "allowlisted") {
        allowlisted += 1;
        uzyte.add(`${sink.file}|${sink.sink}|${sinkSymbol(raw.expression ?? "")}`);
      } else violations.push(sink);
    }
  }

  // STARE WPISY TEŻ OBLEWAJĄ. Zwolnienie liczy się jako użyte tylko wtedy, gdy
  // NAPRAWDĘ uratowało sink przed naruszeniem - inaczej allowlista po refaktorze
  // zamienia się w ciche zwolnienie dla kodu, którego już nie ma.
  const staleAllowlist = allowlist.filter((a) => !uzyte.has(`${a.file}|${a.sink}|${a.symbol}`));

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return {
    violations,
    staleAllowlist,
    stats: { scannedFiles: sources.length, totalSinks, sanitized, literal, allowlisted },
  };
}

export function dangerousHtmlFailed(report: DangerousHtmlReport): boolean {
  return (
    report.violations.length > 0 ||
    report.staleAllowlist.length > 0 ||
    report.stats.totalSinks === 0
  );
}

const NAZWA_RODZAJU: ReadonlyMap<SinkKind, string> = new Map([
  ["style", "<style> (CSS)"],
  ["script", "<script> (kod)"],
  ["jsonld", "<script type=application/ld+json>"],
  ["html", "HTML treści"],
  ["unknown", "znacznik nieustalony"],
]);

/** Log bramki - zielony podaje ZASIĘG, czerwony prowadzi do naprawy. */
export function renderDangerousHtmlReport(report: DangerousHtmlReport): string {
  const { violations, staleAllowlist, stats } = report;
  const zasieg =
    `przeskanowano ${stats.scannedFiles} plików, ${stats.totalSinks} sinków: ` +
    `${stats.sanitized} sanityzowanych, ${stats.literal} literalnych, ${stats.allowlisted} zwolnionych`;

  if (!dangerousHtmlFailed(report)) {
    return [
      `✓ dangerouslySetInnerHTML pod kontrolą (${zasieg}).`,
      "  Nowy sink bez sanitizera oblewa tę bramkę - uzasadnienie: src/lib/ci/dangerousHtml.ts",
    ].join("\n");
  }

  const body: string[] = [];

  if (stats.totalSinks === 0) {
    body.push(
      "[dangerous-html] BRAMKA NIE ZOBACZYŁA ANI JEDNEGO SINKA - to awaria skanera, nie czyste repo.",
      "  Repozytorium ma kilkadziesiąt `dangerouslySetInnerHTML`; zero znaczy, że bilans klamer",
      "  albo maskowanie komentarzy przestało działać. Cicha zieloność jest groźniejsza od alarmu.",
      "",
    );
  }

  if (violations.length > 0) {
    body.push(`[dangerous-html] ${violations.length} sinków bez dowodu sanityzacji:`);
    const grupy = new Map<SinkKind, HtmlSink[]>();
    for (const v of violations) {
      const bucket = grupy.get(v.sink);
      if (bucket === undefined) grupy.set(v.sink, [v]);
      else bucket.push(v);
    }
    for (const [kind, items] of grupy) {
      body.push("", `  ── ${NAZWA_RODZAJU.get(kind) ?? kind} (${items.length}) ──`);
      for (const v of items) {
        body.push(`   ${v.file}:${v.line}`, `     __html: ${v.expression}`, `     → ${v.remedy}`);
      }
    }
    body.push("");
  }

  if (staleAllowlist.length > 0) {
    body.push(
      `[dangerous-html] ${staleAllowlist.length} wpisów allowlisty nie ratuje już żadnego sinka - usuń je:`,
    );
    for (const a of staleAllowlist) body.push(`   ${a.file} · ${a.sink} · ${a.symbol}`);
    body.push("");
  }

  body.push(
    `  Zasięg skanu: ${zasieg}.`,
    "  Inwariant, lista zaufanych sanitizerów i powody zwolnień: src/lib/ci/dangerousHtml.ts",
    "  Allowlista (każdy wpis z pisemnym uzasadnieniem): scripts/lib/dangerousHtmlAllowlist.ts",
  );
  return body.join("\n");
}
