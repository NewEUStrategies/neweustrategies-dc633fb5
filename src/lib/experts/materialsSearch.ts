// Kontrakt URL archiwum autora (/author/$slug): parsowanie i normalizacja
// search params eksploratora materiałów. Stan strony i filtrów żyje w URL
// (deep-linki, SSR strony N, przycisk wstecz), więc parser jest jedynym
// źródłem prawdy o tym, co jest legalnym parametrem - trasa używa go jako
// `validateSearch`, a warstwa zapytań przez `filtersFromAuthorHubSearch`.
// Czysty moduł bez IO - testowalny jednostkowo.
import { EMPTY_MATERIAL_FILTER_SLUGS, type MaterialFilterSlugs, type MaterialKind } from "./types";

export const MATERIAL_KIND_VALUES: readonly MaterialKind[] = [
  "article",
  "report",
  "video",
  "podcast",
  "event",
];

/** Zakres lat spójny z materialYear (lata >1900); górna granica tnie śmieci. */
const YEAR_MIN = 1901;
const YEAR_MAX = 2100;
/** Sufit długości sluga w URL - dłuższe wartości to nie są nasze slugi. */
const SLUG_MAX_LENGTH = 200;

/**
 * Search params trasy /author/$slug. Wszystkie opcjonalne - brak klucza to
 * wartość domyślna, więc kanoniczny URL profilu pozostaje czysty. Klucze są
 * serializowane TYLKO, gdy niosą poprawną wartość (jak w archiwach
 * taksonomii - inaczej router przepisywałby URL w pętli).
 */
export interface AuthorHubSearch {
  page?: number;
  kind?: MaterialKind;
  /** Slug taga (wymiar "Temat"). */
  topic?: string;
  /** Slug regionu. */
  region?: string;
  /** Slug programu/projektu. */
  program?: string;
  year?: number;
}

function parsePage(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

function parseKind(raw: unknown): MaterialKind | undefined {
  if (typeof raw !== "string") return undefined;
  return MATERIAL_KIND_VALUES.includes(raw as MaterialKind) ? (raw as MaterialKind) : undefined;
}

/** Slug z URL: przycięty, bez białych znaków w środku, o sensownej długości. */
function parseSlug(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > SLUG_MAX_LENGTH || /\s/.test(value)) return undefined;
  return value;
}

function parseYear(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < YEAR_MIN || value > YEAR_MAX) return undefined;
  return value;
}

/**
 * `validateSearch` trasy /author/$slug: niepoprawne wartości są po cichu
 * odrzucane (URL z ręcznie zepsutym parametrem renderuje profil od strony 1
 * zamiast 500-ować), a klucze emitowane wyłącznie dla wartości poprawnych.
 */
export function parseAuthorHubSearch(search: Record<string, unknown>): AuthorHubSearch {
  const out: AuthorHubSearch = {};
  const page = parsePage(search.page);
  const kind = parseKind(search.kind);
  const topic = parseSlug(search.topic);
  const region = parseSlug(search.region);
  const program = parseSlug(search.program);
  const year = parseYear(search.year);
  if (page !== undefined) out.page = page;
  if (kind !== undefined) out.kind = kind;
  if (topic !== undefined) out.topic = topic;
  if (region !== undefined) out.region = region;
  if (program !== undefined) out.program = program;
  if (year !== undefined) out.year = year;
  return out;
}

/** Projekcja search params na filtry slugowe warstwy danych. */
export function filtersFromAuthorHubSearch(search: AuthorHubSearch): MaterialFilterSlugs {
  return {
    ...EMPTY_MATERIAL_FILTER_SLUGS,
    kind: search.kind ?? null,
    topic: search.topic ?? null,
    region: search.region ?? null,
    program: search.program ?? null,
    year: search.year ?? null,
  };
}

/** Czy jakikolwiek filtr materiałów jest aktywny (bez samego `page`). */
export function hasActiveMaterialFilters(search: AuthorHubSearch): boolean {
  return (
    search.kind !== undefined ||
    search.topic !== undefined ||
    search.region !== undefined ||
    search.program !== undefined ||
    search.year !== undefined
  );
}

/** Czy URL opisuje widok spaginowany/przefiltrowany (nie-kanoniczny). */
export function isPaginatedAuthorHubView(search: AuthorHubSearch): boolean {
  return (search.page ?? 1) > 1 || hasActiveMaterialFilters(search);
}
