// Skrzynka zgłoszeń klubowych - REGUŁY wyprowadzone z ciała organizmu.
//
// TA ŚCIEŻKA JUŻ RAZ ZAWIODŁA NA PRODUKCJI (`source_type='club_application'`
// złamał CHECK na `crm_leads`, stąd bramka `check:pg-harness`), więc jej reguły
// nie mogą mieszkać w JSX-ie, gdzie da się je sprawdzić wyłącznie oczami.
// `ClubApplicationsInbox.tsx` trzymał w sobie sześć takich reguł:
//
//   1. NAZWANIE ODMOWY `duplicate_open`. Cofnięcie decyzji przy drugim OTWARTYM
//      zgłoszeniu tej samej osoby kończy się w bazie naruszeniem indeksu
//      częściowego. Operator, który widzi wyłącznie „nie udało się zapisać
//      statusu", nie ma pojęcia, że przeszkodą jest inne zgłoszenie - i klika
//      trzeci raz. To jest różnica między błędem do zrozumienia a awarią.
//   2. WIDOCZNY STAN SYNCHRONIZACJI Z CRM. Cicha porażka jest najgorszym
//      wynikiem: redakcja widzi zgłoszenie w panelu i zakłada, że kartoteka
//      w CRM istnieje. Deskryptor niesie ton, datę PRÓBY (nie tylko sukcesu)
//      i to, czy ponowienie ma sens.
//   3. FILTRY JADĄ DO RPC JAKO `null`, NIE JAKO `""`. Pusty napis w argumencie
//      `p_status` to filtr po statusie „" - czyli pusta skrzynka wyglądająca
//      jak brak zgłoszeń.
//   4. ZAWĘŻENIE STATUSU ZE SELECTA. Wartość z pola wyboru jest `string`;
//      wcześniej szła do RPC rzutowaniem `as ClubApplicationStatus`. Rzutowanie
//      przemilcza wartość spoza słownika, zawężenie ją odcina.
//   5. DWA JĘZYKI NAZW. Klub i specjalizacja mają nazwę PL i EN; przy braku
//      jednej lepsza jest nazwa „obca" niż puste miejsce w wierszu.
//   6. KTÓRE POLA KARTOTEKI I W JAKIEJ KOLEJNOŚCI, z pominięciem pustych.
//      Pole opcjonalne, którego kandydat nie wypełnił, nie może pokazać się
//      jako gołe `undefined` ani jako pusta etykieta.
//
// GRANICA WARSTW. Zero Reacta, zero i18n, zero klienta Supabase - typy wiersza
// przychodzą przez `import type`. Moduł oddaje KLUCZE i18n i deskryptory
// (ton, rodzaj), nigdy gotowego napisu: formatowanie daty zależy od języka
// operatora, a to wie tylko widok.
import type {
  ClubApplicationAdminRow,
  ClubApplicationCountRow,
  ClubApplicationCrmRetryResult,
  ClubApplicationCrmStatus,
  ClubApplicationStatus,
  ClubApplicationStatusError,
} from "@/lib/clubs/applyApi";
import type { ClubApplicationNotifyResult } from "@/lib/clubs/applicationNotify.functions";

/** Pełny słownik statusów zgłoszenia - kolejność jest kolejnością na ekranie. */
export const APPLICATION_STATUSES: readonly ClubApplicationStatus[] = [
  "pending",
  "review",
  "accepted",
  "rejected",
  "needs_info",
];

/** Klucze cache skrzynki. Unieważnianie idzie po `all` - liczniki i lista razem. */
export const applicationInboxKeys = {
  all: ["admin", "club-applications"] as const,
  list: (spec: string, status: string, search: string) =>
    [...applicationInboxKeys.all, "list", spec, status, search] as const,
  counts: () => [...applicationInboxKeys.all, "counts"] as const,
};

/**
 * Ton znacznika. DESKRYPTOR, nie klasa CSS: kolor jest nośnikiem znaczenia
 * (czerwony = odcięte, bursztynowy = czeka na człowieka), a jego zapis należy
 * do warstwy widoku.
 */
export type InboxTone = "positive" | "negative" | "warning" | "neutral";

export function applicationStatusTone(status: ClubApplicationStatus): InboxTone {
  if (status === "accepted") return "positive";
  if (status === "rejected") return "negative";
  if (status === "review" || status === "needs_info") return "warning";
  return "neutral";
}

/** Statusy do ustawienia z wiersza - bez tego, który wiersz już ma. */
export function applicationStatusActions(
  current: ClubApplicationStatus,
): readonly ClubApplicationStatus[] {
  return APPLICATION_STATUSES.filter((status) => status !== current);
}

/** Wartość z pola wyboru zawężona do słownika; `""` i śmieć znaczą „bez filtra". */
export function narrowApplicationStatus(raw: string): ClubApplicationStatus | null {
  return APPLICATION_STATUSES.find((status) => status === raw) ?? null;
}

