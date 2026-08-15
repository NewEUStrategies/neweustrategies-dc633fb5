// Warstwa rekrutacyjna kontaktu - jedno źródło prawdy dla panelu admina.
//
// Zgłoszenie z /zatrudniamy trafia do `contact_messages` (form_id = "careers",
// pola rekrutacyjne w kolumnie `custom`), a `crm_upsert_from_form` dokleja te
// same wartości do `crm_leads.aliases.custom.<pole>` jako historię append-only.
// Dwie powierzchnie czytają ten sam kształt - skrzynka /admin/careers i moduł
// „Rekrutacja" na karcie kontaktu /admin/crm/$id - więc parsowanie mieszka tutaj,
// w czystym module (bez Reacta, bez zapytań), z testem jednostkowym.
//
// GRANICA POWIERZCHNI (bramka budżetu, wpis 2026-08-15). Ten moduł ma
// WYŁĄCZNIE adminowych importerów: trasę /admin/careers i panel „Rekrutacja"
// karty CRM (import w `admin.crm.$id.tsx` jest wyłącznie typem, więc znika
// w kompilacji). Część wspólną z publicznym formularzem - identyfikator
// formularza, walidację ścieżki CV, normalizację linku i słowniki
// działu/poziomu/startu - mieszka w `recruitmentShared.ts`; stąd jest
// re-eksportowana, żeby adminowe importy i testy widziały jeden spójny moduł.
// Dopisanie tu czegokolwiek, co czyta kod publiczny, wciąga całe parsowanie
// skrzynki do chunku rozliczanego do PUBLIC - patrz kronika bramki.
//
// Etykiety są tu, a nie w i18n, bo panel admina używa wbudowanych słowników
// PL/EN (ten sam wzorzec, co `admin.careers.tsx` i `admin.crm.$id.tsx`) -
// kandydat wybiera slug ("mid", "immediately"), a operator musi widzieć tekst.

import {
  CAREERS_FORM_ID,
  isCareerCvPath,
  labelFromPair,
  normalizeCvUrl,
  type CareerAdminLang,
} from "./recruitmentShared";

export {
  CAREERS_FORM_ID,
  departmentLabel,
  fallbackApplicationMessage,
  isCareerCvPath,
  normalizeCvUrl,
  seniorityLabel,
  startLabel,
  type CareerAdminLang,
} from "./recruitmentShared";

/** Etapy procesu rekrutacyjnego - 1:1 z enumem `public.career_stage`. */
export const CAREER_STAGES = [
  "new",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
] as const;

export type CareerStage = (typeof CAREER_STAGES)[number];

/** Etapy domknięte - dopiero po nich biegnie okres retencji pliku CV. */
export const CAREER_CLOSED_STAGES: readonly CareerStage[] = ["hired", "rejected", "withdrawn"];

export function isCareerStage(value: unknown): value is CareerStage {
  return typeof value === "string" && (CAREER_STAGES as readonly string[]).includes(value);
}

const STAGE_LABELS: Record<CareerStage, [string, string]> = {
  new: ["Nowe", "New"],
  screening: ["Wstępna selekcja", "Screening"],
  interview: ["Rozmowa", "Interview"],
  offer: ["Oferta", "Offer"],
  hired: ["Zatrudniony", "Hired"],
  rejected: ["Odrzucony", "Rejected"],
  withdrawn: ["Wycofane", "Withdrawn"],
};

/** Kolor etapu w panelu - te same tokeny, co etapy leada na karcie CRM. */
export const CAREER_STAGE_STYLE: Record<CareerStage, string> = {
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  screening: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  interview: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  offer: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  hired: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  withdrawn: "bg-muted text-muted-foreground",
};

const ENGAGEMENT_LABELS: Record<string, [string, string]> = {
  full_time: ["Pełny etat", "Full time"],
  part_time: ["Część etatu", "Part time"],
  contract: ["Kontrakt / B2B", "Contract"],
  internship: ["Staż", "Internship"],
};

