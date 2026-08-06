/**
 * Strażnik „wysp leniwych chunków" - analiza statyczna grafu importów `src/`.
 *
 * PROBLEM, KTÓRY TO ŁAPIE
 * `import` jest KRAWĘDZIĄ GRAFU, nie wywołaniem. Ciężka zależność przeglądarki
 * (SDK operatora płatności) trafia do chunku każdego, kto ją statycznie
 * osiąga - nawet jeśli żadna linia jej nie WYWOŁA. Tak się to skończyło
 * 2026-08-06: `routes/$.tsx` (trasa uniwersalna, czyli KAŻDY publiczny wpis i
 * strona) -> `Paywall` -> modal kasy -> `@stripe/react-stripe-js`, a osobno
 * `Paywall` -> `lib/stripe` -> `loadStripe`. W chunku wejściowym siedziały
 * i ramka kasy, i adres `js.stripe.com`; anonimowy czytelnik płacił transferem
 * za funkcję, której nigdy nie użyje.
 *
 * Bramka `check:bundle` łapie to dopiero PO buildzie i tylko sumarycznie
 * („public urósł o 90 KB"), bez wskazania winowajcy - a przez tygodnie w ogóle
 * się nie wykonywała, bo krok przed nią padał. Ten gate jest deterministyczny,
 * nie wymaga builda i pokazuje KONKRETNY łańcuch importów.
 *
 * INWARIANT (dwie połowy, obie konieczne)
 *   1. Pakiet strzeżony wolno statycznie importować WYŁĄCZNIE modułowi
 *      należącemu do wyspy.
 *   2. Moduł wyspy wolno statycznie importować WYŁĄCZNIE innemu modułowi tej
 *      samej wyspy - z zewnątrz można wejść jedynie przez `import()`.
 *
 * Bez (2) sam podział plików niczego nie gwarantuje: wystarczy, że ktoś doda
 * `import { StripeEmbeddedFrame } from "./StripeEmbeddedFrame"` w miejscu
 * ładowanym eager i cała wyspa wraca do entry, mimo że pakiet formalnie jest
 * importowany „tylko przez moduł wyspy".
 *
 * Analiza jest ZACHOWAWCZA (over-approximation): importy typów są pomijane
 * (bundler je wymazuje), a wszystko inne liczy się jako krawędź runtime. Gate
 * może więc co najwyżej zgłosić krawędź, którą tree-shaking i tak by usunął -
 * nigdy nie przepuści prawdziwej.
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */

/** Deklaracja jednej wyspy: zbiór modułów + pakiety, które tylko one mogą wnosić. */
export interface LazyIsland {
  /** Nazwa w komunikatach błędu. */
  name: string;
  /** Ścieżki względem repo (POSIX), np. "src/lib/stripe/sdk.ts". */
  modules: string[];
  /** Pakiety npm dopuszczone WYŁĄCZNIE wewnątrz wyspy (prefiks nazwy). */
  packages: string[];
  /** Dlaczego wyspa istnieje - drukowane przy naruszeniu. */
  reason: string;
}

/**
 * Rejestr wysp. Dodanie wpisu tutaj to jedyny sposób, by nowa ciężka
 * zależność klienta była pilnowana - lista jest CELOWO krótka: obejmuje
 * zależności, które (a) są duże, (b) obsługują ścieżkę używaną przez ułamek
 * ruchu, (c) mają jednoznacznego właściciela w kodzie.
 */
export const LAZY_ISLANDS: LazyIsland[] = [
  {
    name: "checkout-sdk",
    modules: ["src/lib/stripe/sdk.ts", "src/components/checkout/StripeEmbeddedFrame.tsx"],
    packages: ["@stripe/stripe-js", "@stripe/react-stripe-js"],
    reason:
      "SDK operatora płatności ma schodzić WYŁĄCZNIE do czytelnika, który realnie otwiera kasę " +
      "(wejście: React.lazy w components/checkout/EmbeddedCheckoutFrame.tsx).",
  },
];

export interface ImportEdge {
  /** Plik źródłowy (ścieżka względem repo). */
  from: string;
  /** Surowy specyfikator z instrukcji importu. */
  specifier: string;
  /** 1-indeksowany numer linii - do czytelnego komunikatu. */
  line: number;
}

/** Wynik parsowania jednego pliku. */
export interface ParsedImports {
  /** Krawędzie inicjalizacyjne (wykonują się przy ładowaniu modułu). */
  staticSpecifiers: { specifier: string; line: number }[];
  /** `import()` - nie tworzy krawędzi inicjalizacyjnej. */
  dynamicSpecifiers: string[];
}

