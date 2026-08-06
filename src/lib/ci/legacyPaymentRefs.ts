// Inwariant CI: PO MIGRACJI NA STRIPE NIE ZOSTAJE ŻADNA ŻYWA REFERENCJA DO
// STAREGO OPERATORA PŁATNOŚCI.
//
// Wzmianka historyczna w komentarzu („dawniej Paddle", „zastępuje
// paddleTransaction.server.ts") jest w porządku - to dokumentacja. Każde
// wystąpienie w KODZIE WYKONYWANYM - import, identyfikator, literał stringowy,
// nazwa zmiennej środowiskowej, klucz w manifeście, adres bramki - oznacza
// ścieżkę, która realnie próbuje rozmawiać z operatorem, którego ten projekt
// już nie ma. Taka ścieżka pada dopiero w RUNTIME, w połowie checkoutu.
//
// ── DLACZEGO TEN MODUŁ POWSTAŁ Z POPRZEDNIEJ WERSJI BRAMKI ──────────────────
// Bramka skanowała wyłącznie `src/` i `scripts/`, i tylko rozszerzenia kodu
// aplikacji. Poza jej zasięgiem został cały `.github/` - a to właśnie tam
// siedział najdroższy egzemplarz tej klasy błędu: `billing-nightly.yml`
// eksportował `PADDLE_SANDBOX_API_KEY`, podczas gdy sonda czytała
// `STRIPE_SANDBOX_API_KEY`. Efekt: nocny przebieg co dobę spał 40 minut,
// kończył się na zielono i nie sprawdzał NICZEGO. Bramka, która nie widzi
// warstwy CI, nie widzi połowy kodu wykonywanego przez projekt.
//
// Zasięg jest teraz świadomie szerszy niż kod aplikacji:
//   - `.github/`      - workflow to kod wykonywany, tyle że przez runnera,
//   - `package.json`  - martwa zależność `@paddle/*` to instalowany, wersjonowany
//                       i skanowany przez audyt supply chain pakiet,
//   - `.env.example`  - kontrakt konfiguracyjny; zła nazwa klucza tutaj to
//                       cicho niedziałające płatności u kolejnej osoby,
//   - `supabase/migrations/` OD `MIGRATION_SCAN_FROM` w górę - patrz niżej.
//
// ── MIGRACJE: HISTORII SIĘ NIE PRZEPISUJE ───────────────────────────────────
// Zastosowane migracje są NIEZMIENNE - `paddle_subscription_id` w pliku z
// 20260729 to fakt historyczny, a nie dług. Kolumny przemianowano migracją
// 20260805134721, a treści FAQ wyczyszczono w 20260805205656. Dlatego bramka
// skanuje wyłącznie migracje NOWSZE od tej ostatniej: stara historia zostaje
// nietknięta, a każdy NOWY plik SQL musi już mówić o Stripe.
//
// Warstwa wykonawcza (chodzenie po katalogach, exit code) żyje w
// `scripts/check-legacy-payment-refs.ts`; ten moduł jest czysty i testowalny.

/** Nazwa poprzedniego operatora - jedyny wzorzec, którego szuka bramka. */
export const LEGACY_PROVIDER_PATTERN = /paddle/i;

/**
 * Ostatnia migracja domykająca odejście od poprzedniego operatora (czyszczenie
 * treści FAQ). Skanujemy migracje ŚCIŚLE nowsze - starsze to zamrożona historia.
 */
export const MIGRATION_SCAN_FROM = "20260805205656";

/**
 * Pliki, które MUSZĄ zawierać szukane słowo, żeby w ogóle działać: sama bramka
 * i jej test. Ścieżki są względne wobec korzenia repo i porównywane dokładnie.
 */
export const SELF_REFERENTIAL_FILES: readonly string[] = [
  "src/lib/ci/legacyPaymentRefs.ts",
  "src/lib/ci/__tests__/legacyPaymentRefs.test.ts",
];

/** Katalogi przechodzone rekurencyjnie. */
export const SCAN_ROOTS: readonly string[] = ["src", "scripts", "e2e", ".github", "supabase"];

/** Pojedyncze pliki w korzeniu repo, poza katalogami wyżej. */
export const SCAN_FILES: readonly string[] = ["package.json", ".env.example"];

