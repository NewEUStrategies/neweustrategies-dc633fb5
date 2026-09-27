// WDROZONE MIGRACJE: linia bazowa i zamknieta lista wdrozonych plikow ponad
// limit Lovable. Wspolne dla bramki rozmiaru (`migrationSize.ts`) i planu
// podzialu (`migrationSplitPlan.ts`), a osobny modul dlatego, ze bramka juz
// importuje plan (`continuationParts`) - stale w bramce zamknelyby cykl.
//
// PO CO PLANOWI. Repozytorium jest forward-only dla WDROZONYCH migracji.
// Podzial wdrozonej migracji przepisalby wdrozony plik (czesc 1), a czesci
// 2..n dostalyby NOWE wersje, ktore produkcja wykonalaby jako nowe migracje -
// drugi raz te same instrukcje. Bramka zlapalaby to dopiero po zapisie
// (`zwolnienie-nieaktualne`); plan odmawia, zanim cokolwiek zapisze.
//
// BAZOWA LINIA = 20260926100000. Uzasadnienie z historii:
//   * 20260926100000_event_group_guests_follow_lead.sql (52 653 B) to
//     NAJWIEKSZY i NAJPOZNIEJSZY duzy plik, ktory Lovable wdrozyl (zapis 0057,
//     commit eaf5f5e88). Po nim Lovable zapisal juz tylko male pliki:
//     0058 (455d88c20, zrodlo 19 737 B), 0062-0064 (15bc840a7, 61d07f5ad,
//     f43c99209, zrodla 13-26 KB), 0065 (c6412fd0a, zrodlo 2 201 B) i 0066
//     (4ac6622c7, zrodlo 30 152 B). Najwiekszy zapis wdrozenia w calym pasie
//     drizzle to wlasnie 0057 - kazdy inny ma ponizej 34 KB.
//   * Kazdy plik ponad limit z wersja WYZSZA od linii (faktury, lejek, plan
//     sali, raport sponsora, skaner offline, fundament uczestnika, braki cz. 3)
//     jest NIEWDROZONY - to dokladnie te, ktore Lovable odrzucil.
//   * Starsze duze pliki (lipiec-sierpien) sa wdrozone: ich tabele sa
//     w `src/integrations/supabase/types.ts` generowanym z bazy produkcyjnej
//     (np. `event_meeting_tables`, `event_checkpoints`, `event_people`,
//     `programs`, `club_thread_documents`), a 20260830090000 ma w
//     `supabase/migration-ledger.json` uzgodnienie na wersje wykonana
//     20260830172534.
// Linia NIE zwalnia hurtem wszystkiego, co pod nia: bramka zwalnia wylacznie
// plik z listy `DEPLOYED_OVERSIZE`, i to tylko przy DOKLADNIE zapisanym
// rozmiarze. To nie jest pedanteria: na main w chwili wprowadzenia bramki
// `20260926100000_event_cfp.sql` (203 KB, NIEWDROZONY) dzieli wersje z
// wdrozonym plikiem grup - sama linia by go przepuscila. Plan podzialu czyta
// linie w druga strone: wszystko pod nia traktuje jak wdrozone, a niewdrozony
// plik ze stara wersja trzeba najpierw przenumerowac ponad linie.

/** Migracje o wersji <= linii moga byc zwolnione (tylko z listy nizej). */
export const MIGRATION_SIZE_BASELINE = "20260926100000";

/**
 * Wdrozone pliki ponad limit, z rozmiarem w bajtach w chwili wdrozenia.
 * Lista jest ZAMKNIETA: nowy wpis znaczylby, ze ktos wdrozyl duzy plik bez
 * Lovable albo zmienil wdrozona migracje - oba przypadki wymagaja przegladu.
 */
export const DEPLOYED_OVERSIZE: Readonly<Record<string, number>> = {
  "20260712224838_5de38579-3d42-4cfa-a8bc-d87e799bbc2c.sql": 48312,
  "20260714130000_expert_hub.sql": 142589,
  "20260721120000_crm_tasks_followups.sql": 51077,
  "20260725120000_analytics_semantic_layer.sql": 53990,
  "20260808110000_discussion_clubs_a8_hardening.sql": 75506,
  "20260808300000_discussion_clubs_a28_workspace.sql": 51914,
  "20260808310000_discussion_clubs_a28_thread_workspace.sql": 85259,
  "20260810105134_d5d870da-90ed-455b-b950-3764d7a62e17.sql": 51140,
  "20260810120000_discussion_clubs_a32_networking.sql": 51141,
  "20260811150000_discussion_clubs_a35_applications_fixes.sql": 72885,
  "20260822171037_bea8e790-36d6-4b46-b752-c39b673da2ea.sql": 53149,
  "20260823140000_event_sessions.sql": 128510,
  "20260823150000_event_people_registration.sql": 182867,
  "20260823160000_event_sponsors_companies.sql": 116140,
  "20260823170000_event_front_binding.sql": 65071,
  "20260823180000_event_onsite.sql": 193011,
  "20260823190000_event_meetings.sql": 204500,
  "20260824080000_event_admissions_packages_coupons.sql": 76879,
  "20260825191948_ab7f57aa-961d-436a-ba0f-2fd114f42844.sql": 53740,
  "20260830090000_event_registration_checkout_binding.sql": 47447,
  "20260926100000_event_group_guests_follow_lead.sql": 52653,
};

/** Linia i lista razem - tak, jak czyta je plan podzialu (wstrzykiwalne w testach). */
export interface DeployedMigrations {
  readonly baseline: string;
  readonly oversize: Readonly<Record<string, number>>;
}

export const DEPLOYED_MIGRATIONS: DeployedMigrations = {
  baseline: MIGRATION_SIZE_BASELINE,
  oversize: DEPLOYED_OVERSIZE,
};
