// Nagłówek pliku pasa drizzle wygenerowanego z pasa supabase. Moduł-liść bez
// importów: czyta go bramka pasów (src/lib/ci/migrationLaneParity.ts), a generator
// (drizzleMirror.ts) sam importuje bramkę - nagłówek w generatorze domknąłby cykl
// migrationLaneParity -> drizzleMirror -> migrationLaneParity.
export const MIRROR_SOURCE_PREFIX = "-- migrations-mirror: supabase/migrations/";
export const MIRROR_HEADER_RE =
  /^-- migrations-mirror: supabase\/migrations\/(\d{14}_[A-Za-z0-9_.-]+\.sql)\r?\n/;

/** Nagłówek ASCII (jak nagłówki części split-migration); SQL wykonywalny go nie widzi. */
export function mirrorHeader(sourceFile: string): string {
  return [
    `${MIRROR_SOURCE_PREFIX}${sourceFile}`,
    "-- WYGENEROWANE przez `bun run migrations:mirror` z pliku wyzej - NIE EDYTUJ RECZNIE.",
    "-- Zrodlo prawdy schematu: supabase/migrations. Ten plik to kopia dostawcza dla",
    "-- migratora Drizzle platformy Lovable (drizzle.config.ts); bramka",
    "-- check:migration-lanes pilnuje, ze jego SQL wykonywalny == zrodlo.",
    "",
    "",
  ].join("\n");
}

/** Plik źródłowy wpisu wygenerowanego; `null` dla wpisu panelu albo starego bliźniaka. */
export function mirrorSourceOf(sql: string | null): string | null {
  return sql === null ? null : (MIRROR_HEADER_RE.exec(sql)?.[1] ?? null);
}
