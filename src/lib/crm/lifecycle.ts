// CYKL ŻYCIA KONTAKTU CRM - lustro migracji 20261020090200 (SPEC AD-11, D-01).
//
// DWIE OSIE, NIE JEDNA. `crm_stage` (`new…archived`) zostaje etapem
// SPRZEDAŻOWYM z kontraktem kolejności `LEAD_STAGE_ORDER`. `lifecycle_stage`
// to oś MARKETINGOWA (subskrybent → lead → … → klient), czytana przez lejek
// huba i warunki ścieżek. Dopisanie etapów marketingowych do `crm_stage`
// złamałoby kolejność, na której stoją dziś widoki i raporty CRM.
//
// KOLEJNOŚĆ `LIFECYCLE_STAGES` JEST KONTRAKTEM: to porządek lejka (kolumny
// mapy etapów, „dalej/wcześniej" w warunkach ścieżek) i dokładnie kolejność
// listy w CHECK - `lifecycleParity.test.ts` porównuje ją element po elemencie.
//
// Moduł nie importuje `leadListSpec.ts`: tamten ciągnie zod, a te stałe czytają
// też liście bez zależności (diagnostyka, mapa szyny).

export const LIFECYCLE_STAGES = [
  "subscriber",
  "lead",
  "registered",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "former_customer",
  "other",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Etap nowego kontaktu (`DEFAULT` kolumny). */
export const LIFECYCLE_STAGE_DEFAULT: LifecycleStage = "subscriber";

/**
 * Etapy, które ustawia WYŁĄCZNIE billing: o tym, czy ktoś jest klientem,
 * rozstrzyga płatność, nie ścieżka ani przepis (akcja `set_lifecycle_stage`
 * w edytorze ich nie oferuje).
 */
export const BILLING_OWNED_LIFECYCLE_STAGES = [
  "customer",
  "former_customer",
] as const satisfies readonly LifecycleStage[];

/** Kto zmienia etap cyklu życia - źródła z pierwszeństwem. */
export const LIFECYCLE_WRITERS = ["billing", "manual", "journey", "workflow", "system"] as const;
export type LifecycleWriter = (typeof LIFECYCLE_WRITERS)[number];

/**
 * Pierwszeństwo pisarzy: `billing > manual > journey = workflow > system`.
 *
 * PO CO. Billing ustawia `customer` po płatności, a godzinę później ścieżka
 * powitalna wykonuje krok „ustaw etap: lead". Bez pierwszeństwa kontakt
 * płacący wraca do leada i dostaje maile sprzedażowe. Ręczna zmiana handlowca
 * wygrywa z automatami, ale nie z płatnością; ścieżka i przepis są równe
 * (ostatni wygrywa), bo oba to automaty skonfigurowane przez ten sam zespół.
 */
export const LIFECYCLE_WRITER_PRECEDENCE: Readonly<Record<LifecycleWriter, number>> = {
  billing: 3,
  manual: 2,
  journey: 1,
  workflow: 1,
  system: 0,
};

/**
 * Czy `writer` może nadpisać etap ustawiony ostatnio przez `lastWriter`.
 * Brak poprzedniego pisarza (`null`) - etap domyślny - nadpisuje każdy.
 * Równe pierwszeństwo nadpisuje (ten sam pisarz poprawia sam siebie).
 */
export function canLifecycleWriterOverride(
  writer: LifecycleWriter,
  lastWriter: LifecycleWriter | null,
): boolean {
  if (lastWriter === null) return true;
  return LIFECYCLE_WRITER_PRECEDENCE[writer] >= LIFECYCLE_WRITER_PRECEDENCE[lastWriter];
}

/** Czy `writer` w ogóle może ustawić `stage` (etapy klienta należą do billingu). */
export function canLifecycleWriterSetStage(
  writer: LifecycleWriter,
  stage: LifecycleStage,
): boolean {
  return (
    writer === "billing" || !(BILLING_OWNED_LIFECYCLE_STAGES as readonly string[]).includes(stage)
  );
}

/** Oś zmiany w historii etapów (`crm_lead_stage_history.dimension`). */
export const STAGE_HISTORY_DIMENSIONS = ["crm_stage", "lifecycle"] as const;
export type StageHistoryDimension = (typeof STAGE_HISTORY_DIMENSIONS)[number];

/**
 * Źródło wpisu historii etapów. Szersze niż pisarze cyklu życia: `bulk`
 * i `import` to operacje panelu CRM, a `backfill` oznacza wpisy odtworzone
 * z dziennika audytu przy wdrożeniu - raport nie może ich liczyć jako zmian
 * z dnia wdrożenia.
 */
export const STAGE_HISTORY_SOURCES = [
  "manual",
  "bulk",
  "billing",
  "journey",
  "workflow",
  "import",
  "system",
  "backfill",
] as const;
export type StageHistorySource = (typeof STAGE_HISTORY_SOURCES)[number];

/** Źródło zadania CRM (`crm_tasks.source`) - kto je utworzył. */
export const CRM_TASK_SOURCES = ["manual", "workflow", "journey", "billing", "system"] as const;
export type CrmTaskSource = (typeof CRM_TASK_SOURCES)[number];

/** Źródło zadania tworzonego w panelu (`DEFAULT` kolumny). */
export const CRM_TASK_SOURCE_DEFAULT: CrmTaskSource = "manual";

/**
 * `crm_tasks.origin_ref` - klucz idempotencji zadania z automatu
 * (np. `journey:<zapis>:<węzeł>`); unikalny w najemcy, więc powtórka kroku
 * nie tworzy drugiego zadania.
 */
export const CRM_TASK_ORIGIN_REF_MAX = 200;
