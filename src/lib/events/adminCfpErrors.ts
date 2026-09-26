// Odmowy bazy w panelu NABORU PRELEGENTÓW -> zdanie po ludzku.
//
// Rdzeń mapowania (`mapCfpFailure`) jest wspólny z mapą strony publicznej;
// tu stoi wyłącznie przestrzeń kluczy panelu (`adminEventCfp.errors.*`) i jej
// nakładka. Zdanie mówi, CO POPRAWIĆ: `score_max_below_reviews` bez liczby
// z ogona zmuszałby do zgadywania, jak nisko wolno zejść ze skalą.
import i18n from "@/lib/i18n";
import { ensureAdminEventCfpI18n } from "@/lib/i18n-admin-event-cfp";
import { mapCfpFailure, type CfpFailure } from "@/lib/events/publicCfpErrors";

export function adminCfpFailure(error: unknown): CfpFailure {
  ensureAdminEventCfpI18n();
  return mapCfpFailure("adminEventCfp.errors.", error);
}

export function adminCfpErrorMessage(error: unknown): string {
  const failure = adminCfpFailure(error);
  return i18n.t(failure.key, failure.params);
}
