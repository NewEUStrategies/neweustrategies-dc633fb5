// Katalog ikon tematu klubowego.
//
// PO CO ZAMKNIĘTA LISTA. Lucide ma dziś ~1600 ikon. Wpuszczenie ich wszystkich
// do kompozytora tematu ma dwa koszty, z których żaden nie jest teoretyczny:
// katalog nazw (`lucideIconNodes.generated`) waży setki kB i wjeżdża do chunku
// PUBLICZNEJ trasy, a autor dostaje wyszukiwarkę zamiast decyzji. Temat
// klubowy nie potrzebuje "hamburgera" ani "bluetootha" - potrzebuje kilkunastu
// piktogramów polityki publicznej.
//
// KAŻDA nazwa tutaj należy do zestawu kurowanego w `DynamicIcon`, więc rysuje
// się SYNCHRONICZNIE, bez dociągania pełnego rejestru. To jest kontrakt tego
// pliku - test go pilnuje.
//
// Baza trzyma nazwę w kebab-case i sprawdza wyłącznie jej kształt: lista ikon
// rośnie z każdą wersją paczki, a kopia słownika w CHECK-u znaczyłaby migrację
// przy każdej aktualizacji.

/** Grupa ikon w pickerze. `labelKey` wskazuje klucz i18n (PL/EN). */
export interface ClubIconGroup {
  id: string;
  labelKey: string;
  icons: readonly string[];
}

export const CLUB_THREAD_ICON_GROUPS: readonly ClubIconGroup[] = [
  {
    id: "policy",
    labelKey: "club.iconPicker.group.policy",
    icons: ["landmark", "gavel", "scale", "shield", "flag", "globe", "map", "map-pin"],
  },
  {
    id: "economy",
    labelKey: "club.iconPicker.group.economy",
    icons: [
      "banknote",
      "euro",
      "line-chart",
      "bar-chart-3",
      "pie-chart",
      "trending-up",
      "trending-down",
      "briefcase",
    ],
  },
  {
    id: "infrastructure",
    labelKey: "club.iconPicker.group.infrastructure",
    icons: ["truck", "ship", "plane", "factory", "zap", "leaf", "building-2", "cpu"],
  },
  {
    id: "discussion",
    labelKey: "club.iconPicker.group.discussion",
    icons: [
      "message-square",
      "messages-square",
      "megaphone",
      "help-circle",
      "lightbulb",
      "users",
      "handshake",
      "target",
    ],
  },
  {
    id: "sources",
    labelKey: "club.iconPicker.group.sources",
    icons: [
      "file-text",
      "library",
      "book-open",
      "newspaper",
      "database",
      "list-checks",
      "calendar-days",
      "clock",
    ],
  },
] as const;

/** Płaska lista dozwolonych nazw - jedyne źródło prawdy dla walidacji. */
export const CLUB_THREAD_ICONS: readonly string[] = CLUB_THREAD_ICON_GROUPS.flatMap(
  (group) => group.icons,
);

/**
 * Nazwa gotowa do zapisu. Wartość spoza katalogu degraduje do `null`, a nie do
 * wyjątku: ikona jest ozdobą tematu, więc uszkodzony draft w localStorage albo
 * ręcznie podrasowany formularz nie mają prawa zablokować publikacji. RPC i
 * CHECK w bazie i tak stanowią drugą bramkę.
 */
export function normalizeClubThreadIcon(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase();
  if (name.length === 0) return null;
  return CLUB_THREAD_ICONS.includes(name) ? name : null;
}
