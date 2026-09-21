/**
 * Pierwszy niepusty sekret z listy nazw - status panelu i odczyt tokenu muszą
 * widzieć te same aliasy (GA4_* / GOOGLE_*).
 *
 * Helper żyje w osobnym module, bo funkcje deklarowane lokalnie w plikach
 * `*.functions.ts` nie zawsze trafiają do modułu wydzielonego przez plugin
 * server-fn (stąd runtime `firstEnv is not defined`). Import przetrwa split.
 */
export function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
