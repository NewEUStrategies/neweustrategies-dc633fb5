// Atomy testowe KATALOGÓW TAKSONOMII klubów: wiersz obszaru tematycznego
// (`admin_club_topics_list`) i wiersz specjalizacji
// (`admin_club_specializations_list`).
//
// DLACZEGO OSOBNY PLIK, A NIE `fixtures.ts`. Oba wiersze obsługują WYŁĄCZNIE
// panel katalogów (dwa organizmy plus ich moduł reguł), więc trzymanie ich
// w atomie modułu klubów dokładałoby każdemu innemu plikowi testowemu dwa
// typy, których nigdy nie użyje.
//
// KOLUMNY OPISOWE SPECJALIZACJI SĄ NULL-OWALNE i to jest cała wartość
// domyślnych wartości tutaj: wiersz „pełny” ma je wypełnione, a przypadek
// CZĘŚCIOWY (`lead_pl: null`) trzeba móc zbudować JEDNYM nadpisaniem - bo
// właśnie na nim wykłada się formularz, który wstawi `null` do pola tekstowego.
import type { ClubTopicAdminRow } from "@/lib/clubs/topicCatalog";
import type { ClubSpecializationAdminRow } from "@/lib/clubs/specializationsApi";

/** Wiersz katalogu obszarów w panelu. Domyślnie: włączony, nieużywany, własny. */
export function clubTopicAdminRow(overrides: Partial<ClubTopicAdminRow> = {}): ClubTopicAdminRow {
  return {
    id: "topic-1",
    key: "energy",
    label_pl: "Energetyka",
    label_en: "Energy",
    sort_order: 30,
    is_active: true,
    is_system: false,
    clubs_count: 0,
    threads_count: 0,
    ...overrides,
  };
}

/** Wiersz katalogu specjalizacji w panelu. Domyślnie: włączona, bez klubów. */
export function clubSpecializationAdminRow(
  overrides: Partial<ClubSpecializationAdminRow> = {},
): ClubSpecializationAdminRow {
  return {
    id: "spec-1",
    slug: "energy",
    key: "energy",
    label_pl: "Energetyka",
    label_en: "Energy",
    lead_pl: "Rynek energii w Unii",
    lead_en: "Energy market in the Union",
    desc_pl: "Opis polski",
    desc_en: "English description",
    icon: "Zap",
    sort_order: 40,
    is_active: true,
    is_system: false,
    clubs_count: 0,
    ...overrides,
  };
}
