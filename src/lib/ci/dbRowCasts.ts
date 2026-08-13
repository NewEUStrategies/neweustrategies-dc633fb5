// Inwariant CI: KSZTAŁT WIERSZA Z BAZY NIE JEST PRZEPISYWANY RĘCZNIE.
//
// PRZYCZYNA ŹRÓDŁOWA. Wynik zapytania Supabase bywa rzutowany na typ napisany
// ręcznie obok - `const rows = (data ?? []) as unknown as WebhookLogRow[]`
// z `interface WebhookLogRow { … }` dwadzieścia linii wyżej. `as unknown as`
// kasuje KAŻDĄ różnicę między tym, co deklaruje kod, a tym, co naprawdę wraca
// z bazy. Przy 760 migracjach forward-only zmiana nazwy albo nullowalności
// kolumny nie oblewa `tsc` - renderuje `undefined` w kolumnie tabeli albo
// gubi wiersz w `flatMap`.
//
// TO NIE JEST RYZYKO HIPOTETYCZNE - ROZJAZDY BYŁY NA MIEJSCU. Trzy pierwsze
// pliki przejrzane przy wdrożeniu tej bramki miały rozjazd każdy:
//   * `payment_webhook_events`: `retry_count: number | null` przy kolumnie
//     NOT NULL, `payload: unknown` zamiast `Json`;
//   * `payment_orders`: `provider` i `environment` jako `| null` przy NOT NULL,
//     a `status` i `kind` jako `string`, choć w bazie są ENUMAMI - porównanie
//     z literałem spoza enuma kompilowało się i nie trafiało nigdy;
//   * to samo `payment_orders` w zamówieniach biletowych: `metadata` jako
//     `Record<string, unknown> | null` przy kolumnie `jsonb` NOT NULL, której
//     typem jest `Json` - czyli także tablica i napis.
//
// CZEGO WYMAGA BRAMKA. Typ, na który rzutowany jest wynik zapytania, musi być
// WYPROWADZONY z `src/integrations/supabase/types.ts` (`Tables<…>`, `Views<…>`,
// `Functions<…>`, `Database[…]`), a nie napisany od zera. Wtedy skreślenie
// kolumny w migracji jest błędem KOMPILACJI w pliku, który tę kolumnę czyta.
//
// CZEGO NIE MIERZY - świadomie:
//   * castów na `Json` / `Json[]` przy ZAPISIE do kolumny jsonb - to druga
//     granica, gdzie kształt kolumny jest z definicji szerszy niż typ modelu;
//   * castów klienta i kontekstu (`as unknown as SupabaseClient`) - dotyczą
//     wstrzykiwania zależności, nie kształtu wiersza;
//   * castów `as unknown as never` - ma je własna bramka
//     (`check:stale-never-casts`), z innym kryterium i innym uzasadnieniem;
//   * plików testowych - mock wiersza jest celową atrapą, nie deklaracją
//     kontraktu z bazą.

/** Plik źródłowy poddany skanowi (ścieżka względna + treść). */
export interface ScannedSource {
  readonly file: string;
  readonly source: string;
}

/** Rzutowanie wyniku zapytania na typ napisany ręcznie. */
export interface HandWrittenRowCast {
  readonly file: string;
  /** Numer linii, 1-indeksowany. */
  readonly line: number;
  /** Nazwa typu z castu. */
  readonly type: string;
  /** Dosłowna treść linii, przycięta. */
  readonly snippet: string;
}

/**
 * Wpis wyjątku: para `plik::Typ` wraz z POWODEM. Wyjątek bez powodu zamienia
 * listę w listę wymówek, dlatego powód jest polem wymaganym, a nie komentarzem.
 */
export interface RowCastException {
  readonly file: string;
  readonly type: string;
  readonly reason: string;
}

/** Katalogi i pliki poza zasięgiem bramki. */
export function isScannable(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  if (file.includes("/__tests__/")) return false;
  // Wygenerowane typy same siebie nie rzutują.
  if (file === "src/integrations/supabase/types.ts") return false;
  return true;
}

/**
 * Czy `type` jest w tym pliku WYPROWADZONY z wygenerowanych typów.
 *
 * Szukamy deklaracji `type X = …` / `interface X …` i pytamy, czy jej treść
 * odwołuje się do generowanego korzenia. `interface` z listą pól jest z definicji
 * napisany ręcznie - `interface` może dziedziczyć (`extends Pick<Tables<…>>`),
 * więc tę formę też uznajemy.
 */
