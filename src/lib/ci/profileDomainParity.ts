// Inwariant CI: DOMENA PROFILU MA JEDNĄ DEFINICJĘ, MIMO ŻE ŻYJE W DWÓCH
// JĘZYKACH.
//
// PRZYCZYNA ŹRÓDŁOWA. Dwie rzeczy z warstwy intencji/kompletności profilu MUSZĄ
// istnieć równolegle w SQL-u i w TypeScripcie, bo służą różnym rolom:
//
//   * katalog kodów intencji - baza potrzebuje go w CHECK-u kolumny
//     `profiles.open_to` i w fasetach (`people_filter_options`), klient
//     potrzebuje go do renderowania kontrolek i do serializacji URL-a;
//   * wagi kompletności - baza liczy `profiles.completeness_score` jako sygnał
//     RANKINGU katalogu i bramkę kolejki embeddingów, klient liczy ten sam
//     wynik, żeby pokazać, CZEGO brakuje (bazy o to nie da się sensownie
//     zapytać per pole bez dziesięciu kolumn pochodnych).
//
// Rozjazd tych definicji jest z gatunku niewidzialnych w review: kod się
// kompiluje, testy jednostkowe każdej strony przechodzą, a interfejs
// obiecuje „87 punktów", gdy ranking widzi 74. Dokładnie tak rozjechały się
// kiedyś kolumny preferencji powiadomień (`enabled_saved_search` gubione w
// ręcznie pisanej liście SELECT-a).
//
// Bramka jest TEKSTOWA i celowo nie ciągnie parsera SQL: czyta znaczniki, które
// migracja sama o sobie deklaruje (`-- weight:<klucz>=<waga>`) oraz literał
// tablicy w `nes_profile_open_to_catalog()`. Migracje są forward-only, więc
// analizujemy NAJNOWSZĄ definicję każdej funkcji.

/** Nazwa funkcji SQL trzymającej katalog kodów intencji. */
export const INTENT_CATALOG_FN = "nes_profile_open_to_catalog";
/** Nazwa funkcji SQL trzymającej wagi kompletności. */
export const COMPLETENESS_FN = "nes_profile_completeness_row";

/** Plik migracji poddany skanowi (nazwa + treść). */
export interface MigrationSource {
  readonly file: string;
  readonly sql: string;
}

/**
 * Wyciąga ciało NAJNOWSZEJ definicji funkcji o danej nazwie. Pliki muszą
 * przyjechać posortowane rosnąco (kolejność migracji); zwraca `null`, gdy
 * żadna migracja nie definiuje tej funkcji.
 */
export function latestFunctionBody(
  sources: readonly MigrationSource[],
  fnName: string,
): string | null {
  const pattern = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`,
    "gi",
  );
  let body: string | null = null;

  for (const { sql } of sources) {
    pattern.lastIndex = 0;
    let match = pattern.exec(sql);
    while (match !== null) {
      // Ciało funkcji to fragment między pierwszym i drugim znacznikiem $$
      // po nagłówku - jedyny cytowany blok, jakiego używają migracje repo.
      const open = sql.indexOf("$$", match.index);
      if (open >= 0) {
        const close = sql.indexOf("$$", open + 2);
        if (close > open) body = sql.slice(open + 2, close);
      }
      match = pattern.exec(sql);
    }
  }
  return body;
}

/**
 * Kody z literału `ARRAY[...]` w katalogu intencji, w kolejności zapisu.
 * Komentarze wewnątrz literału (repo je tam ma - jeden na kod) są usuwane
 * przed parsowaniem, żeby `-- rekrutuję` nie trafiło do wyniku.
 */
export function parseIntentCatalog(body: string): string[] {
  const withoutComments = body.replace(/--[^\n]*/g, "");
  const start = withoutComments.indexOf("ARRAY[");
  if (start < 0) return [];
  const end = withoutComments.indexOf("]", start);
  if (end < 0) return [];
  const literal = withoutComments.slice(start + "ARRAY[".length, end);
  return [...literal.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] ?? "").filter(Boolean);
}

/**
 * Wagi ze znaczników `-- weight:<klucz>=<waga>`. Znacznik stoi w tej samej
 * linii co gałąź CASE, której dotyczy, więc jest czytany przez człowieka i
 * przez bramkę w tym samym miejscu.
 */
export function parseCompletenessWeights(body: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const match of body.matchAll(/--\s*weight:([A-Za-z0-9_]+)\s*=\s*(\d+)/g)) {
    const key = match[1];
    const value = Number(match[2]);
    if (key !== undefined && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Różnica dwóch list kodów - `null` gdy identyczne (łącznie z kolejnością). */
export function diffCodeLists(
  sql: readonly string[],
  ts: readonly string[],
): { onlyInSql: string[]; onlyInTs: string[]; orderMismatch: boolean } | null {
  const sqlSet = new Set(sql);
  const tsSet = new Set(ts);
  const onlyInSql = sql.filter((code) => !tsSet.has(code));
  const onlyInTs = ts.filter((code) => !sqlSet.has(code));
  const orderMismatch =
    onlyInSql.length === 0 && onlyInTs.length === 0 && sql.join(",") !== ts.join(",");
  if (onlyInSql.length === 0 && onlyInTs.length === 0 && !orderMismatch) return null;
  return { onlyInSql, onlyInTs, orderMismatch };
}

/** Różnica dwóch tabel wag - `null` gdy identyczne. */
export function diffWeights(
  sql: Readonly<Record<string, number>>,
  ts: Readonly<Record<string, number>>,
): Array<{ key: string; sql: number | null; ts: number | null }> {
  const keys = [...new Set([...Object.keys(sql), ...Object.keys(ts)])].sort();
  return keys
    .map((key) => ({ key, sql: sql[key] ?? null, ts: ts[key] ?? null }))
    .filter((row) => row.sql !== row.ts);
}
