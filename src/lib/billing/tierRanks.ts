// Rangi warstw czlonkostwa - MODUL LISCIOWY, bez importow.
//
// Wydzielone z `tiers.ts`, bo tamten plik ciagnie React Query i klienta
// Supabase. Kazdy, kto potrzebuje wylacznie odpowiedzi na pytanie "od ktorej
// rangi zaczyna sie Pro", placil za to calym drzewem zaleznosci danych - a
// czysta logika dostepu przestawala byc testowalna bez srodowiska.
//
// Rangi kanoniczne (seed DB, katalog v3): Essential=0, wspierajacy=5,
// Plus=10 (student/kadra akademicka rowniez 10), Pro=20 (NGO=20), VIP=25
// (zespol=25), Enterprise=30, Strategic Partner=40, Partner Generalny=50,
// President's Circle=60.
//
// Parzystosc z seedem pricing_catalog_v3_rows() wymusza test
// tierCatalogParity.test.ts - edycja seedu bez aktualizacji tej mapy
// (i odwrotnie) obleje CI zamiast cicho dryfowac.
export const TIER_RANKS = {
  reader: 0,
  supporter: 5,
  member: 10,
  student: 10,
  educator: 10,
  pro: 20,
  ngo: 20,
  vip: 25,
  team: 25,
  business: 28,
  corporate: 30,
  partner: 40,
  partner_general: 50,
  presidents_circle: 60,
} as const;

export type TierKey = keyof typeof TIER_RANKS;
