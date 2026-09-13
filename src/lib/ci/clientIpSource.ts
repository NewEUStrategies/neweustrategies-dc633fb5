// Inwariant CI: „KTO DZWONI" MA W TYM REPOZYTORIUM DOKŁADNIE JEDNĄ DEFINICJĘ.
//
// ── PRZYCZYNA ŹRÓDŁOWA ──────────────────────────────────────────────────────
// `x-forwarded-for` jest listą, do której KLIENT dopisuje własny prefiks -
// Cloudflare (preset `cloudflare-module`, vite.config.ts) NIE zastępuje
// wartości klienta, tylko dokleja adres połączenia na KOŃCU. Każdy kod, który
// czyta ten nagłówek sam, prędzej czy później sięga po `split(",")[0]` - czyli
// po DEKLARACJĘ KLIENTA. Kubełek limitu kluczowany taką wartością rotuje się
// jednym nagłówkiem, a `x-forwarded-for: " "` znosi go w całości.
//
// To nie jest hipoteza: dokładnie ten zapis stał w SIEDMIU miejscach naraz
// (bramka brute-force logowania, dowód zgody RODO, cztery publiczne formularze
// i endpoint wypisu z newslettera), każde z własną, lekko inną kolejnością
// nagłówków. Zalecenie „`cf-connecting-ip` przed `x-forwarded-for`" leżało
// spisane w repo dwukrotnie (docs/AUDYT_PLATFORMY_2026-07-13.md:209,
// docs/ANALIZA_MODULOW_DOGLEBNA_2026-08-12.md:5273) i przez dwa miesiące
// niezrealizowane, bo obok stało błędnie uspokajające zdanie „na Workers to
// w porządku".
//
// ── CO BRAMKA EGZEKWUJE ─────────────────────────────────────────────────────
// Nazwa nagłówka `x-forwarded-for` może wystąpić w KODZIE WYKONYWANYM tylko
// w `src/lib/http/rateLimit.ts`. Reszta repozytorium woła `clientIpFromHeaders`
// albo `rateLimitIpSubject` stamtąd. Wzmianka w komentarzu jest w porządku -
// to dokumentacja, dlatego skan idzie po źródle z zamaskowanymi komentarzami
// (`bezKomentarzy`), a nie po surowym tekście.
//
// Pliki testowe są poza zasięgiem: test MUSI móc ustawić ten nagłówek, żeby
// udowodnić, że produkcyjny kod bierze właściwy wpis.
//
// Warstwa wykonawcza (chodzenie po katalogach, kod wyjścia) żyje w
// `scripts/check-client-ip-source.ts`; ten moduł jest czysty i testowalny.
import { bezKomentarzy } from "./sourceScan";

/** Nagłówek, którego klient podrabia - szukany wzorzec. */
export const SPOOFABLE_HEADER = "x-forwarded-for";

/** Jedyny moduł, w którym wolno go czytać: kanoniczna definicja kolejności. */
export const CANONICAL_MODULE = "src/lib/http/rateLimit.ts";

/** Katalog objęty skanem. */
export const SCAN_ROOT = "src";

/** Katalogi nigdy nieprzechodzone. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".git",
  ".output",
  ".vite",
  "coverage",
]);

/**
 * Pliki, które MUSZĄ zawierać szukaną nazwę, żeby w ogóle działać: sama bramka
 * i jej test. Bez tego bramka wywracałaby się na własnej dokumentacji.
 */
export const SELF_REFERENTIAL_FILES: readonly string[] = [
  "src/lib/ci/clientIpSource.ts",
  "src/lib/ci/__tests__/clientIpSource.test.ts",
];

/** Imienne zwolnienie - z pisanym powodem, bo bramka nie uzasadni go za autora. */
export interface ClientIpAllowEntry {
  readonly file: string;
  readonly reason: string;
}

/**
 * Imienne zwolnienia. Każde z pisanym powodem i terminem - allowlista ma się
 * KURCZYĆ do pustej, a wpis, któremu nic już nie odpowiada, OBLEWA bramkę
 * (patrz `staleAllowlist`), więc nie da się o niej zapomnieć.
 *
 * DZIŚ PUSTA i taka ma zostać. Trzy pozycje, z którymi bramka powstawała
 * (`experiment-event.ts`, `related-click.ts`, `impersonation.functions.ts`),
 * zostały przepięte na `clientIpFromHeaders` w tym samym przemiataniu -
 * pusta lista jest więc stanem docelowym, a nie brakiem inwentaryzacji.
 */
export const CLIENT_IP_ALLOWLIST: readonly ClientIpAllowEntry[] = [];

export interface ClientIpViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