export function isDerivedFromGenerated(source: string, type: string): boolean {
  const decl = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?(?:type|interface)\\s+${type}\\b([\\s\\S]{0,400})`,
  ).exec(source);
  if (decl === null) return false;
  const head = decl[1];
  // Ucinamy na średniku (alias) albo na końcu nagłówka interfejsu - dalej idą
  // pola, które o pochodzeniu typu nic nie mówią.
  const cut = head.indexOf(";");
  const body = cut === -1 ? head : head.slice(0, cut);
  return /\b(Tables|TablesInsert|TablesUpdate|Views|Enums|Functions|CompositeTypes)\s*</.test(body)
    ? true
    : /\bDatabase\s*\[/.test(body);
}

/** Czy typ jest zadeklarowany w TYM pliku (import z modelu domenowego pomijamy). */
export function isLocallyDeclared(source: string, type: string): boolean {
  return new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:type|interface)\\s+${type}\\b`).test(source);
}

/**
 * Rzutowania wyniku zapytania na typ nazwany. Operand musi wyglądać jak wynik
 * zapytania (`data`, `rows`, `(data ?? [])`) - to zawęża skan do granicy bazy
 * i wyłącza rzutowania modeli w pamięci.
 */
const CAST = /\(?\s*(?:data|rows|records)\s*(?:\?\?\s*\[\]\s*)?\)?\s*as unknown as\s+([A-Z]\w*)/g;

export function scanHandWrittenRowCasts(
  sources: readonly ScannedSource[],
  exceptions: readonly RowCastException[],
): HandWrittenRowCast[] {
  const allowed = new Set(exceptions.map((entry) => `${entry.file}::${entry.type}`));
  const out: HandWrittenRowCast[] = [];
  for (const { file, source } of sources) {
    // Bez zapytania w pliku nie ma granicy bazy.
    if (!source.includes(".from(") && !source.includes(".rpc(")) continue;
    for (const match of source.matchAll(CAST)) {
      const type = match[1];
      if (allowed.has(`${file}::${type}`)) continue;
      // Typ zaimportowany (model domenowy) nie jest ręcznie przepisanym
      // wierszem TEGO pliku - to inna klasa i inna bramka.
      if (!isLocallyDeclared(source, type)) continue;
      if (isDerivedFromGenerated(source, type)) continue;
      const index = match.index ?? 0;
      const line = source.slice(0, index).split("\n").length;
      out.push({
        file,
        line,
        type,
        snippet: (source.split("\n")[line - 1] ?? "").trim().slice(0, 140),
      });
    }
  }
  return out;
}

/** Wyjątki, które przestały być potrzebne - lista ma tylko maleć. */
export function staleExceptions(
  sources: readonly ScannedSource[],
  exceptions: readonly RowCastException[],
): RowCastException[] {
  const byFile = new Map(sources.map((entry) => [entry.file, entry.source]));
  return exceptions.filter((entry) => {
    const source = byFile.get(entry.file);
    if (source === undefined) return true; // plik zniknął
    if (!new RegExp(`as unknown as\\s+${entry.type}\\b`).test(source)) return true; // cast zniknął
    return isDerivedFromGenerated(source, entry.type); // typ już wyprowadzony
  });
}

export function renderRowCastsReport(
  hits: readonly HandWrittenRowCast[],
  scanned: number,
  exceptions: readonly RowCastException[],
): string {
  if (hits.length === 0) {
    return [
      `[db-row-casts] OK - przeskanowano ${scanned} plików.`,
      `[db-row-casts] wyjątków na liście: ${exceptions.length} (lista ma tylko maleć).`,
    ].join("\n");
  }
  const lines = hits.map(
    (hit) =>
      `  - ${hit.file}:${hit.line} rzutuje wynik zapytania na ręcznie napisany \`${hit.type}\`\n` +
      `      ${hit.snippet}`,
  );
  return [
    `[db-row-casts] ${hits.length} rzutowań wyniku zapytania na ręcznie przepisany kształt wiersza:`,
    ...lines,
    "",
    "Jak to naprawić (a nie uciszyć):",
    '  type XRow = Pick<Tables<"nazwa_tabeli">, "kolumna" | "kolumna2">;',
    "  ...i usuń `as unknown as` - typowany klient sam wywnioskuje kształt `select()`.",
    "Wtedy skreślenie kolumny w migracji oblewa `tsc` w tym pliku, zamiast renderować",
    "`undefined` w interfejsie. Jeśli źródłem jest RPC albo widok, którego generowane",
    "typy opisują nieuczciwie (np. kłamią o nullowalności RETURNS TABLE), dopisz wpis",
    "do `ROW_CAST_EXCEPTIONS` w `scripts/check-db-row-casts.ts` - Z POWODEM.",
  ].join("\n");
}
