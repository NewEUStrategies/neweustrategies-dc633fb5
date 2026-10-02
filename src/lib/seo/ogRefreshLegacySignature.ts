// Polityka STAREGO podpisu webhooka `/api/public/hooks/refresh-og-image`
// (HMAC nad SAMYM slugiem, bez `x-og-timestamp`). Wydzielona z trasy, bo plik
// trasy jest zachłannie ładowany przez routeTree.gen, a decyzja „czy faza 1
// jeszcze trwa" ma być czystą funkcją (zegar i env podaje wołający), testowaną
// tabelarycznie po obu stronach daty wygaszenia.
//
// DLACZEGO DATA W KODZIE, A NIE „GDY W LOGACH ZNIKNIE RUCH". Podpis nad samym
// slugiem jest WIECZNYM tokenem zapisu do `profiles.updated_at`. Faza 2
// opisana jako „usuń gałąź, gdy ruch legacy zniknie" nie miała terminu, więc w
// praktyce nie miała końca. Z datą wygaszenia gałąź zamyka się SAMA i
// FAIL-CLOSED: po terminie stary podpis dostaje 401 z instrukcją, jak podpisać
// po nowemu - bez wdrożenia i bez pamiętania o tym przez kogokolwiek.
//
// DLACZEGO 2027-01-01T00:00:00Z. W repozytorium nie ma innego terminu dla tej
// migracji. Podpis ze znacznikiem czasu wszedł we wrześniu 2026, więc okno do
// końca roku (ponad trzy miesiące) wystarcza na przepięcie CI/cron/integracji,
// a pełna północ UTC na granicy roku nie zależy od strefy czytającego log.
//
// WCZEŚNIEJSZE ZAMKNIĘCIE. `OG_REFRESH_LEGACY_SIGNATURES=off` (także `0`,
// `false`) kończy fazę 1 od razu, np. gdy w logach nie ma już
// `[og-refresh] legacy signature`. PRZEDŁUŻENIA przez env celowo NIE MA:
// przesunięcie terminu ma być zmianą kodu z uzasadnieniem w PR, a nie cichą
// zmienną, która znów czyni token wiecznym.

/** Chwila wygaszenia starego podpisu (UTC). Od niej włącznie - odmowa. */
export const OG_REFRESH_LEGACY_SIGNATURE_SUNSET_ISO = "2027-01-01T00:00:00.000Z";
export const OG_REFRESH_LEGACY_SIGNATURE_SUNSET_MS = Date.parse(
  OG_REFRESH_LEGACY_SIGNATURE_SUNSET_ISO,
);

// Nazwy zmiennej wyłącznika CELOWO nie eksportujemy jako stałej: trasa czyta
// `process.env.OG_REFRESH_LEGACY_SIGNATURES` literałem, bo tylko taki zapis
// widzi bramka `workflowEnvContract` (skan `process.env.KEY`). Druga kopia
// nazwy w stałej byłaby drugim źródłem prawdy, którego nic nie sprawdza.
// Kontrakt nazwy pilnuje test trasy, ustawiający env tym samym literałem.

const KILL_SWITCH_VALUES = new Set(["off", "0", "false"]);

/**
 * `accept` - faza 1 trwa, stary podpis przechodzi (z ostrzeżeniem w logu);
 * `sunset` - minęła data wygaszenia; `disabled` - wyłącznik w env.
 */
export type OgRefreshLegacyPolicy = "accept" | "sunset" | "disabled";

export function ogRefreshLegacyPolicy(
  nowMs: number,
  envValue: string | null | undefined,
): OgRefreshLegacyPolicy {
  if (envValue && KILL_SWITCH_VALUES.has(envValue.trim().toLowerCase())) return "disabled";
  // `!(now < sunset)` zamiast `now >= sunset`: NaN z zepsutego zegara też
  // kończy się odmową, nie przepuszczeniem.
  if (!(nowMs < OG_REFRESH_LEGACY_SIGNATURE_SUNSET_MS)) return "sunset";
  return "accept";
}

/** Komunikat 401 dla odrzuconego starego podpisu - mówi wołającemu, co zmienić. */
export const OG_REFRESH_LEGACY_REJECTED_ERROR =
  'Legacy signature no longer accepted: send x-og-timestamp (unix seconds) and sign "<timestamp>.<slug>"';
