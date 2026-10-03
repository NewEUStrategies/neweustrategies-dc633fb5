// Publiczne jądro warstwy rekrutacyjnej - wspólne dla formularza /zatrudniamy
// i funkcji serwerowej kontaktu.
//
// GRANICA POWIERZCHNI, NIE WYGODY (bramka budżetu, wpis 2026-08-15). Ten moduł
// istnieje po to, żeby publiczne poddrzewo (/zatrudniamy, widgety formularzy
// kontaktowych przez `contact.functions.ts`) nie ciągnęło za sobą CAŁEGO
// `recruitmentLayer.ts` - etapów procesu, stylów pipeline'u i parsowania
// skrzynki, których używa wyłącznie panel admina. Moduł współdzielony przez
// publiczne i adminowe poddrzewo Rollup hoistuje do wspólnego przodka, a chunk
// bez adminowego prefiksu bramka rozlicza do PUBLIC - dokładnie ta mechanika
// zapaliła wpisy o Stripe (08-06) i i18n-club (08-12).
//
// ZASADA: tu mieszka WYŁĄCZNIE to, czego dotyka kod osiągalny z publicznego
// URL-a. Wszystko, co czyta tylko operator panelu (etapy, style, parsowanie
// `contact_messages`/`career_applications`), mieszka w `recruitmentLayer.ts`,
// który ten moduł re-eksportuje dla adminowych importerów.
//
// Moduł jest czysty (bez Reacta, bez zapytań) - jak cała warstwa danych karier.

export type CareerAdminLang = "pl" | "en";

/** `contact_messages.form_id` zgłoszeń rekrutacyjnych (ustawia CareersApplyForm). */
export const CAREERS_FORM_ID = "careers";

/**
 * Ścieżka CV w prywatnym buckecie `career-cv`, dokładnie taka, jaką generuje
 * `uploadCv`.
 *
 * DWA KSZTAŁTY, oba dozwolone przy ODCZYCIE (panel admina):
 *   * `<tenant_id>/uploads/<YYYY-MM-DD>/<uuid>.<ext>` - konwencja obowiązująca,
 *     w której ścieżka niesie tenanta, więc polityka bucketu potrafi zawęzić
 *     odczyt do personelu TEGO najemcy;
 *   * `uploads/<YYYY-MM-DD>/<uuid>.<ext>` - pliki sprzed zmiany konwencji.
 *     Nie przenosimy ich (UPDATE `storage.objects.name` rozjechałby wiersz
 *     z plikiem w magazynie), więc zastane zgłoszenia nadal je pokazują - prawo
 *     do nich pilnuje polityka (właściciel = najemca najwcześniejszego zgłoszenia).
 *
 * BEZPIECZEŃSTWO: `custom.cv_path` przychodzi z publicznego formularza, a panel
 * admina podpisuje ją bez pytania (`signCvUrl`). Bez tej bramki wystarczyłoby
 * podmienić pole w żądaniu, żeby wymusić podpisany link do DOWOLNEGO obiektu
 * w buckecie - czyli do CV innego kandydata. Sam kształt NIE wystarcza przy
 * ZAPISIE - tam obowiązuje `isCareerCvPathOfTenant`.
 *
 * Pierwszy segment to PEŁNY UUID (grupa 1 = tenant); dawne `[0-9a-fA-F-]{36}`
 * przyjmowało także 36 myślników.
 */
const CV_PATH_RE =
  /^(?:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/)?uploads\/\d{4}-\d{2}-\d{2}\/[0-9a-fA-F-]{8,64}\.(?:pdf|doc|docx)$/;

export function isCareerCvPath(value: string | null | undefined): boolean {
  return typeof value === "string" && CV_PATH_RE.test(value);
}

/**
 * Czy ścieżka wskazuje plik w katalogu DANEGO najemcy - bramka ZAPISU
 * (`submitContact`).
 *
 * Kształt przyjmowany przez `isCareerCvPath` nie mówi nic o właścicielu:
 * zgłoszenie wysłane z hosta najemcy A z `cv_path = '<B>/uploads/...'` miało
 * poprawny kształt, a trafiało do skrzynki A. Formularz zna tenanta hosta,
 * więc ścieżka spoza jego katalogu jest fałszerstwem albo pomyłką - w obu
 * przypadkach nie wolno jej zapisać. Kształt legacy (`uploads/...`, bez
 * tenanta) nie przechodzi: `uploadCv` dokłada tenanta od 2026-08-14, więc
 * NOWE zgłoszenie nie ma prawa go nieść. Tę samą regułę egzekwuje baza
 * (`career_cv_path_guard`, 20261003120000) - także dla zapisu z panelu.
 */
export function isCareerCvPathOfTenant(
  value: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (typeof value !== "string" || typeof tenantId !== "string") return false;
  const tenant = CV_PATH_RE.exec(value)?.[1];
  return tenant !== undefined && tenant.toLowerCase() === tenantId.toLowerCase();
}

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

// Etykiety są tu, a nie w i18n, bo czytają je dwie powierzchnie o różnych
// mechanizmach: publiczny formularz składa z nich treść wiadomości
// (`fallbackApplicationMessage`), a panel admina używa wbudowanych słowników
// PL/EN (ten sam wzorzec, co `admin.careers.tsx` i `admin.crm.$id.tsx`) -
// kandydat wybiera slug ("mid", "immediately"), a operator musi widzieć tekst.

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

/**
 * Wspólny odczyt pary PL/EN. Nieznany slug pokazujemy surowo - lepiej zobaczyć
 * "kontrakt_zlecenie" niż puste pole, gdy ktoś doda wartość w bazie bez
 * aktualizacji słownika.
 */
export function labelFromPair(
  dict: Record<string, [string, string]>,
  slug: string | null | undefined,
  lang: CareerAdminLang,
): string {
  const key = (slug ?? "").trim();
  if (!key) return "";
  const pair = dict[key];
  if (!pair) return key;
  return lang === "en" ? pair[1] : pair[0];
}

export const departmentLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  labelFromPair(DEPARTMENT_LABELS, slug, lang);
export const seniorityLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  labelFromPair(SENIORITY_LABELS, slug, lang);
export const startLabel = (slug: string | null | undefined, lang: CareerAdminLang) =>
  labelFromPair(START_LABELS, slug, lang);

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
