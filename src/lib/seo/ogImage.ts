// Pure helpers dla og:image w kontekście dynamicznych profili.
// Cache-buster: przypinamy `?v=<epoch>` do URL avataru na podstawie
// `profiles.updated_at`, dzięki czemu scraper (Facebook, LinkedIn, X,
// Slack, Signal) po przybiciu w Post Debuggerze pobiera nową wersję,
// a stara jest ignorowana. Nie pushujemy `?v` jeśli URL już zawiera
// jakikolwiek query string (unikamy zerwania signed URL / CDN policy).

/** Zwraca epoch ms z ISO. `0` gdy brak/parse fail - stabilny fallback. */
export function ogVersionFromIso(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Doklej `?v=<version>` do URL. No-op dla pustych, data:URL i URL z `?`. */
export function withOgVersion(url: string | null | undefined, version: number): string | null {
  if (!url) return null;
  if (version <= 0) return url;
  if (url.startsWith("data:")) return url;
  if (url.includes("?")) return url; // signed URL / storage token - nie dotykamy
  return `${url}?v=${version}`;
}
