// Nakładka i18n `eventCalendar.*` - ZASIEW Foundation, WŁAŚCICIEL: tor A.
//
// MAŁA NAKŁADKA PUBLICZNA toru A: etykiety menu kalendarza na stronie wydarzenia
// i gwiazdki sesji w agendzie. Jedyna nowa nakładka, którą wolno importować
// z komponentów publicznych (R-I18N) - dlatego ma zostać MAŁA.
//
// KONTRAKT ZASIEWU (spec B.14): Foundation tworzy plik z nazwanymi eksportami
// `eventCalendarPl` / `eventCalendarEn` o identycznych drzewach i bramkuje prefiks od
// pierwszego dnia (`GATED_PREFIXES`, `REFERENCE_PREFIXES`). Właściciel dopisuje
// klucze swobodnie, ale NIE zmienia prefiksu, trzyma parytet PL/EN i ZOSTAWIA
// zdanie `menu.title` (PL) - to znacznik `HEAVY_DICTIONARIES`
// w `scripts/check-entry-purity.ts`, po którym bramka rozpoznaje tę nakładkę
// w paczce startowej.
import i18n from "@/lib/i18n";

export const eventCalendarPl = {
  eventCalendar: {
    menu: {
      title: "Dodaj termin do kalendarza",
    },
  },
} as const;

export const eventCalendarEn = {
  eventCalendar: {
    menu: {
      title: "Add the date to your calendar",
    },
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", eventCalendarPl, true, true);
  i18n.addResourceBundle("en", "translation", eventCalendarEn, true, true);
}

ensureI18n();