/**
 * Filtry listy w postaci, jakiej oczekuje RPC. Pusty napis znaczy BRAK filtra
 * (`null`), a nie filtr po pustej wartości.
 */
export function applicationListFilters(
  spec: string,
  status: string,
  search: string,
): {
  specialization: string | null;
  status: ClubApplicationStatus | null;
  search: string | null;
} {
  return {
    specialization: spec === "" ? null : spec,
    status: narrowApplicationStatus(status),
    search: search === "" ? null : search,
  };
}

/** Klucz i18n odmowy zapisu statusu - `duplicate_open` MUSI być nazwany. */
export function applicationStatusErrorKey(code: ClubApplicationStatusError): string {
  return code === "duplicate_open"
    ? "adminClubs.applications.statusErrors.duplicate_open"
    : "adminClubs.applications.statusError";
}

/** Komunikat po zapisie statusu: klucz i18n + ton toastu. */
export interface InboxToast {
  readonly tone: "success" | "error";
  readonly key: string;
}

/**
 * Wynik wysyłki powiadomienia. Nieudana wysyłka NIE cofa decyzji - status jest
 * zapisany, więc mówimy o niej osobnym toastem, a nie odmową zapisu.
 * `duplicate` to poczta już wysłana wcześniej: to sukces, nie awaria.
 */
export function applicationMailToast(result: ClubApplicationNotifyResult): InboxToast {
  if (!result.ok) return { tone: "error", key: "adminClubs.applications.mail.failed" };
  return {
    tone: "success",
    key:
      result.skipped === "duplicate"
        ? "adminClubs.applications.mail.duplicate"
        : "adminClubs.applications.mail.queued",
  };
}

/** Wynik ponowienia synchronizacji CRM - `ok` albo dalej awaria. */
export function crmRetryToast(result: ClubApplicationCrmRetryResult): InboxToast {
  return result.crm_sync_status === "ok"
    ? { tone: "success", key: "adminClubs.applications.crm.retryOk" }
    : { tone: "error", key: "adminClubs.applications.crm.retryFailed" };
}

export function crmTone(state: ClubApplicationCrmStatus): InboxTone {
  if (state === "ok") return "positive";
  if (state === "error") return "negative";
  return "neutral";
}

/**
 * Widok stanu CRM dla jednego zgłoszenia.
 *
 * `detailKey` + `detailIso` zamiast gotowego zdania: datę formatuje widok
 * w locale operatora. `never` NIE nosi daty - „ostatnia próba: -" wyglądałoby
 * jak próba, której nie było, a to dwa różne stany kartoteki.
 */
export interface CrmChipView {
  readonly state: ClubApplicationCrmStatus;
  readonly tone: InboxTone;
  readonly detailKey: string;
  readonly detailIso: string | null;
  /** Ponowienie ma sens wszędzie poza stanem `ok`. */
  readonly canRetry: boolean;
}

export function crmChipView(row: ClubApplicationAdminRow): CrmChipView {
  const state = row.crm_sync_status;
  if (state === "ok") {
    return {
      state,
      tone: crmTone(state),
      detailKey: "adminClubs.applications.crm.syncedAt",
      detailIso: row.crm_synced_at,
      canRetry: false,
    };
  }
  if (row.crm_last_attempt_at === null) {
    return {
      state,
      tone: crmTone(state),
      detailKey: "adminClubs.applications.crm.never",
      detailIso: null,
      canRetry: true,
    };
  }
  return {
    state,
    tone: crmTone(state),
    detailKey: "adminClubs.applications.crm.lastAttempt",
    detailIso: row.crm_last_attempt_at,
    canRetry: true,
  };
}

/**
 * Stan poczty przy zgłoszeniu. Trzy rozłączne przypadki: nieudana wysyłka
 * (widoczny ślad do ponowienia), brak wysyłki i wysyłka z datą oraz statusem,
 * którego dotyczyła - status w mailu mógł być inny niż dzisiejszy status
 * zgłoszenia i to jest właśnie ta informacja, po którą operator tu patrzy.
 */
export type ApplicationMailState =
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "none" }
  | { readonly kind: "sent"; readonly status: ClubApplicationStatus; readonly iso: string };

export function applicationMailState(row: ClubApplicationAdminRow): ApplicationMailState {
  if (row.notify_error !== null) return { kind: "error", message: row.notify_error };
  if (row.notified_status === null || row.notified_at === null) return { kind: "none" };
  return { kind: "sent", status: row.notified_status, iso: row.notified_at };
}

/**
 * Nazwa klubu w języku operatora, z zejściem na drugi język. Klub może mieć
 * wypełnione tylko jedno pole, a wtedy nazwa „obca" jest lepsza niż puste
 * miejsce. `null` znaczy: zgłoszenie bez klubu (sama specjalizacja).
 */