/** Katalogi nigdy nieprzechodzone (artefakty, zależności, raporty). */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".git",
  ".output",
  ".vite",
  "coverage",
  "reports",
  "playwright-report",
  "test-results",
]);

export type CommentSyntax = "c-like" | "hash" | "sql" | "none";

export interface CommentRules {
  /** Tokeny komentarza do końca wiersza. */
  readonly lineTokens: readonly string[];
  /** Para znaczników komentarza blokowego, jeśli składnia go ma. */
  readonly blockToken?: readonly [string, string];
  /** Znaki otwierające literał tekstowy - w środku nic nie jest komentarzem. */
  readonly quoteChars: readonly string[];
  /** Czy `\` w literale ucieka następny znak (C/JS: tak, YAML/SQL: nie). */
  readonly backslashEscape: boolean;
  /**
   * Czy token komentarza musi stać na początku wiersza albo po białym znaku.
   * YAML tego wymaga (`a#b` to zwykły skalar), C i SQL nie.
   */
  readonly lineTokenNeedsBoundary: boolean;
}

const C_LIKE: CommentRules = {
  lineTokens: ["//"],
  blockToken: ["/*", "*/"],
  quoteChars: ['"', "'", "`"],
  backslashEscape: true,
  lineTokenNeedsBoundary: false,
};

const HASH: CommentRules = {
  lineTokens: ["#"],
  quoteChars: ['"', "'"],
  backslashEscape: false,
  lineTokenNeedsBoundary: true,
};

const SQL: CommentRules = {
  lineTokens: ["--"],
  blockToken: ["/*", "*/"],
  quoteChars: ["'"],
  backslashEscape: false,
  lineTokenNeedsBoundary: false,
};

/** JSON nie ma komentarzy - każdy znak jest kodem. */
const NONE: CommentRules = {
  lineTokens: [],
  quoteChars: [],
  backslashEscape: false,
  lineTokenNeedsBoundary: false,
};

export const COMMENT_RULES: Readonly<Record<CommentSyntax, CommentRules>> = {
  "c-like": C_LIKE,
  hash: HASH,
  sql: SQL,
  none: NONE,
};