export interface ClientIpReport {
  readonly violations: readonly ClientIpViolation[];
  /** Wpisy allowlisty, którym nic już nie odpowiada - też OBLEWAJĄ bramkę. */
  readonly staleAllowlist: readonly string[];
  readonly stats: {
    readonly scannedFiles: number;
    readonly allowlisted: number;
  };
}

/**
 * Czy plik podlega bramce. Odsiewa: nie-TypeScript, testy (muszą móc ustawić
 * nagłówek), kanoniczny moduł i pliki samoreferencyjne.
 */
export function isScannable(relativePath: string): boolean {
  const path = relativePath.replaceAll("\\", "/");
  if (!/\.tsx?$/.test(path)) return false;
  if (!path.startsWith(`${SCAN_ROOT}/`)) return false;
  if (path === CANONICAL_MODULE) return false;
  if (SELF_REFERENTIAL_FILES.includes(path)) return false;
  if (path.includes("/__tests__/")) return false;
  if (/\.(test|spec)\.tsx?$/.test(path)) return false;
  return true;
}

/** Wystąpienia nazwy nagłówka w KODZIE jednego pliku (komentarze zamaskowane). */
export function scanSource(file: string, source: string): ClientIpViolation[] {
  if (!source.toLowerCase().includes(SPOOFABLE_HEADER)) return [];
  const hits: ClientIpViolation[] = [];
  bezKomentarzy(source)
    .split("\n")
    .forEach((line, index) => {
      if (line.toLowerCase().includes(SPOOFABLE_HEADER)) {
        hits.push({ file, line: index + 1, text: line.trim() });
      }
    });
  return hits;
}

/** Pełny raport dla zestawu źródeł. */
export function scanClientIpSource(
  sources: readonly ScannedSource[],
  allowlist: readonly ClientIpAllowEntry[],
): ClientIpReport {
  const scannable = sources.filter(({ file }) => isScannable(file));
  const allHits = scannable
    .flatMap(({ file, source }) => scanSource(file, source))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const allowedFiles = new Set(allowlist.map((entry) => entry.file));
  const violations = allHits.filter((hit) => !allowedFiles.has(hit.file));
  const allowlisted = allHits.length - violations.length;
  const uzyte = new Set(allHits.map((hit) => hit.file));

  return {
    violations,
    staleAllowlist: allowlist.map((e) => e.file).filter((file) => !uzyte.has(file)),
    stats: { scannedFiles: scannable.length, allowlisted },
  };
}

/**
 * Pusty zestaw źródeł OBLEWA. Bramka, która nic nie przeskanowała, wygląda
 * dokładnie jak przechodząca - to najgroźniejszy tryb awarii, groźniejszy od
 * fałszywego alarmu.
 */
export function clientIpSourceFailed(report: ClientIpReport): boolean {
  return (
    report.violations.length > 0 ||
    report.staleAllowlist.length > 0 ||
    report.stats.scannedFiles === 0
  );
}

export function renderClientIpSourceReport(report: ClientIpReport): string {
  if (report.stats.scannedFiles === 0) {
    return `✗ Bramka źródła adresu nie przeskanowała ANI JEDNEGO pliku w ${SCAN_ROOT}/ - to awaria skanera, nie zieleń.`;
  }

  const lines: string[] = [];
  if (report.violations.length > 0) {
    lines.push(
      `✗ ${report.violations.length} odczytów \`${SPOOFABLE_HEADER}\` poza \`${CANONICAL_MODULE}\`:`,
    );
    for (const v of report.violations) lines.push(`    ${v.file}:${v.line}  ${v.text}`);
    lines.push(
      `  Napraw: wołaj \`clientIpFromHeaders\` albo \`rateLimitIpSubject\` z \`@/lib/http/rateLimit\`.`,
      `  Pierwszy wpis \`${SPOOFABLE_HEADER}\` to DEKLARACJA KLIENTA, nie adres - kubełek po nim`,
      '  kluczowany rotuje się jednym nagłówkiem, a wartość " " znosi go w całości.',
    );
  }
  if (report.staleAllowlist.length > 0) {
    lines.push(
      `✗ ${report.staleAllowlist.length} wpisów allowlisty nie ma już czego zwalniać (usuń je):`,
    );
    for (const file of report.staleAllowlist) lines.push(`    ${file}`);
  }
  if (lines.length === 0) {
    return (
      `✓ Bramka źródła adresu OK (${report.stats.scannedFiles} plików, ` +
      `${report.stats.allowlisted} zwolnień imiennych) - kolejność nagłówków mieszka tylko w ${CANONICAL_MODULE}.`
    );
  }
  return lines.join("\n");
}
