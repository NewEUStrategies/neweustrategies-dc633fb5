// Ustawienia czasu czytania z site_settings (klucz `reading_time`).
// Czyta ze zbiorczej mapy ustawień ogrzanej przez root loader (SSR-safe,
// zero dodatkowych zapytań); walidacja/uzupełnianie zodem, niepoprawny zapis
// degraduje do domyślnych.
import { useSiteSetting } from "@/lib/useSiteSetting";
import {
  DEFAULT_READING_TIME_SETTINGS,
  READING_TIME_SETTINGS_KEY,
  readingTimeSettingsSchema,
  type ReadingTimeSettings,
} from "@/lib/readingTime";

export function useReadingTimeSettings(): ReadingTimeSettings {
  return useSiteSetting(
    READING_TIME_SETTINGS_KEY,
    DEFAULT_READING_TIME_SETTINGS,
    readingTimeSettingsSchema,
  );
}