// `import ... from "x"`, `import "x"` (side-effect), `export ... from "x"`.
// Klauzula może być wielolinijkowa - `[^'";]` obejmuje znak nowej linii, a
// wykluczenie `;` nie pozwala przeskoczyć końca instrukcji. Kotwica `^[ \t]*`
// odsiewa wzmianki w komentarzach (`// import ...`, ` * import ...`).
// Grupa 1 rozróżnia `import type` / `export type` (wymazywane przez bundler).
const STATIC_IMPORT_RE =
  /^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?(?:[^'";]*?[ \t]from[ \t]*)?["']([^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']/g;
// Blokowe `import { type A, type B } from "x"` też są w całości wymazywane.
const TYPE_ONLY_NAMED_RE =
  /^[ \t]*(?:import|export)[ \t]*\{([^}]*)\}[ \t]*from[ \t]*["'][^"']+["']/;

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Czy cała klauzula nazwana składa się z importów typów (`{ type A, type B }`). */
function isTypeOnlyNamedClause(statement: string): boolean {
  const named = TYPE_ONLY_NAMED_RE.exec(statement);
  if (!named) return false;
  const specifiers = named[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (specifiers.length === 0) return false;
  return specifiers.every((s) => /^type[ \t]/.test(s));
}

/** Rozbija plik na krawędzie statyczne i dynamiczne. */
export function parseImports(source: string): ParsedImports {
  const staticSpecifiers: { specifier: string; line: number }[] = [];
  const dynamicSpecifiers: string[] = [];

  for (const match of source.matchAll(STATIC_IMPORT_RE)) {
    if (match[1]) continue; // `import type` / `export type`
    if (isTypeOnlyNamedClause(match[0])) continue;
    staticSpecifiers.push({ specifier: match[2], line: lineOf(source, match.index ?? 0) });
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) dynamicSpecifiers.push(match[1]);

  return { staticSpecifiers, dynamicSpecifiers };
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/**
 * Rozwiązuje specyfikator do ścieżki repo (dla kodu własnego) albo zwraca
 * `null` dla pakietu npm. `exists` pozwala wstrzyknąć zbiór plików w teście.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = normalizePath(`${dirname(fromFile)}/${specifier}`);
  } else {
    return null; // pakiet npm albo alias node: - nie jest modułem repo
  }
  if (exists(base)) return base;
  for (const ext of SOURCE_EXTENSIONS) if (exists(`${base}${ext}`)) return `${base}${ext}`;
  for (const ext of SOURCE_EXTENSIONS)
    if (exists(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

export interface IslandViolation {
  island: string;
  kind: "package-outside-island" | "static-entry-into-island";
  from: string;
  line: number;
  target: string;
  reason: string;
}

export interface SourceFile {
  /** Ścieżka względem repo, POSIX. */
  path: string;
  source: string;
}

/**
 * Sprawdza obie połowy inwariantu dla wszystkich wysp naraz (jedno przejście
 * po plikach). Zwraca listę naruszeń - pusta lista znaczy „zielono".
 */
export function findIslandViolations(
  files: SourceFile[],
  islands: LazyIsland[] = LAZY_ISLANDS,
): IslandViolation[] {
  const present = new Set(files.map((f) => f.path));
  const exists = (path: string) => present.has(path);
  const violations: IslandViolation[] = [];

  for (const island of islands) {
    const members = new Set(island.modules);
    for (const file of files) {
      const inIsland = members.has(file.path);
      const { staticSpecifiers } = parseImports(file.source);
      for (const { specifier, line } of staticSpecifiers) {
        // (1) pakiet strzeżony poza wyspą
        const guarded = island.packages.find(
          (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
        );
        if (guarded && !inIsland) {
          violations.push({
            island: island.name,
            kind: "package-outside-island",
            from: file.path,
            line,
            target: specifier,
            reason: island.reason,
          });
          continue;
        }
        // (2) statyczne wejście do wyspy z zewnątrz
        const resolved = resolveSpecifier(file.path, specifier, exists);
        if (resolved && members.has(resolved) && !inIsland) {
          violations.push({
            island: island.name,
            kind: "static-entry-into-island",
            from: file.path,
            line,
            target: resolved,
            reason: island.reason,
          });
        }
      }
    }
  }
  return violations;
}

/** Czytelny raport dla asercji testu / logu CI. */
export function formatViolations(violations: IslandViolation[]): string {
  return violations
    .map((v) => {
      const what =
        v.kind === "package-outside-island"
          ? `importuje strzeżony pakiet "${v.target}"`
          : `statycznie wchodzi do wyspy przez "${v.target}"`;
      return `  ${v.from}:${v.line} ${what}\n    wyspa "${v.island}": ${v.reason}`;
    })
    .join("\n");
}
