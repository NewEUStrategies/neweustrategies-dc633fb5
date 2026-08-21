// Wejście dla żywego podglądu zakładki „Dostęp" - składane bez Reacta.
//
// CO BYŁO W JSX-IE. Ciało `ClubAccessTab` trzymało trzy rzeczy, z których żadna
// nie jest układem:
//
//   1. LOKALNĄ FUNKCJĘ `dict()` budującą słownik `wartość -> tłumaczenie`
//      dla czterech wymiarów dostępu. To ona pilnuje niewidocznego
//      z interfejsu warunku: podpowiedź POD DROPLISTĄ i zdanie W PODGLĄDZIE
//      muszą pochodzić z TEGO SAMEGO klucza i18n. Rozjazd tych dwóch miejsc
//      daje panel, w którym droplista mówi jedno, a podgląd drugie - a podgląd
//      jest tu jedynym miejscem, gdzie administrator widzi iloczyn pięciu pól.
//      Dlatego prefiksy są tu STAŁYMI, z których korzystają OBIE strony.
//   2. WYBÓR PIĘCIU PÓL wersji roboczej, które wchodzą do zdania (`moderationMode`
//      do zdania NIE wchodzi - nie zmienia tego, kto co widzi i kto wchodzi).
//   3. WARUNEK EMISJI PROGU PLANU. Wyświetlana pozycja droplisty powstaje przez
//      `planTierFromRank`, które rangę spoza słownika degraduje W DÓŁ. Wybór
//      TEJ SAMEJ pozycji, która już się wyświetla, zapisałby wtedy próg NIŻSZY
//      od istniejącego, wyglądając przy tym jak brak zmiany - czyli cicho
//      wpuściłby do klubu plany, które miały zostać za bramką.
//
// Reguł samego zdania (kolejność, podmiana rangi) i wykrywania ostrzeżeń tu NIE
// MA - są w `accessSentence.ts` i mają własny test. Ten moduł tylko DOSTARCZA
// im wejście i dlatego zwraca klucze i18n albo gotowy słownik, nigdy tekst
// złożony z własnych napisów.
//
// SŁOWNIK PANELU, A NIE PUBLICZNY. Klucze `adminClubs.*` zwracane przez ten
// moduł mieszkają w `i18n-clubs-admin`, który trzeba jawnie dociągnąć przez
// `ensureAdminClubsI18n()`. Moduł tego NIE robi i nie może - nie zna Reacta
// ani i18next - i dlatego jest osiągalny WYŁĄCZNIE z organizmów panelu, które
// `ensureAdminClubsI18n()` wołają. Ta granica jest pilnowana bramką
// `adminClubsI18nLoading.gate`; jej złamanie kończy się gołym kluczem na
// ekranie i widać je dopiero w przeglądarce.
import type { AccessSentenceInput, AccessSentenceLabels } from "./accessSentence";
import { planTierFromRank, rankFromPlanTier, type ClubPlanTier } from "./planTiers";
import type { ClubAccessDraftValues } from "./adminClubEditor";
import {
  CLUB_ATTRIBUTION_MODES,
  CLUB_JOIN_POLICIES,
  CLUB_POST_POLICIES,
  CLUB_VISIBILITIES,
} from "./types";

/**
 * Prefiksy kluczy i18n zakładki. JEDNO źródło dla droplisty (etykieta pozycji,
 * podpowiedź pod polem) i dla podglądu zdania - patrz punkt 1 w nagłówku.
 */
export const CLUB_ACCESS_I18N = {
  visibility: "club.visibility",
  visibilityHint: "club.visibilityHint",
  joinPolicy: "club.joinPolicy",
  attribution: "club.attribution",
  attributionHint: "club.attributionHint",
  whoCanPost: "club.whoCanPost",
  moderation: "club.moderation",
  planTier: "club.planTier",
  planTierHint: "club.planTierHint",
  tierNone: "adminClubs.accessPreviewNoTier",
} as const;

/** Pięć pól wersji roboczej, które składają zdanie podglądu. */
export function clubAccessSentenceInput(draft: ClubAccessDraftValues): AccessSentenceInput {
  return {
    visibility: draft.visibility,
    joinPolicy: draft.joinPolicy,
    attributionMode: draft.attributionMode,
    whoCanPost: draft.whoCanPost,
    minTierRank: draft.minTierRank,
  };
}

/** Słownik `wartość -> tłumaczenie` dla jednego wymiaru dostępu. */
function labelDict<T extends string>(
  prefix: string,
  keys: readonly T[],
  translate: (key: string) => string,
): Record<T, string> {
  const out = {} as Record<T, string>;
  for (const key of keys) out[key] = translate(`${prefix}.${key}`);
  return out;
}

/**
 * Fragmenty zdania podglądu. `translate` jest wstrzykiwane, żeby moduł nie
 * dotykał i18next - w teście wystarczy funkcja zwracająca własny klucz.
 *
 * Oba zdania o planie (`tierRequired` i `tierNone`) są tłumaczone ZAWSZE, bo
 * wyborem między nimi rządzi `buildAccessSentences`, nie ta funkcja.
 */
export function clubAccessSentenceLabels(
  minTierRank: number,
  translate: (key: string) => string,
): AccessSentenceLabels {
  return {
    visibility: labelDict(CLUB_ACCESS_I18N.visibilityHint, CLUB_VISIBILITIES, translate),
    joinPolicy: labelDict(CLUB_ACCESS_I18N.joinPolicy, CLUB_JOIN_POLICIES, translate),
    attribution: labelDict(CLUB_ACCESS_I18N.attributionHint, CLUB_ATTRIBUTION_MODES, translate),
    whoCanPost: labelDict(CLUB_ACCESS_I18N.whoCanPost, CLUB_POST_POLICIES, translate),
    tierRequired: translate(`${CLUB_ACCESS_I18N.planTierHint}.${planTierFromRank(minTierRank)}`),
    tierNone: translate(CLUB_ACCESS_I18N.tierNone),
  };
}

/**
 * Łatka progu planu albo `null`, gdy wybór NIE zmienia rangi.
 *
 * `null` nie jest tu ostrożnością na zapas: przy randze spoza słownika (np. 35
 * z ręcznego grantu) droplista pokazuje próg niższy (`corporate` = 30), więc
 * ponowny wybór widocznej pozycji JEST realną zmianą (35 -> 30) i musi się
 * zapisać, a wybór pozycji odpowiadającej dokładnie zapisanej randze zmianą
 * nie jest i zapisywać się nie może.
 */
export function clubMinTierPatch(
  tier: ClubPlanTier,
  currentRank: number,
): Partial<ClubAccessDraftValues> | null {
  const nextRank = rankFromPlanTier(tier);
  return nextRank === currentRank ? null : { minTierRank: nextRank };
}
