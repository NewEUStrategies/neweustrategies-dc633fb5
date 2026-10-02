// Pure helpers dla og:image w kontekście dynamicznych profili.
// Cache-buster: przypinamy `?v=<epoch>` do URL avataru na podstawie
// `profiles.updated_at`, dzięki czemu scraper (Facebook, LinkedIn, X,
// Slack, Signal) po przybiciu w Post Debuggerze pobiera nową wersję,
// a stara jest ignorowana.
//
// INWARIANTY ADRESU (operacje na napisie, nie na `new URL()` - ten wymaga bazy,
// a avatar bywa ścieżką względną `/uploads/...`):
//   * parametr ląduje PRZED `#fragmentem` - fragment nie jest wysyłany w
//     żądaniu HTTP, więc `?v=` doklejone za hashem byłoby martwe;
//   * query złożone WYŁĄCZNIE z naszych `v=` jest PODMIENIANE na bieżącą
//     wersję (bez duplikatu `?v=1?v=2` / `&v=` obok starego `v=`);
//   * każde INNE query (signed URL Supabase `?token=`, policy CDN
//     `?Expires=&Signature=`) zostaje nietknięte - dopisanie parametru zrywa
//     podpis i og:image zwraca 403, czyli podgląd bez obrazka. Nie odróżnimy
//     podpisanego query od zwykłego, więc nie scalamy z żadnym.

/** Zwraca epoch ms z ISO. `0` gdy brak/parse fail - stabilny fallback. */
export function ogVersionFromIso(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Czy query (bez `?`) składa się wyłącznie z parametrów `v=` - naszych. */
function isOnlyOgVersionQuery(query: string): boolean {
  return query !== "" && query.split("&").every((part) => part.startsWith("v="));
}

/**
 * Doklej `?v=<version>` do URL - przed `#fragmentem`, z podmianą wcześniejszego
 * `v=`. No-op dla pustych, data:URL, wersji <= 0 i URL z obcym query.
 */
export function withOgVersion(url: string | null | undefined, version: number): string | null {
  if (!url) return null;
  if (!Number.isFinite(version) || version <= 0) return url;
  if (url.startsWith("data:")) return url;

  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : url.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return `${beforeHash}?v=${version}${fragment}`;
  if (isOnlyOgVersionQuery(beforeHash.slice(queryAt + 1))) {
    return `${beforeHash.slice(0, queryAt)}?v=${version}${fragment}`;
  }
  return url; // signed URL / storage token / policy CDN - nie dotykamy
}
