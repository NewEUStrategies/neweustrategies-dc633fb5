// Rangi warstw czlonkostwa - MODUL LISCIOWY, bez importow.
//
// Wydzielone z `tiers.ts`, bo tamten plik ciagnie React Query i klienta
// Supabase. Kazdy, kto potrzebuje wylacznie odpowiedzi na pytanie "od ktorej
// rangi zaczyna sie Pro", placil za to calym drzewem zaleznosci danych - a
// czysta logika dostepu przestawala byc testowalna bez srodowiska.
//
// Rangi kanoniczne (seed DB, katalog v6.2 - nazwy zmienily sie od v3, rangi
// nie): Czytelnik=0, wspierajacy=5, Czlonek=10 (student/kadra akademicka
// rowniez 10), Czlonek Pro=20, Rada Instytutu=25 (Zespol=25), Partner
// Biznesowy=28 (wycofany ze sprzedazy, obecni klienci zostaja),
// Enterprise=30 (karta ukryta, prog klubow), Partner Instytucjonalny=40
// (NGO=40), Partner Strategiczny=50, Krag Zalozycieli=60.
//
// NGO=40 od decyzji wlasciciela 2026-10-20 (I9b, 20261020160100): v6.2
// sprzedaje organizacjom pozarzadowym ZAKRES Partnera Instytucjonalnego
// w stawce -50%, a ranga 20 dawala zakres Pro bez trackera - karta obiecywala
// wiecej niz bramka. Ranga nie jest unikalna: remis NGO/Partner rozstrzyga
// `sort_order` (Partner 80, NGO 85) - `compareTierRank` nizej.
//
// Parzystosc z seedem (pricing_catalog_v3_rows(), pricing_catalog_v62_rows()
// i jej redefinicja z I9b) wymusza test tierCatalogParity.test.ts - edycja
// seedu bez aktualizacji tej mapy (i odwrotnie) obleje CI zamiast cicho
// dryfowac.
export const TIER_RANKS = {
  reader: 0,
  supporter: 5,
  member: 10,
  student: 10,
  educator: 10,
  pro: 20,
  vip: 25,
  team: 25,
  business: 28,
  corporate: 30,
  partner: 40,
  ngo: 40,
  partner_general: 50,
  presidents_circle: 60,
} as const;

export type TierKey = keyof typeof TIER_RANKS;

/**
 * Kolejnosc progow „ranga rosnaco" ze STABILNYM drugim kluczem. Ranga nie
 * jest unikalna (Czlonek/student/kadra 10, Rada/Zespol 25, Partner/NGO 40),
 * a samo `rank` zostawia remisy kolejnosci wierszy z bazy - lista albo
 * „wymagany prog" sciany platnosci potrafily zmieniac sie miedzy
 * odswiezeniami. Drugi klucz `sort_order` (kolejnosc kart z panelu cennika),
 * trzeci - klucz progu.
 */
export function compareTierRank(
  a: { rank: number; sort_order?: number | null; key: string },
  b: { rank: number; sort_order?: number | null; key: string },
): number {
  return a.rank - b.rank || (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.key.localeCompare(b.key);
}
