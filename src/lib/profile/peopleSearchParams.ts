// Model stanu URL KATALOGU OSÓB - czysty moduł (bez Reacta, bez routera).
//
// Do 08.2026 fraza i filtry /people siedziały w `useState`, więc katalogu nie
// dało się ani udostępnić linkiem, ani ZAPISAĆ - a bez zapisanego stanu nie ma
// alertu „dołączył ktoś, kogo szukasz" (encja 'people' w `saved_searches`,
// migracja 20260807142000).
//
// Ten moduł jest JEDNYM walidatorem dla trzech wejść, które muszą rozumieć
// dokładnie ten samo:
//   1. adres w przeglądarce (`validateSearch` trasy),
//   2. snapshot z bazy przy przywracaniu zapisanego wyszukiwania (jsonb
//      nieznanego pochodzenia - mógł powstać w starszej wersji modelu),
//   3. gałąź `people` producenta alertów w SQL-u (lustro nazw parametrów).
//
// Nazwy parametrów są krótkie i czytelne, bo trafiają do href-a powiadomienia.
import { normalizeProfileIntents, serializeProfileIntents } from "@/lib/profile/intents";

/** Stan katalogu w URL-u. Wszystkie pola opcjonalne - czysty /people działa. */
export interface PeopleSearchParams {
  q?: string;
  specialization?: string;
  company?: string;
  location?: string;
  /** profiles.job_title - w URL-u krócej niż nazwa kolumny. */
  role?: string;
  /** CSV kodów intencji w kolejności katalogu (patrz lib/profile/intents). */
  open?: string;
  /** "1" = tylko profile zweryfikowane zawodowo. */
  verified?: string;
  /** "1" = tryb semantyczny (dopasowanie po znaczeniu frazy). */
  sem?: string;
}

/** Górne limity długości - URL nie jest miejscem na eseje. */
const MAX_QUERY = 200;
const MAX_FACET = 120;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim().slice(0, max);
  return next.length > 0 ? next : undefined;
}

/**
 * Flaga w URL-u ma dokładnie jedną kanoniczną postać ("1"), żeby dwa adresy
 * o tym samym znaczeniu nie tworzyły dwóch wpisów w cache'u zapytań.
 * Router JSON-parses query strings, so a reloaded `?verified=1` arrives as
 * the number 1. Stored strings and legacy boolean flags stay compatible.
 */
function flag(value: unknown): string | undefined {
  return value === 1 || value === "1" || value === true || value === "true" ? "1" : undefined;
}

/** Walidacja i kanonizacja stanu katalogu. Nieznane pola są odrzucane. */
export function parsePeopleSearchParams(input: Record<string, unknown>): PeopleSearchParams {
  const open = serializeProfileIntents(normalizeProfileIntents(text(input.open, MAX_FACET) ?? ""));
  return {
    q: text(input.q, MAX_QUERY),
    specialization: text(input.specialization, MAX_FACET),
    company: text(input.company, MAX_FACET),
    location: text(input.location, MAX_FACET),
    role: text(input.role, MAX_FACET),
    open: open.length > 0 ? open : undefined,
    verified: flag(input.verified),
    sem: flag(input.sem),
  };
}

/** Czy poza frazą ustawiony jest jakikolwiek filtr fasetowy. */
export function hasPeopleFacetFilters(params: PeopleSearchParams): boolean {
  return Boolean(
    params.specialization ||
    params.company ||
    params.location ||
    params.role ||
    params.open ||
    params.verified,
  );
}

/**
 * Czy stan jest wart zapisania. Sam tryb semantyczny bez frazy i bez filtrów
 * nie jest wyszukiwaniem - to tylko przełącznik, więc nie liczy się do `canSave`.
 */
export function isPeopleSearchSaveable(params: PeopleSearchParams): boolean {
  return Boolean(params.q) || hasPeopleFacetFilters(params);
}

/** Wyczyszczenie filtrów z zachowaniem frazy i trybu wyszukiwania. */
export function clearedPeopleFacets(): PeopleSearchParams {
  return {
    specialization: undefined,
    company: undefined,
    location: undefined,
    role: undefined,
    open: undefined,
    verified: undefined,
  };
}