export function applicationClubName(
  row: Pick<ClubApplicationAdminRow, "club_name_pl" | "club_name_en">,
  lang: "pl" | "en",
): string | null {
  const name = lang === "en" ? row.club_name_en || row.club_name_pl : row.club_name_pl || row.club_name_en;
  return name === null || name === "" ? null : name;
}

/** Nazwa dwujęzycznego wpisu katalogu (specjalizacja) w języku operatora. */
export function bilingualLabel(
  row: { readonly label_pl: string; readonly label_en: string },
  lang: "pl" | "en",
): string {
  return lang === "en" ? row.label_en || row.label_pl : row.label_pl || row.label_en;
}

/** Pola kartoteki kandydata pokazywane po rozwinięciu wiersza. */
export type ApplicationDetailField =
  | "phone"
  | "country"
  | "city"
  | "seniority"
  | "industry"
  | "years_experience"
  | "linkedin_url"
  | "languages"
  | "availability"
  | "referral_source"
  | "expertise"
  | "motivation"
  | "goals"
  | "contribution";

/**
 * Kolejność i etykiety kartoteki. `wide` to pola opisowe (doświadczenie,
 * motywacja, cele, wkład) - one dostają całą szerokość, bo to zdania, a nie
 * wartości. Kolejność jest kolejnością czytania przez komisję.
 */
export const APPLICATION_DETAIL_FIELDS: readonly {
  readonly field: ApplicationDetailField;
  readonly labelKey: string;
  readonly wide: boolean;
}[] = [
  { field: "phone", labelKey: "club.spec.apply.phone", wide: false },
  { field: "country", labelKey: "club.spec.apply.country", wide: false },
  { field: "city", labelKey: "club.spec.apply.city", wide: false },
  { field: "seniority", labelKey: "club.spec.apply.seniority", wide: false },
  { field: "industry", labelKey: "club.spec.apply.industry", wide: false },
  { field: "years_experience", labelKey: "club.spec.apply.years", wide: false },
  { field: "linkedin_url", labelKey: "club.spec.apply.linkedin", wide: false },
  { field: "languages", labelKey: "club.spec.apply.languages", wide: false },
  { field: "availability", labelKey: "club.spec.apply.availability", wide: false },
  { field: "referral_source", labelKey: "club.spec.apply.referral", wide: false },
  { field: "expertise", labelKey: "club.spec.apply.expertise", wide: true },
  { field: "motivation", labelKey: "club.spec.apply.motivation", wide: true },
  { field: "goals", labelKey: "club.spec.apply.goals", wide: true },
  { field: "contribution", labelKey: "club.spec.apply.contribution", wide: true },
];

/**
 * Wartość pola kartoteki jako napis albo `null` = „nie pokazuj".
 *
 * `null` i `""` znaczą to samo (kandydat nie podał), ale `0` znaczy zero -
 * dlatego porównanie jest z `""`, a nie sprawdzenie prawdziwości. Kandydat
 * z zerem lat doświadczenia go podał.
 */
export function applicationDetailValue(
  row: ClubApplicationAdminRow,
  field: ApplicationDetailField,
): string | null {
  const raw: string | number | null = row[field];
  return raw === null || raw === "" ? null : String(raw);
}

/** Zakładka skrzynki: specjalizacja (albo „wszystkie") z licznikiem zaległości. */
export interface InboxTab {
  readonly slug: string;
  readonly label: string;
  readonly pending: number;
}

/** Ile zgłoszeń czeka na decyzję w danej specjalizacji. */
export function pendingBySpec(
  counts: readonly ClubApplicationCountRow[] | undefined,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const row of counts ?? []) map.set(row.specialization_slug, row.pending);
  return map;
}

/** Zaległość łączna - licznik zakładki „wszystkie". */
export function totalPending(counts: readonly ClubApplicationCountRow[] | undefined): number {
  return (counts ?? []).reduce((acc, row) => acc + row.pending, 0);
}

/**
 * Zakładki skrzynki. Pierwsza jest zawsze „wszystkie" (`slug: ""`), bo brak
 * filtra to osobny, najczęstszy widok - a nie brak wyboru. Specjalizacja bez
 * wpisu w licznikach ma zero, nie `undefined`: licznik `undefined` renderowałby
 * się jako puste miejsce i wyglądał jak brak danych.
 */
export function applicationSpecTabs(input: {
  readonly specs: readonly { slug: string; label_pl: string; label_en: string }[] | undefined;
  readonly counts: readonly ClubApplicationCountRow[] | undefined;
  readonly lang: "pl" | "en";
  readonly allLabel: string;
}): readonly InboxTab[] {
  const pending = pendingBySpec(input.counts);
  return [
    { slug: "", label: input.allLabel, pending: totalPending(input.counts) },
    ...(input.specs ?? []).map((row) => ({
      slug: row.slug,
      label: bilingualLabel(row, input.lang),
      pending: pending.get(row.slug) ?? 0,
    })),
  ];
}
