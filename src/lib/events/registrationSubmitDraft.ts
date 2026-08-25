// Szkic zgłoszenia uczestnika i jego walidacja PRZED wywołaniem RPC.
//
// PO CO WALIDOWAĆ DWA RAZY. `event_register()` i tak sprawdza wszystko - to on
// jest granicą bezpieczeństwa. Tutejsze reguły są LUSTREM tych warunków, żeby
// uczestnik zobaczył „podaj poprawny e-mail" pod polem, a nie komunikat
// serwera po utracie wypełnionego formularza. Reguły są celowo NIE ostrzejsze
// niż w bazie: własna, surowsza walidacja odrzucałaby zgłoszenia, które baza
// przyjmuje.
//
// ODPOWIEDZI TRZYMAMY JAKO NAPISY, konwertujemy przy wysyłce. Pole `number` w
// przeglądarce daje napis, a `multiselect` listę; jedno miejsce konwersji to
// jedno miejsce, w którym może się to zepsuć.
//
// PUSTA ODPOWIEDŹ NIE JEDZIE DO BAZY. Klucz z pustym napisem wyglądałby w
// `answers` jak odpowiedź „nic", a `missing_required_fields` liczy właśnie
// obecność treści.
import type { RegistrationAnswer } from "@/lib/events/publicRegistrationApi";
import {
  isTicketSelectable,
  requiredTermIds,
  type RegistrationForm,
  type RegistrationFormField,
} from "@/lib/events/registrationFormSurface";

export interface RegistrationDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  companyText: string;
  socialProfileUrl: string;
  ticketTypeId: string | null;
  /** Klucz pola -> wartość; `multiselect` trzyma listę wybranych wartości. */
  answers: Record<string, string | string[]>;
  acceptedTermIds: string[];
  consentDataProcessing: boolean;
  consentMarketing: boolean;
  consentPartnerSharing: boolean;
}

export function emptyRegistrationDraft(form: RegistrationForm): RegistrationDraft {
  const selectable = form.tickets.filter(isTicketSelectable);
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    jobTitle: "",
    companyText: "",
    socialProfileUrl: "",
    // Jeden wybieralny bilet zaznaczamy z góry - wybór bez alternatywy jest
    // tylko dodatkowym klikiem, o którym łatwo zapomnieć.
    ticketTypeId: selectable.length === 1 ? (selectable[0]?.id ?? null) : null,
    answers: {},
    acceptedTermIds: [],
    consentDataProcessing: false,
    consentMarketing: false,
    consentPartnerSharing: false,
  };
}

export type RegistrationDraftField =
  | "firstName"
  | "lastName"
  | "email"
  | "socialProfileUrl"
  | "ticketTypeId"
  | "consentDataProcessing"
  | "terms"
  | `answer:${string}`;

export interface RegistrationDraftError {
  field: RegistrationDraftField;
  /** Klucz w `eventRegistration.validation.*`. */
  errorKey: string;
}

/** Ten sam wzorzec, co w `event_register()` - ani ostrzejszy, ani luźniejszy. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

function answerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(",");
  return (value ?? "").trim();
}

function isAnswered(field: RegistrationFormField, value: string | string[] | undefined): boolean {
  if (field.fieldType === "checkbox" || field.fieldType === "switch" || field.fieldType === "consent")
    return value === "true";
  if (Array.isArray(value)) return value.length > 0;
  return answerText(value) !== "";
}

export function validateRegistrationDraft(
  draft: RegistrationDraft,
  form: RegistrationForm,
): RegistrationDraftError[] {
  const errors: RegistrationDraftError[] = [];

  if (draft.firstName.trim() === "") errors.push({ field: "firstName", errorKey: "firstName" });
  if (draft.lastName.trim() === "") errors.push({ field: "lastName", errorKey: "lastName" });
  if (!EMAIL.test(draft.email.trim())) errors.push({ field: "email", errorKey: "email" });

  const social = draft.socialProfileUrl.trim();
  if (social !== "" && !social.startsWith("https://")) {
    errors.push({ field: "socialProfileUrl", errorKey: "socialProfile" });
  }

  // Bilet wymagany tylko wtedy, gdy wydarzenie ma bilety - i tylko wybieralny,
  // bo bilet spoza sprzedaży baza odrzuci osobnym błędem.
  if (form.tickets.length > 0) {
    const chosen = form.tickets.find((ticket) => ticket.id === draft.ticketTypeId);
    if (chosen === undefined || !isTicketSelectable(chosen)) {
      errors.push({ field: "ticketTypeId", errorKey: "ticket" });
    }
  }

  for (const field of form.fields) {
    if (field.isRequired && !isAnswered(field, draft.answers[field.key])) {
      errors.push({ field: `answer:${field.key}`, errorKey: "requiredField" });
    }
    if (field.fieldType === "number") {
      const raw = answerText(draft.answers[field.key]);
      if (raw !== "" && !Number.isFinite(Number(raw))) {
        errors.push({ field: `answer:${field.key}`, errorKey: "number" });
      }
    }
  }

  const required = requiredTermIds(form);
  if (required.some((id) => !draft.acceptedTermIds.includes(id))) {
    errors.push({ field: "terms", errorKey: "requiredTerms" });
  }

  if (!draft.consentDataProcessing) {
    errors.push({ field: "consentDataProcessing", errorKey: "dataProcessing" });
  }

  return errors;
}

/** Odpowiedzi w postaci oczekiwanej przez RPC - puste pomijamy. */
export function draftAnswers(
  draft: RegistrationDraft,
  form: RegistrationForm,
): RegistrationAnswer[] {
  const out: RegistrationAnswer[] = [];
  for (const field of form.fields) {
    const raw = draft.answers[field.key];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      if (raw.length > 0) out.push({ key: field.key, value: raw });
      continue;
    }
    const value = raw.trim();
    if (value === "") continue;
    if (field.fieldType === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) continue;
      out.push({ key: field.key, value: parsed });
      continue;
    }
    if (field.fieldType === "checkbox" || field.fieldType === "switch") {
      out.push({ key: field.key, value: value === "true" });
      continue;
    }
    out.push({ key: field.key, value });
  }
  return out;
}

/** Pola opcjonalne: puste zostają pominięte, żeby nie zapisywać pustych napisów. */
export function draftOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
