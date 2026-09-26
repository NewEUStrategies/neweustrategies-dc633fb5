// Efektywny koniec wydarzenia - jedna reguła dla TS i SQL.
//
// `ends_at` bywa puste (wydarzenie jednodniowe bez godziny końca). Wtedy
// koniec = start + doba. Ta sama reguła żyje w SQL jako
// `_event_effective_end(starts, ends)` (migracja `…_event_participant_foundation`):
// od tej chwili otwiera się ankieta, liczy się dostępność certyfikatu, a lista
// „moje wydarzenia" przenosi wpis z „trwa" do „minione". Test parytetu
// (`effectiveEnd.test.ts`) czyta ciało funkcji z migracji i przypina te same
// przypadki, które sprawdza harness `13_participant_foundation.sql`.

/** Domyślna długość wydarzenia bez `ends_at` (24 h - `interval '24 hours'` w SQL). */
export const EVENT_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;

function parseInstant(value: string | null | undefined): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

/**
 * Koniec wydarzenia: `endsAt`, a gdy go brak (albo jest nieczytelny) -
 * `startsAt + 24 h`. `null`, gdy nie ma ani czytelnego końca, ani startu
 * (SQL: `COALESCE(NULL, NULL + interval)` = NULL).
 */
export function eventEffectiveEnd(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): Date | null {
  const end = parseInstant(endsAt);
  if (!Number.isNaN(end)) return new Date(end);
  const start = parseInstant(startsAt);
  return Number.isNaN(start) ? null : new Date(start + EVENT_DEFAULT_DURATION_MS);
}

/**
 * Wariant dla wołającego, który JUŻ ma czytelny start w milisekundach
 * (np. `bucketOf`) - ta sama reguła, bez gałęzi „brak startu".
 */
export function eventEffectiveEndMs(startMs: number, endsAt: string | null | undefined): number {
  const end = parseInstant(endsAt);
  return Number.isNaN(end) ? startMs + EVENT_DEFAULT_DURATION_MS : end;
}