const LOCATION_LABELS: Record<string, [string, string]> = {
  remote: ["Zdalnie", "Remote"],
  hybrid: ["Hybrydowo", "Hybrid"],
  warsaw: ["Warszawa", "Warsaw"],
  brussels: ["Bruksela", "Brussels"],
};

export const engagementLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  labelFromPair(ENGAGEMENT_LABELS, slug, lang);
export const locationLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  labelFromPair(LOCATION_LABELS, slug, lang);
export const stageLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  labelFromPair(STAGE_LABELS, slug, lang);

/** Wiersz `contact_messages` w minimalnym zakresie potrzebnym warstwie. */
export interface RecruitmentMessageRow {
  id: string;
  form_id?: string | null;
  subject?: string | null;
  message?: string | null;
  lang?: string | null;
  created_at: string;
  custom?: unknown;
  /**
   * Warstwa procesu z `career_applications` (dołączana relacją w zapytaniu).
   * Opcjonalna: karta kontaktu CRM czyta zgłoszenia bez joina, a wtedy pipeline
   * po prostu nie jest pokazywany, zamiast wywracać parsowanie.
   */
  career_applications?: RecruitmentPipelineRow | RecruitmentPipelineRow[] | null;
}

/** Wiersz `career_applications` w zakresie potrzebnym warstwie. */
export interface RecruitmentPipelineRow {
  id?: string;
  stage?: string | null;
  stage_changed_at?: string | null;
  stage_note?: string | null;
  rating?: number | null;
  rejection_reason?: string | null;
  next_step_at?: string | null;
  owner_id?: string | null;
}

/** Warstwa procesu jednego zgłoszenia. */
export interface RecruitmentPipeline {
  id: string;
  stage: CareerStage;
  stageChangedAt: string | null;
  stageNote: string;
  rating: number | null;
  rejectionReason: string;
  nextStepAt: string | null;
  ownerId: string | null;
  /** Czy proces jest domknięty - od tego momentu liczy się retencja CV. */
  closed: boolean;
}

/** Jedno zgłoszenie kandydata, gotowe do wyświetlenia. */
export interface RecruitmentApplication {
  /** `contact_messages.id` - klucz zgłoszenia w skrzynce /admin/careers. */
  id: string;
  createdAt: string;
  lang: string;
  /** Slug oferty (`career_roles.slug`) albo "open" dla zgłoszenia spontanicznego. */
  role: string;
  /** Tytuł oferty w języku, w którym aplikował kandydat. */
  roleLabel: string;
  department: string;
  seniority: string;
  start: string;
  linkedin: string;
  /** Ścieżka w buckecie `career-cv` - pusta, gdy nie przeszła walidacji kształtu. */
  cvPath: string;
  cvFileName: string;
  /** Znormalizowany link zewnętrzny (ze schematem) albo pusty. */
  cvUrl: string;
  /**
   * Data usunięcia pliku CV przez retencję (`custom.cv_purged_at`). Panel musi
   * odróżnić „kandydat nie dał CV" od „CV skasowaliśmy zgodnie z polityką" -
   * bez tego operator widziałby „Brak CV" i szukałby błędu.
   */
  cvPurgedAt: string;
  message: string;
  /** Etap procesu - `null`, gdy zapytanie nie dołączyło `career_applications`. */
  pipeline: RecruitmentPipeline | null;
}

/** Zebrana warstwa rekrutacyjna kontaktu. */
export interface RecruitmentLayer {
  /** Czy kontakt ma jakikolwiek ślad rekrutacyjny (zgłoszenie albo aliasy). */
  hasHistory: boolean;
  applicationCount: number;
  firstAppliedAt: string | null;
  lastAppliedAt: string | null;
  /** Zgłoszenia od najnowszego. */
  applications: RecruitmentApplication[];
  /** Historia z `aliases.custom` - także zgłoszenia sprzed retencji skrzynki. */
  roleLabels: string[];
  departments: string[];
  seniorities: string[];
  linkedins: string[];
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `custom` jest jsonb - do warstwy wpuszczamy wyłącznie wartości tekstowe. */
export function asCustomRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return out;
}