const SYNTAX_BY_SUFFIX: ReadonlyArray<readonly [readonly string[], CommentSyntax]> = [
  [[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css"], "c-like"],
  [[".yml", ".yaml", ".sh", ".toml", ".env", ".env.example"], "hash"],
  [[".sql"], "sql"],
  [[".json"], "none"],
];

/** Rozszerzenia w ogóle brane pod uwagę (suma powyższej tabeli). */
export const SCANNABLE_SUFFIXES: readonly string[] = SYNTAX_BY_SUFFIX.flatMap(
  ([suffixes]) => suffixes,
);

/** Składnia komentarzy dla pliku albo `null`, jeśli plik nas nie interesuje. */
export function commentSyntaxFor(path: string): CommentSyntax | null {
  const lower = path.toLowerCase();
  // Najdłuższy pasujący sufiks wygrywa: `.env.example` przed `.example`.
  let best: { length: number; syntax: CommentSyntax } | null = null;
  for (const [suffixes, syntax] of SYNTAX_BY_SUFFIX) {
    for (const suffix of suffixes) {
      if (lower.endsWith(suffix) && (best === null || suffix.length > best.length)) {
        best = { length: suffix.length, syntax };
      }
    }
  }
  return best?.syntax ?? null;
}

/**
 * Usuwa komentarze, zostawiając wyłącznie kod - z uwzględnieniem literałów
 * tekstowych, żeby `"https://..."` ani `'# nie komentarz'` nie ucinały wiersza.
 *
 * Stan literału resetuje się na granicy wiersza (stringi wielolinijkowe zostają
 * więc przeskanowane w całości - i dobrze: template literal ze starą nazwą
 * operatora to żywa referencja). Komentarz blokowy przechodzi między wierszami.
 */
export function stripComments(source: string, syntax: CommentSyntax): string[] {
  const rules = COMMENT_RULES[syntax];
  const state = { inBlock: false };
  return source.split("\n").map((line) => stripLine(line, rules, state));
}

function stripLine(line: string, rules: CommentRules, state: { inBlock: boolean }): string {
  const blockOpen = rules.blockToken?.[0];
  const blockClose = rules.blockToken?.[1];
  let out = "";
  let quote: string | null = null;
  let i = 0;

  while (i < line.length) {
    if (state.inBlock) {
      const end = blockClose ? line.indexOf(blockClose, i) : -1;
      if (end === -1) return out;
      state.inBlock = false;
      i = end + (blockClose?.length ?? 0);
      continue;
    }

    const char = line[i];

    if (quote !== null) {
      out += char;
      if (rules.backslashEscape && char === "\\" && i + 1 < line.length) {
        out += line[i + 1];
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (rules.quoteChars.includes(char)) {
      quote = char;
      out += char;
      i += 1;
      continue;
    }

    if (blockOpen && line.startsWith(blockOpen, i)) {
      state.inBlock = true;
      i += blockOpen.length;
      continue;
    }

    const lineToken = rules.lineTokens.find((token) => line.startsWith(token, i));
    if (lineToken !== undefined) {
      const atBoundary = i === 0 || /\s/.test(line[i - 1]);
      if (!rules.lineTokenNeedsBoundary || atBoundary) return out;
    }

    out += char;
    i += 1;
  }

  return out;
}

/** `20260805205656_opis.sql` -> `20260805205656`. */
const MIGRATION_VERSION_RE = /(?:^|\/)(\d{14})_[^/]*\.sql$/;

/**
 * Czy dany plik podlega bramce. Odsiewa: nieznane rozszerzenia, pliki
 * samoreferencyjne, wszystko w `supabase/` poza migracjami oraz migracje
 * starsze lub równe `MIGRATION_SCAN_FROM` (zamrożona historia).
 */
export function isScannable(relativePath: string): boolean {
  const path = relativePath.replaceAll("\\", "/");
  if (SELF_REFERENTIAL_FILES.includes(path)) return false;
  if (commentSyntaxFor(path) === null) return false;

  if (path.startsWith("supabase/")) {
    const version = MIGRATION_VERSION_RE.exec(path)?.[1];
    if (version === undefined) return false;
    return version > MIGRATION_SCAN_FROM;
  }

  return true;
}

export interface LegacyRefHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ScannedFile {
  readonly file: string;
  readonly source: string;
}

/** Żywe referencje w JEDNYM pliku. Zakłada, że plik przeszedł `isScannable`. */
export function scanSource(file: string, source: string): LegacyRefHit[] {
  if (!LEGACY_PROVIDER_PATTERN.test(source)) return [];
  const syntax = commentSyntaxFor(file);
  if (syntax === null) return [];

  const hits: LegacyRefHit[] = [];
  stripComments(source, syntax).forEach((line, index) => {
    if (LEGACY_PROVIDER_PATTERN.test(line)) {
      hits.push({ file, line: index + 1, text: line.trim() });
    }
  });
  return hits;
}

/** Żywe referencje w całym zestawie plików, posortowane deterministycznie. */
export function scanLegacyPaymentRefs(files: readonly ScannedFile[]): LegacyRefHit[] {
  return files
    .filter(({ file }) => isScannable(file))
    .flatMap(({ file, source }) => scanSource(file, source))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function renderLegacyPaymentRefsReport(
  hits: readonly LegacyRefHit[],
  scannedFiles: number,
): string {
  if (hits.length === 0) {
    return (
      `✓ Bramka dostawcy płatności OK (${scannedFiles} plików: src, scripts, e2e, ` +
      `.github, manifesty, migracje od ${MIGRATION_SCAN_FROM} - zero żywych referencji).`
    );
  }

  const lines = [
    `✗ Znaleziono ${hits.length} ŻYWYCH referencji do poprzedniego operatora płatności ` +
      "(poza komentarzami):",
  ];
  for (const hit of hits) lines.push(`    ${hit.file}:${hit.line}  ${hit.text}`);
  lines.push(
    "  Napraw: przepnij na Stripe (src/lib/stripe.server.ts, src/lib/stripe.ts),",
    "  a wzmiankę historyczną przenieś do komentarza.",
    "  W workflow: sekret nazywa się STRIPE_SANDBOX_API_KEY / STRIPE_LIVE_API_KEY",
    "  - dokładnie tak czyta go src/lib/stripe.server.ts.",
  );
  return lines.join("\n");
}
