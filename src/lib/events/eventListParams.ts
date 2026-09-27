// Model stanu URL LISTY WYDARZEN - czysty modul (bez Reacta, bez routera).
//
// DLACZEGO STAN JEST W URL-U, A NIE W `useState`. Redaktor pracujacy nad edycja
// wraca do listy dziesiatki razy dziennie i za kazdym razem ustawia te same trzy
// filtry. Stan w komponencie znaczy: nie da sie tego wysłac koledze linkiem, nie
// da sie odswiezyc strony bez utraty filtra i nie da sie wrocic przyciskiem
// przegladarki. Ta sama lekcja co katalog osob (`peopleSearchParams`, 08.2026).
//
// NAZWY PARAMETROW SA KROTKIE, bo trafiaja do adresu, ktory ktos wkleja
// w wiadomosci. `t` zamiast `type_id`, `f` zamiast `format`.
//
// JEDEN WALIDATOR DLA DWOCH WEJSC, ktore musza rozumiec dokladnie to samo:
// adres w przegladarce (`validateSearch` trasy) i argumenty RPC. Nieznane pola
// sa odrzucane, wartosci poza zbiorem degraduja do domyslnych - adres wpisany
// z reki nie moze wywrocic listy.
//
// Walidator adresu (`parseEventListParams`, zakladki, rozmiary strony) jest
// w lisciu `eventListSearch` - trasa wola go w `validateSearch`, czyli w chunku
// wejsciowym (patrz naglowek tamtego pliku). Tu zostaje to, czego potrzebuje
// dopiero ekran listy: argumenty RPC, liczniki, zakres strony i etykiety.
import {
  EVENT_LIST_PAGE_SIZE,
  type EventListPageSize,
  type EventListParams,
  type EventListTab,
} from "@/lib/events/eventListSearch";

export {
  EVENT_LIST_PAGE_SIZE,
  EVENT_LIST_PAGE_SIZES,
  EVENT_LIST_TABS,
  parseEventListParams,
  type EventListPageSize,
  type EventListParams,
  type EventListTab,
} from "@/lib/events/eventListSearch";

export const EVENT_LIST_TAB_LABEL_KEYS: Record<EventListTab, string> = {
  all: "adminEvents.list.tabs.all",
  draft: "adminEvents.list.tabs.draft",
  published: "adminEvents.list.tabs.published",
  upcoming: "adminEvents.list.tabs.upcoming",
  past: "adminEvents.list.tabs.past",
  cancelled: "adminEvents.list.tabs.cancelled",
};

/** Rozmiar strony rozstrzygniety - brak w adresie znaczy domyslny. */
export function eventListPageSize(params: EventListParams): EventListPageSize {
  return params.size ?? EVENT_LIST_PAGE_SIZE;
}

/** Zakladka rozstrzygnieta - brak w adresie znaczy `all`. */
export function eventListTab(params: EventListParams): EventListTab {
  return params.tab ?? "all";
}

/**
 * Argumenty RPC listy wyprowadzone ze stanu URL.
 *
 * ZAKLADKI `upcoming` i `past` NIE SA STATUSAMI, tylko statusem `published`
 * plus granica czasu. Rozdzielenie zyje TUTAJ, a nie w RPC, bo RPC ma jeden,
 * przewidywalny kontrakt (status + zakres dat), a nie szescioelementowy enum
 * zakladek interfejsu, ktory zmieni sie przy pierwszym redesignie.
 *
 * `now` jest PARAMETREM, nie `Date.now()` w ciele: funkcja czysta daje sie
 * przetestowac bez zamrazania zegara, a granica „przyszle/przeszle" musi byc
 * ta sama dla listy i dla licznikow.
 */
export function eventListQueryArgs(
  params: EventListParams,
  now: Date,
): {
  p_status?: string;
  p_type_id?: string;
  p_format?: string;
  p_q?: string;
  p_from?: string;
  p_to?: string;
  p_limit: number;
  p_offset: number;
} {
  const tab = eventListTab(params);
  const iso = now.toISOString();
  // BRAK KLUCZA, A NIE `null`. Postgres uzywa wtedy wartosci DEFAULT NULL
  // z sygnatury, a wygenerowane typy deklaruja te argumenty jako opcjonalne
  // (`p_status?: string`) - `null` nie przechodzi przez `tsc` i konczylby sie
  // rzutowaniem, ktore kasuje kontrakt calej sygnatury.
  return {
    ...(tab === "draft" || tab === "cancelled" ? { p_status: tab } : {}),
    ...(tab === "published" || tab === "upcoming" || tab === "past"
      ? { p_status: "published" }
      : {}),
    ...(params.t === undefined ? {} : { p_type_id: params.t }),
    ...(params.f === undefined ? {} : { p_format: params.f }),
    ...(params.q === undefined ? {} : { p_q: params.q }),
    ...(tab === "upcoming" ? { p_from: iso } : {}),
    ...(tab === "past" ? { p_to: iso } : {}),
    p_limit: eventListPageSize(params),
    p_offset: ((params.page ?? 1) - 1) * eventListPageSize(params),
  };
}

/** Argumenty RPC licznikow - te same filtry BEZ statusu i BEZ granicy czasu. */
export function eventCountsQueryArgs(params: EventListParams): {
  p_type_id?: string;
  p_format?: string;
  p_q?: string;
} {
  return {
    ...(params.t === undefined ? {} : { p_type_id: params.t }),
    ...(params.f === undefined ? {} : { p_format: params.f }),
    ...(params.q === undefined ? {} : { p_q: params.q }),
  };
}

/** Czy jakikolwiek filtr NIE-zakladkowy jest ustawiony (przycisk „wyczysc"). */
export function hasEventListFilters(params: EventListParams): boolean {
  return params.q !== undefined || params.t !== undefined || params.f !== undefined;
}

/** Liczba stron dla licznika calosci z RPC. Zero wierszy to jedna strona. */
export function eventListPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Zakres wierszy pokazany w podpisie paginacji („26-50 z 137").
 *
 * Gorna granica jest przycieta LICZNIKIEM CALOSCI, nie rozmiarem strony:
 * ostatnia strona ma zwykle mniej wierszy, a podpis „126-150 z 137" jest
 * po prostu nieprawda.
 */
export function eventListRange(
  params: EventListParams,
  total: number,
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const size = eventListPageSize(params);
  const from = ((params.page ?? 1) - 1) * size + 1;
  return { from, to: Math.min(from + size - 1, total) };
}
