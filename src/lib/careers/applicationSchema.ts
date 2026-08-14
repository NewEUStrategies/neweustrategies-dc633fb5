// Walidacja formularza aplikacyjnego (/zatrudniamy).
//
// Jedno źródło prawdy dla kreatora: te same reguły obsługują walidację kroku,
// walidację całości przed wysyłką i normalizację payloadu, dzięki czemu do
// Contact Center i CRM nie trafia zgłoszenie z brakującym działem, rolą,
// poziomem czy terminem startu. Komunikaty są zwracane jako klucze i18n -
// komponent tłumaczy je w aktywnym języku.
import { z } from "zod";

import { CAREER_DEPARTMENTS, CAREER_SENIORITIES } from "./roles";

export const CAREER_START_OPTIONS = ["immediately", "month", "quarter", "later"] as const;
export type CareerStartOption = (typeof CAREER_START_OPTIONS)[number];

export const MESSAGE_MIN = 40;
export const MESSAGE_MAX = 4000;

/** Twardy limit pliku CV: 5 MB (zgodny z polityką bucketu `career-cv`). */
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_ACCEPTED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export const CV_ACCEPT_ATTR = ".pdf,.doc,.docx";

const E = (key: string) => `careers.form.errors.${key}`;

const NAME_RE = /^[\p{L}][\p{L}\p{M}'’\- .]{1,59}$/u;
const PHONE_RE = /^[+]?[\d\s()\-.]{7,20}$/;
const LINKEDIN_RE = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/** Pola formularza w kolejności kroków kreatora. */
export const CAREER_FORM_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "linkedin",
  "cv",
  "department",
  "role",
  "seniority",
  "start",
  "message",
  "consent",
] as const;

export type CareerFieldName = (typeof CAREER_FORM_FIELDS)[number];

/** Do którego kroku kreatora należy dane pole (0: o Tobie, 1: dopasowanie, 2: wiadomość). */
export const CAREER_FIELD_STEP: Record<CareerFieldName, 0 | 1 | 2> = {
  firstName: 0,
  lastName: 0,
  email: 0,
  phone: 0,
  linkedin: 0,
  cv: 0,
  department: 1,
  role: 1,
  seniority: 1,
  start: 1,
  message: 2,
  consent: 2,
};

const trimmed = z.string().transform((value) => value.trim());

const requiredName = (field: "firstName" | "lastName") =>
  trimmed
    .refine((value) => value.length > 0, { message: E(`${field}Required`) })
    .refine((value) => value.length <= 60, { message: E(`${field}Long`) })
    .refine((value) => NAME_RE.test(value), { message: E(`${field}Invalid`) });

export const careerApplicationSchema = z
  .object({
    firstName: requiredName("firstName"),
    lastName: requiredName("lastName"),
    email: trimmed
      .refine((value) => value.length > 0, { message: E("emailRequired") })
      .refine((value) => value.length <= 255, { message: E("emailLong") })
      .refine((value) => z.string().email().safeParse(value).success, {
        message: E("emailInvalid"),
      }),
    // Telefon jest wymagany po stronie CRM (kontakt zwrotny do kandydata).
    phone: trimmed
      .refine((value) => value.length > 0, { message: E("phoneRequired") })
      .refine((value) => PHONE_RE.test(value), { message: E("phoneInvalid") })
      .refine((value) => value.replace(/\D/g, "").length >= 7, { message: E("phoneInvalid") }),
    // LinkedIn jest opcjonalny - CV (plik albo link) jest twardym wymogiem.
    linkedin: trimmed
      .refine((value) => value.length <= 300, { message: E("linkedinLong") })
      .refine((value) => value.length === 0 || LINKEDIN_RE.test(value), {
        message: E("linkedinInvalid"),
      }),
    /** Nazwa wgranego pliku CV (pusta, gdy kandydat podaje sam link). */
    cvFileName: trimmed.optional().default(""),
    /** Publiczny link do CV (pusty, gdy kandydat wgrywa plik). */
    cvUrl: trimmed
      .optional()
      .default("")
      .refine((value) => value.length <= 500, { message: E("cvUrlLong") }),
    department: trimmed.refine(
      (value) => (CAREER_DEPARTMENTS as readonly string[]).includes(value),
      { message: E("departmentRequired") },
    ),
    role: trimmed.refine((value) => value.length > 0, { message: E("roleRequired") }),
    seniority: trimmed.refine(
      (value) => (CAREER_SENIORITIES as readonly string[]).includes(value),
      { message: E("seniorityRequired") },
    ),
    start: trimmed.refine((value) => (CAREER_START_OPTIONS as readonly string[]).includes(value), {
      message: E("startRequired"),
    }),
    // "Dlaczego Ty" jest nieobowiązkowe - rolę CV przejął załącznik/link.
    message: trimmed
      .optional()
      .default("")
      .refine((value) => value.length <= MESSAGE_MAX, { message: E("messageLong") }),
    consent: z.boolean().refine((value) => value === true, { message: E("consentRequired") }),
  })
  // CV wymagane: plik ALBO link. Błąd raportujemy na wirtualnym polu `cv`,
  // które w kreatorze odpowiada całej sekcji załącznika.
  .superRefine((value, ctx) => {
    const hasFile = (value.cvFileName ?? "").length > 0;
    const hasLink = (value.cvUrl ?? "").length > 0;
    if (!hasFile && !hasLink) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cv"], message: E("cvRequired") });
      return;
    }
    if (!hasFile && hasLink && !LINKEDIN_RE.test(value.cvUrl ?? "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cv"], message: E("cvUrlInvalid") });
    }
  });

export type CareerApplicationInput = z.input<typeof careerApplicationSchema>;
export type CareerApplicationValue = z.output<typeof careerApplicationSchema>;

export type CareerFieldErrors = Partial<Record<CareerFieldName, string>>;

export type CareerValidationResult =
  | { ok: true; value: CareerApplicationValue }
  | { ok: false; errors: CareerFieldErrors; firstStep: 0 | 1 | 2; firstField: CareerFieldName };

function collectErrors(issues: readonly z.ZodIssue[]): CareerFieldErrors {
  const errors: CareerFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") continue;
    if (!(CAREER_FORM_FIELDS as readonly string[]).includes(field)) continue;
    const key = field as CareerFieldName;
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

function fail(errors: CareerFieldErrors): CareerValidationResult {
  const firstField = CAREER_FORM_FIELDS.find((field) => errors[field]) ?? CAREER_FORM_FIELDS[0];
  return { ok: false, errors, firstStep: CAREER_FIELD_STEP[firstField], firstField };
}

/** Walidacja całego zgłoszenia - używana tuż przed wysyłką. */
export function validateApplication(input: CareerApplicationInput): CareerValidationResult {
  const parsed = careerApplicationSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return fail(collectErrors(parsed.error.issues));
}

/** Walidacja pojedynczego kroku kreatora - reguły identyczne jak w całości. */
export function validateStep(step: 0 | 1 | 2, input: CareerApplicationInput): CareerFieldErrors {
  const parsed = careerApplicationSchema.safeParse(input);
  if (parsed.success) return {};
  const all = collectErrors(parsed.error.issues);
  const scoped: CareerFieldErrors = {};
  for (const field of CAREER_FORM_FIELDS) {
    if (CAREER_FIELD_STEP[field] === step && all[field]) scoped[field] = all[field];
  }
  return scoped;
}

export function hasErrors(errors: CareerFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}
