// Nakładka i18n `eventPlan.*` - ZASIEW Foundation, WŁAŚCICIEL: tor A.
//
// Nakładka toru A: osobisty plan wydarzenia (zapisy, gwiazdki, spotkania 1-1),
// subskrypcja kalendarza i preferencje przypomnień uczestnika.
//
// KONTRAKT ZASIEWU (spec B.14): Foundation tworzy plik z nazwanymi eksportami
// `eventPlanPl` / `eventPlanEn` o identycznych drzewach i bramkuje prefiks od
// pierwszego dnia (`GATED_PREFIXES`, `REFERENCE_PREFIXES`). Właściciel dopisuje
// klucze swobodnie, ale NIE zmienia prefiksu, trzyma parytet PL/EN i ZOSTAWIA
// zdanie `title` (PL) - to znacznik `HEAVY_DICTIONARIES`
// w `scripts/check-entry-purity.ts`, po którym bramka rozpoznaje tę nakładkę
// w paczce startowej.
import i18n from "@/lib/i18n";

export const eventPlanPl = {
  eventPlan: {
    title: "Mój plan wydarzenia",
  },
} as const;

export const eventPlanEn = {
  eventPlan: {
    title: "My event plan",
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", eventPlanPl, true, true);
  i18n.addResourceBundle("en", "translation", eventPlanEn, true, true);
}

ensureI18n();
