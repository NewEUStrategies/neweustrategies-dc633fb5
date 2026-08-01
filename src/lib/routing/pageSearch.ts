// Współdzielony, defensywny parser paginacji z URL-a (?page=N) dla tras z
// SSR-paginowanymi listami wpisów: strony głównej w trybie "najnowsze wpisy"
// i archiwum /blog. Jedna definicja = jeden kontrakt URL-a:
//  - wartości domyślne zostają NIEJAWNE (bez duplikatu `?page=1` obok
//    kanonicznego adresu bez parametrów),
//  - śmieciowe wejście (NaN, ułamki, liczby < 1, tablice) znika z adresu
//    zamiast mnożyć warianty cache i klucze zapytań.
export interface PageSearch {
  page?: number;
}

export function parsePageSearch(search: Record<string, unknown>): PageSearch {
  const raw = Number(search.page);
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
  return page !== undefined && page > 1 ? { page } : {};
}
