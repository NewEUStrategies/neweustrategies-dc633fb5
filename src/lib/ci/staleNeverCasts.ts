// Inwariant CI: CAST `as never` NA GRANICY SUPABASE ZNIKA W TEJ SAMEJ CHWILI,
// W KTÓREJ TYPY ZOSTAJĄ ZREGENEROWANE.
//
// PRZYCZYNA ŹRÓDŁOWA. `src/integrations/supabase/types.ts` jest GENEROWANY, więc
// świeża tabela albo RPC nie istnieje w typach do najbliższej regeneracji.
// Konwencja repo (WDROZENIE_REKOMENDACJI_2026-07-23) każe w tym oknie pisać
// `supabase.from("tabela" as never)` zamiast `any` - i to jest dobra konwencja,
// dopóki okno się nie zamknie. Problem zaczyna się PO regeneracji: cast nie
// przestaje kompilować się sam z siebie, nikt go nie usuwa, a `never`:
//
//   * kasuje typ zwrotki (`data` jest `never`), więc kod dopisuje pod spodem
//     `as unknown as X` - ręcznie przepisany kształt wiersza, który od tej pory
//     dryfuje względem bazy bez żadnego sygnału,
//   * kasuje typ ARGUMENTÓW RPC, więc literówka w nazwie parametru albo `null`
//     tam, gdzie sygnatura ma `DEFAULT`, przechodzi kompilację i wraca jako
//     błąd 404/400 z PostgREST w przeglądarce,
//   * udaje dług tymczasowy, będąc długiem trwałym: komentarz „do usunięcia
//     przy regeneracji types.ts" wisiał w tym repo przy RPC, które siedziały
//     w wygenerowanych typach od kilku wydań.
//
// Bramka porównuje NAZWĘ w cascie z zawartością wygenerowanych typów. Cast na
// nazwę, której w typach nie ma, jest LEGALNY (okno przed regeneracją) i nie
// jest zgłaszany. Cast na nazwę, która JEST w typach, to dług przedawniony -
// bramka pada i podaje plik z numerem linii.
//
// CZEGO NIE MIERZY - świadomie:
//   * castów `as never` na PAYLOADZIE (`insert({...} as never)`) - to osobna
//     granica jsonb, gdzie kształt kolumny bywa szerszy niż typ generowany,
//   * castów `as never` poza klientem Supabase (router TanStacka, właściwości
//     CSS) - nie mają nic wspólnego z regeneracją typów,
//   * plików testowych - `{children as never}` w mocku providera to celowa
//     ucieczka od typu, nie dług typów bazy.

/** Plik źródłowy poddany skanowi (ścieżka względna + treść). */
export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/** Przedawniony cast: nazwa jest już w wygenerowanych typach. */
export interface StaleNeverCast {
  readonly file: string;
  /** Numer linii, 1-indeksowany. */
  readonly line: number;
  readonly kind: "table" | "rpc";
  /** Nazwa relacji albo funkcji z castu. */
  readonly name: string;
  /** Dosłowna treść linii (przycięta) - żeby log wskazywał miejsce, nie tylko plik. */
  readonly snippet: string;
}

/** Zbiory nazw wyciągnięte z wygenerowanych typów. */
export interface GeneratedTypeNames {
  readonly tables: ReadonlySet<string>;
  readonly functions: ReadonlySet<string>;
}

/** Katalogi i pliki poza zasięgiem bramki. */
export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) return false;
  // Sam plik z typami oraz moduł tej bramki (mówi o cascie, nie używa go).
  if (file.endsWith("src/integrations/supabase/types.ts")) return false;
  if (file.endsWith("src/lib/ci/staleNeverCasts.ts")) return false;
  return true;
}

/**
 * Wyciąga nazwy z jednej sekcji wygenerowanych typów (`Tables`, `Views`,
 * `Functions`). Parser jest celowo tekstowy i zakotwiczony w wcięciu, które
 * emituje generator supabase - żeby nie ciągnąć TypeScript-compilera do bramki,
 * która ma być natychmiastowa.
 */
export function collectSection(typesSource: string, section: string): Set<string> {
  const lines = typesSource.split("\n");
  const start = lines.indexOf(`    ${section}: {`);
  const out = new Set<string>();
  if (start < 0) return out;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Zamknięcie sekcji: pierwsza klamra na wcięciu sekcji.
    if (/^ {4}\}/.test(line)) break;
    const match = line.match(/^ {6}([a-z0-9_]+):/);
    if (match?.[1] !== undefined) out.add(match[1]);
  }
  return out;
}

/** Buduje zbiory nazw znanych wygenerowanym typom. */
export function readGeneratedTypeNames(typesSource: string): GeneratedTypeNames {
  const tables = collectSection(typesSource, "Tables");
  for (const view of collectSection(typesSource, "Views")) tables.add(view);
  return { tables, functions: collectSection(typesSource, "Functions") };
}

const TABLE_CAST = /\.from\(\s*"([a-z0-9_]+)"\s+as never\s*\)/;
const RPC_CAST = /\.rpc\(\s*"([a-z0-9_]+)"\s+as never/;

/** Znajduje casty `as never`, których nazwa jest już w wygenerowanych typach. */
export function scanStaleNeverCasts(
  sources: readonly ScannedSource[],
  known: GeneratedTypeNames,
): StaleNeverCast[] {
  const hits: StaleNeverCast[] = [];

  for (const { file, source } of sources) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      const table = line.match(TABLE_CAST);
      if (table?.[1] !== undefined && known.tables.has(table[1])) {
        hits.push({
          file,
          line: index + 1,
          kind: "table",
          name: table[1],
          snippet: line.trim().slice(0, 120),
        });
      }
      const rpc = line.match(RPC_CAST);
      if (rpc?.[1] !== undefined && known.functions.has(rpc[1])) {
        hits.push({
          file,
          line: index + 1,
          kind: "rpc",
          name: rpc[1],
          snippet: line.trim().slice(0, 120),
        });
      }
    });
  }

  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Log bramki - zielony podaje zasięg, czerwony podaje plik, linię i nazwę. */
export function renderStaleNeverCastsReport(
  hits: readonly StaleNeverCast[],
  scannedFiles: number,
  known: GeneratedTypeNames,
): string {
  const scope = `${scannedFiles} plików, ${known.tables.size} relacji i ${known.functions.size} funkcji w wygenerowanych typach`;

  if (hits.length === 0) {
    return `✓ Inwariant \`as never\` OK (${scope}: zero castów na nazwy, które są już w typach).`;
  }

  const lines = hits.map(
    (hit) =>
      `  ${hit.file}:${hit.line} - ${hit.kind === "table" ? "relacja" : "RPC"} \`${hit.name}\` JEST w wygenerowanych typach\n      ${hit.snippet}`,
  );

  return [
    `✗ ${hits.length} przedawnionych castów \`as never\` (${scope}).`,
    ...lines,
    "",
    "Cast `as never` jest legalny WYŁĄCZNIE w oknie między migracją a regeneracją",
    "`src/integrations/supabase/types.ts`. Powyższe nazwy są już w typach, więc cast",
    "nie chroni przed niczym - kasuje typ zwrotki i argumentów, przez co ręcznie",
    "przepisany kształt wiersza dryfuje względem bazy bez żadnego sygnału.",
    "Napraw: usuń cast (i towarzyszący mu `as unknown as ...`), zostaw typ z generatora.",
  ].join("\n");
}
