// Walidator ADRESU listy wydarzen w panelu (`/admin/events/list`) - lisc
// wydzielony z `eventListParams.ts`.
//
// PO CO OSOBNY PLIK. `parseEventListParams` jest wolany w `validateSearch`
// trasy, a ta opcja - jak `head` i `loader` - nalezy do NIEDZIELONEJ czesci
// pliku trasy, czyli jedzie w chunku WEJSCIOWYM kazdej strony serwisu. Import
// z `eventListParams` ciagnal tam argumenty RPC listy i licznikow, zakres
// strony, mapy etykiet zakladek, a przez `isEventFormat` - caly katalog
// rodzajow z `eventTypes` (kronika `scripts/check-bundle-size.ts`, wpis XX).
// `eventListParams` re-eksportuje wszystko stad, wiec panel ma jedno zrodlo
// importu.
import { isEventFormat, type EventFormat } from "@/lib/events/eventFormats";

/** Zakladki statusu nad lista. `all` jest zakladka, nie brakiem filtra. */
export const EVENT_LIST_TABS = [
  "all",
  "draft",
  "published",
  "upcoming",
  "past",
  "cancelled",
] as const;
export type EventListTab = (typeof EVENT_LIST_TABS)[number];

/**
 * Dopuszczalne rozmiary strony. Zbior jest ZAMKNIETY i pokrywa sie z domyslnym
 * `pageSizeOptions` molekuly `AdminPagination`, bo to ona rysuje te droplistę -
 * rozmiar spoza zbioru dalby kontrolke bez zaznaczonej wartosci.
 *
 * Gorna granica 200 jest ta sama co CLAMP w `admin_events_list`: wartosc wyzsza
 * i tak zostalaby przycieta po stronie bazy, a lista klamalaby o paginacji.
 */
export const EVENT_LIST_PAGE_SIZES = [20, 50, 100, 200] as const;
export type EventListPageSize = (typeof EVENT_LIST_PAGE_SIZES)[number];

/** Rozmiar domyslny - pierwszy ze zbioru. */
export const EVENT_LIST_PAGE_SIZE: EventListPageSize = 20;

/** Gorne limity dlugosci - URL nie jest miejscem na eseje. */
const MAX_QUERY = 200;

/** Stan listy w URL-u. Wszystkie pola opcjonalne - czysta lista dziala. */
export interface EventListParams {
  /** Zakladka statusu; brak = `all`. */
  tab?: EventListTab;
  /** Fraza po tytulach, adresie i miejscu. */
  q?: string;
  /** Identyfikator rodzaju z katalogu. */
  t?: string;
  /** Format wydarzenia. */
  f?: EventFormat;
  /** Numer strony liczony od 1 - w adresie „strona 1" czyta sie lepiej niz 0. */
  page?: number;
  /** Rozmiar strony; brak = domyslny. Zapisany w adresie, bo to preferencja. */
  size?: EventListPageSize;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim().slice(0, max);
  return next.length > 0 ? next : undefined;
}

function isTab(value: unknown): value is EventListTab {
  return typeof value === "string" && (EVENT_LIST_TABS as readonly string[]).includes(value);
}

function isPageSize(value: unknown): value is EventListPageSize {
  return typeof value === "number" && (EVENT_LIST_PAGE_SIZES as readonly number[]).includes(value);
}

/**
 * Identyfikator rodzaju musi wygladac na UUID, zeby nie polecial do RPC jako
 * tekst - odmowa `22P02` (invalid input syntax for type uuid) nie mowi nic
 * redaktorowi, ktory tylko przekleil adres.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Walidacja i kanonizacja stanu listy. Nieznane pola sa odrzucane. */
export function parseEventListParams(input: Record<string, unknown>): EventListParams {
  const rawPage = Number(input.page);
  const rawSize = Number(input.size);
  const typeId = text(input.t, 36);
  const format = text(input.f, 16);
  return {
    tab: isTab(input.tab) && input.tab !== "all" ? input.tab : undefined,
    q: text(input.q, MAX_QUERY),
    t: typeId !== undefined && UUID_RE.test(typeId) ? typeId.toLowerCase() : undefined,
    f: format !== undefined && isEventFormat(format) ? format : undefined,
    page: Number.isFinite(rawPage) && rawPage > 1 ? Math.floor(rawPage) : undefined,
    size: isPageSize(rawSize) && rawSize !== EVENT_LIST_PAGE_SIZE ? rawSize : undefined,
  };
}