/**
 * Wartości pola custom z `crm_leads.aliases` (append-only tablica stringów,
 * patrz `crm_upsert_from_form`). Odporna na każdy inny kształt - aliasy pisze
 * też import CSV i partnerzy CRM.
 */
export function aliasCustomValues(aliases: unknown, field: string): string[] {
  if (typeof aliases !== "object" || aliases === null || Array.isArray(aliases)) return [];
  const custom = (aliases as Record<string, unknown>).custom;
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) return [];
  const bucket = (custom as Record<string, unknown>)[field];
  if (!Array.isArray(bucket)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of bucket) {
    const value = str(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Warstwa procesu z dołączonej relacji. PostgREST zwraca zagnieżdżenie raz jako
 * obiekt, raz jako jednoelementową tablicę (zależnie od tego, jak wykryje
 * kardynalność relacji), więc znosimy oba kształty.
 */
export function parseRecruitmentPipeline(
  raw: RecruitmentMessageRow["career_applications"],
): RecruitmentPipeline | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const stage = isCareerStage(row.stage) ? row.stage : "new";
  return {
    id: str(row.id),
    stage,
    stageChangedAt: str(row.stage_changed_at) || null,
    stageNote: str(row.stage_note),
    rating: typeof row.rating === "number" ? row.rating : null,
    rejectionReason: str(row.rejection_reason),
    nextStepAt: str(row.next_step_at) || null,
    ownerId: str(row.owner_id) || null,
    closed: CAREER_CLOSED_STAGES.includes(stage),
  };
}

/** Zgłoszenia rekrutacyjne z listy wiadomości kontaktu (najnowsze pierwsze). */
export function parseRecruitmentApplications(
  rows: readonly RecruitmentMessageRow[] | null | undefined,
): RecruitmentApplication[] {
  return (rows ?? [])
    .filter((row) => (row.form_id ?? "") === CAREERS_FORM_ID)
    .map((row) => {
      const custom = asCustomRecord(row.custom);
      const cvPath = str(custom.cv_path);
      return {
        id: row.id,
        createdAt: row.created_at,
        lang: str(row.lang) || "pl",
        role: str(custom.role) || "open",
        roleLabel: str(custom.role_label),
        department: str(custom.department),
        seniority: str(custom.seniority),
        start: str(custom.start),
        linkedin: str(custom.linkedin),
        cvPath: isCareerCvPath(cvPath) ? cvPath : "",
        cvFileName: str(custom.cv_file_name),
        cvUrl: normalizeCvUrl(custom.cv_url) ?? "",
        cvPurgedAt: str(custom.cv_purged_at),
        message: str(row.message),
        pipeline: parseRecruitmentPipeline(row.career_applications),
      } satisfies RecruitmentApplication;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Warstwa rekrutacyjna kontaktu: zgłoszenia z `contact_messages` wzbogacone
 * historią z `crm_leads.aliases.custom`.
 *
 * Liczniki i daty liczymy ze zgłoszeń (to one mają czas), a aliasy dają
 * pokrycie także wtedy, gdy wiadomość została skasowana, a lead został.
 */
export function buildRecruitmentLayer(input: {
  aliases?: unknown;
  messages?: readonly RecruitmentMessageRow[] | null;
}): RecruitmentLayer {
  const applications = parseRecruitmentApplications(input.messages);
  const roleLabels = aliasCustomValues(input.aliases, "role_label");
  const departments = aliasCustomValues(input.aliases, "department");
  const seniorities = aliasCustomValues(input.aliases, "seniority");
  const linkedins = aliasCustomValues(input.aliases, "linkedin");
  const stamps = applications.map((a) => Date.parse(a.createdAt)).filter((n) => Number.isFinite(n));

  return {
    hasHistory:
      applications.length > 0 ||
      roleLabels.length > 0 ||
      departments.length > 0 ||
      seniorities.length > 0,
    applicationCount: applications.length,
    firstAppliedAt: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
    lastAppliedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    applications,
    roleLabels,
    departments,
    seniorities,
    linkedins,
  };
}
