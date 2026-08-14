// Warstwa rekrutacyjna kontaktu - jedno źródło prawdy dla panelu admina.
//
// Zgłoszenie z /zatrudniamy trafia do `contact_messages` (form_id = "careers",
// pola rekrutacyjne w kolumnie `custom`), a `crm_upsert_from_form` dokleja te
// same wartości do `crm_leads.aliases.custom.<pole>` jako historię append-only.
// Dwie powierzchnie czytają ten sam kształt - skrzynka /admin/careers i moduł
// „Rekrutacja" na karcie kontaktu /admin/crm/$id - więc parsowanie mieszka tutaj,
// w czystym module (bez Reacta, bez zapytań), z testem jednostkowym.
//
// Etykiety są tu, a nie w i18n, bo panel admina używa wbudowanych słowników
// PL/EN (ten sam wzorzec, co `admin.careers.tsx` i `admin.crm.$id.tsx`) -
// kandydat wybiera slug ("mid", "immediately"), a operator musi widzieć tekst.

export type CareerAdminLang = "pl" | "en";

/** `contact_messages.form_id` zgłoszeń rekrutacyjnych (ustawia CareersApplyForm). */
export const CAREERS_FORM_ID = "careers";

/**
 * Ścieżka CV w prywatnym buckecie `career-cv`, dokładnie taka, jaką generuje
 * `uploadCv`.
 *
 * DWA KSZTAŁTY, oba dozwolone:
 *   * `<tenant_id>/uploads/<YYYY-MM-DD>/<uuid>.<ext>` - konwencja obowiązująca,
 *     w której ścieżka niesie tenanta, więc polityka bucketu potrafi zawęzić
 *     odczyt do personelu TEGO najemcy;
 *   * `uploads/<YYYY-MM-DD>/<uuid>.<ext>` - pliki sprzed zmiany konwencji.
 *     Nie przenosimy ich (UPDATE `storage.objects.name` rozjechałby wiersz
 *     z plikiem w magazynie), więc muszą dalej przechodzić walidację - prawo do
 *     nich pilnuje polityka, sprawdzając referencję ze zgłoszenia najemcy.
 *
 * BEZPIECZEŃSTWO: `custom.cv_path` przychodzi z publicznego formularza, a panel
 * admina podpisuje ją bez pytania (`signCvUrl`). Bez tej bramki wystarczyłoby
 * podmienić pole w żądaniu, żeby wymusić podpisany link do DOWOLNEGO obiektu
 * w buckecie - czyli do CV innego kandydata.
 */
const CV_PATH_RE =
  /^(?:[0-9a-fA-F-]{36}\/)?uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-fA-F-]{8,64}\.(?:pdf|doc|docx)$/;

export function isCareerCvPath(value: string | null | undefined): boolean {
  return typeof value === "string" && CV_PATH_RE.test(value);
}

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

/**
 * Link do CV podany ręcznie. Formularz przyjmuje adres bez schematu
 * ("linkedin.com/in/x" przechodzi walidację), a `<a href>` bez schematu jest
 * URL-em RELATYWNYM - w panelu admina prowadziłby do /admin/linkedin.com/...
 * Zwraca `null`, gdy wartość nie wygląda na adres http(s).
 */
export function normalizeCvUrl(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const DEPARTMENT_LABELS: Record<string, [string, string]> = {
  analysis: ["Analizy", "Research"],
  policy: ["Polityka publiczna", "Public policy"],
  marketing: ["Marketing", "Marketing"],
  advisory: ["Doradztwo", "Advisory"],
  editorial: ["Redakcja", "Editorial"],
  operations: ["Operacje", "Operations"],
};

const SENIORITY_LABELS: Record<string, [string, string]> = {
  junior: ["Junior", "Junior"],
  mid: ["Specjalista", "Mid-level"],
  senior: ["Senior", "Senior"],
  lead: ["Lead / kierownik", "Lead"],
};

const START_LABELS: Record<string, [string, string]> = {
  immediately: ["Od zaraz", "Immediately"],
  month: ["W ciągu miesiąca", "Within a month"],
  quarter: ["W ciągu kwartału", "Within a quarter"],
  later: ["Później / do ustalenia", "Later / to agree"],
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

function label(
  dict: Record<string, [string, string]>,
  slug: string | null | undefined,
  lang: CareerAdminLang,
): string {
  const key = (slug ?? "").trim();
  if (!key) return "";
  const pair = dict[key];
  // Nieznany slug pokazujemy surowo - lepiej zobaczyć "kontrakt_zlecenie" niż
  // puste pole, gdy ktoś doda wartość w bazie bez aktualizacji słownika.
  if (!pair) return key;
  return lang === "en" ? pair[1] : pair[0];
}

export const departmentLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  label(DEPARTMENT_LABELS, slug, lang);
export const seniorityLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  label(SENIORITY_LABELS, slug, lang);
export const startLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  label(START_LABELS, slug, lang);
export const engagementLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  label(ENGAGEMENT_LABELS, slug, lang);
export const locationLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  label(LOCATION_LABELS, slug, lang);
export const stageLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  label(STAGE_LABELS, slug, lang);

/**
 * Treść wiadomości dla zgłoszenia bez „Dlaczego Ty".
 *
 * Pole „Dlaczego Ty" jest w formularzu NIEOBOWIĄZKOWE (rolę uzasadnienia
 * przejęło CV), ale `contact_messages.message` jest wymagane w trzech
 * niezależnych miejscach po drodze: `ContactInput` (zod, `.min(1)`),
 * `form_field_policies` tenanta (`contact_form.message` z `required = true`,
 * seed 20260706195647) i `NOT NULL` w tabeli. Puste pole kończyło się więc
 * wyjątkiem server-fn i gołym tostem „nie udało się wysłać" - zgłoszenie nie
 * zapisywało się w ogóle. Zamiast rozszczelniać kontrakt formularza kontaktowego
 * wysyłamy streszczenie dopasowania: operator w skrzynce widzi rolę, dział,
 * poziom i termin startu, a nie pusty prostokąt.
 */
export function fallbackApplicationMessage(input: {
  lang: CareerAdminLang;
  roleLabel: string;
  department: string;
  seniority: string;
  start: string;
}): string {
  const pl = input.lang !== "en";
  const rows: Array<[string, string]> = [
    [pl ? "Rola" : "Role", input.roleLabel.trim()],
    [pl ? "Dział" : "Department", departmentLabel(input.department, input.lang)],
    [pl ? "Poziom" : "Seniority", seniorityLabel(input.seniority, input.lang)],
    [pl ? "Dostępność" : "Availability", startLabel(input.start, input.lang)],
  ];
  const head = pl
    ? "Zgłoszenie rekrutacyjne bez dodatkowego uzasadnienia - dane z kreatora:"
    : "Application submitted without a cover note - details from the form:";
  const body = rows
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return body ? `${head}\n${body}` : head;
}

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
