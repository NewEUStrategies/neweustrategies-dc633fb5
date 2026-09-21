// POLITYKA ŚWIEŻOŚCI DANYCH DOKU - jedna liczba na cały pasek.
//
// ── CO NAPRAWIA ──────────────────────────────────────────────────────────
// Zapytania paneli nie miały ŻADNEGO `staleTime`, czyli domyślnie zero:
// każde otwarcie panelu uznawało dane za przestarzałe i szło do sieci. Panel
// zamknięty i otwarty po dwóch sekundach ładował się od nowa, choć nic nie
// mogło się zmienić - a to jest właśnie ten wzorzec użycia, który dok ma
// obsługiwać (zerknąć na listę, schować, zerknąć znowu).
//
// ── DLACZEGO 30 SEKUND, A NIE WIĘCEJ ANI MNIEJ ───────────────────────────
// Wszystkie cztery zbiory (zadania, notatki, zapisane, kolejka czytania) są
// PRYWATNE i zmienia je wyłącznie ten sam użytkownik, w tej samej karcie,
// przez mutacje, które unieważniają klucz u siebie (`onSuccess` ->
// `invalidateQueries`). Jedyne źródło rozjazdu to druga karta albo drugie
// urządzenie - a tam 30 sekund to koszt, który nikogo nie boli, bo mowa
// o notatniku, nie o saldzie konta.
//
// Więcej (np. 5 minut) zaczęłoby pokazywać nieaktualną listę po powrocie do
// karty zostawionej na godzinę. Mniej (np. 5 sekund) nie zdejmuje kosztu
// z typowego „schowaj i otwórz jeszcze raz".
//
// Kalendarz dostaje więcej, bo miesiąc wydarzeń zmienia REDAKCJA, nie
// czytelnik - jego lista nie reaguje na żadną mutację doku, więc jedynym
// mechanizmem odświeżenia jest właśnie upływ czasu.

/** Prywatne zbiory użytkownika: zadania, notatki, zapisane, kolejka. */
export const DOCK_STALE_MS = 30_000;

/** Miesiąc wydarzeń - zmienia go redakcja, nie użytkownik doku. */
export const DOCK_CALENDAR_STALE_MS = 120_000;

/**
 * `gcTime`: jak długo dane zostają w pamięci PO zamknięciu ostatniego panelu,
 * który ich używał. Domyślne 5 minut Reacta Query jest tu dobrą wartością
 * i podajemy je wprost, bo od tej liczby zależy, czy powrót do panelu po
 * przerwie maluje się z cache (bez sieci), czy startuje od szkieletu.
 * Zapisane wprost, żeby zmiana domyślnej wartości w bibliotece nie zmieniła
 * po cichu odczuwanej szybkości doku.
 */
export const DOCK_GC_MS = 300_000;
