// Okno wdrożenia „kod przed migracją" - JEDNA definicja dla całego repo.
//
// Migracje z `supabase/migrations/` wchodzą na produkcję osobno od kodu (panel
// Lovable), więc kod, który woła nową funkcję albo czyta nowy kształt, musi
// przeżyć chwilę, w której bazy jeszcze tego nie ma. Wąsko: tylko „PostgREST nie
// zna funkcji" (PGRST202) i „Postgres nie zna funkcji o tej sygnaturze" (42883).
// Każdy inny błąd - odmowa uprawnień, timeout, sieć - NIE jest oknem wdrożenia
// i wołający ma go traktować jak awarię, a nie jak powód do starej ścieżki.
//
// Wcześniej ten sam zbiór kodów żył w trzech plikach modułu wydarzeń jako
// prywatna stała; tu jest jedno miejsce, które ścieżki zastępcze mogą wskazać.

/** Kody błędu, które znaczą „baza jeszcze nie ma tej funkcji". */
export const MIGRATION_PENDING_CODES: ReadonlySet<string> = new Set(["PGRST202", "42883"]);

/** Czy błąd PostgREST/Postgres to brak funkcji przed wejściem migracji. */
export function isMigrationPending(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  return MIGRATION_PENDING_CODES.has(String((error as { code?: unknown }).code ?? ""));
}
