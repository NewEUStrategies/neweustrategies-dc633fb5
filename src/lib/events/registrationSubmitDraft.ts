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
//
// SUFITY DŁUGOŚCI TO TE SAME LICZBY CO W BAZIE (`REGISTRATION_FIELD_LIMITS`).
// Za długi tekst jest błędem pod polem - nigdy nie przycinamy go po cichu
// (AGENTS.md): organizator widziałby w kartotece coś innego, niż wpisano.
//
// ZNAKI STERUJĄCE TEŻ (R38). Tabulator albo nowa linia wklejone w środek imienia,
// firmy czy adresu to dla bazy odmowa kodem pola (`_event_text_has_control`)
// - mówimy o tym pod polem, zamiast oddawać formularz z ogólnym błędem.
import type { RegistrationAnswer } from "@/lib/events/registrationPayload";
import {
  REGISTRATION_FIELD_LIMITS as LIMITS,
  hasControlCharacters,
} from "@/lib/events/registrationFieldLimits";
import {
  hasHiddenTickets,
  isTicketSelectable,
  requiredTermIds,
  requiresTicketChoice,
  type RegistrationForm,
  type RegistrationFormField,
  type TicketReveal,
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
  /**
   * Kod dostępu wybranej wejściówki (`requiresAccessCode`). Dla biletu bez
   * kodu pole nie jedzie do bazy - `event_register` i tak by je pominęło.
   */
  accessCode: string;
  /** Klucz pola -> wartość; `multiselect` trzyma listę wybranych wartości. */
  answers: Record<string, string | string[]>;
  acceptedTermIds: string[];
  consentDataProcessing: boolean;
  consentMarketing: boolean;
  consentPartnerSharing: boolean;
}

export function emptyRegistrationDraft(form: RegistrationForm): RegistrationDraft {
  const [only, ...others] = form.tickets.filter(isTicketSelectable);
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
    ticketTypeId: only !== undefined && others.length === 0 ? only.id : null,
    accessCode: "",
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
  | "phone"
  | "jobTitle"
  | "companyText"
  | "socialProfileUrl"
  | "ticketTypeId"
  | "accessCode"
  | "consentDataProcessing"
  | "terms"
  | `answer:${string}`;

export interface RegistrationDraftError {
  field: RegistrationDraftField;
  /**
   * Klucz w `eventRegistration.validation.*` - albo, z kropką, pełna ścieżka
   * pod `eventRegistration.` (np. `group.leadEmailMismatch`). Zdanie składa
   * `draftErrorMessageKey`.
   */
  errorKey: string;
  /** Liczby do zdania (`{{max}}`, `{{min}}`) - sufity z `REGISTRATION_FIELD_LIMITS`. */
  params?: Record<string, number>;
}

/** Pełny klucz i18n zdania pod polem. */
export function draftErrorMessageKey(error: RegistrationDraftError): string {
  return error.errorKey.includes(".")
    ? `eventRegistration.${error.errorKey}`
    : `eventRegistration.validation.${error.errorKey}`;
}

/** Ten sam wzorzec, co w `event_register()` - ani ostrzejszy, ani luźniejszy. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/** Znak sterujący w polu (`hasControlCharacters` - ta sama reguła co baza). */
function controlChars(field: RegistrationDraftField, value: string): RegistrationDraftError | null {
  return hasControlCharacters(value.trim()) ? { field, errorKey: "controlChars" } : null;
}

/** Błąd sufitu długości, gdy przycięty tekst go przekracza. */
function tooLong(
  field: RegistrationDraftField,
  value: string,
  max: number,
): RegistrationDraftError | null {
  return value.trim().length > max ? { field, errorKey: "tooLong", params: { max } } : null;
}

function answerText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(",");
  return (value ?? "").trim();
}

function isAnswered(field: RegistrationFormField, value: string | string[] | undefined): boolean {
  if (
    field.fieldType === "checkbox" ||
    field.fieldType === "switch" ||
    field.fieldType === "consent"
  )
    return value === "true";
  if (Array.isArray(value)) return value.length > 0;
  return answerText(value) !== "";
}

export function validateRegistrationDraft(
  draft: RegistrationDraft,
  form: RegistrationForm,
): RegistrationDraftError[] {
  const errors: RegistrationDraftError[] = [];
  const push = (error: RegistrationDraftError | null): void => {
    if (error !== null) errors.push(error);
  };

  const firstName = draft.firstName.trim();
  if (firstName === "") errors.push({ field: "firstName", errorKey: "firstName" });
  else push(tooLong("firstName", firstName, LIMITS.name) ?? controlChars("firstName", firstName));
  const lastName = draft.lastName.trim();
  if (lastName === "") errors.push({ field: "lastName", errorKey: "lastName" });
  else push(tooLong("lastName", lastName, LIMITS.name) ?? controlChars("lastName", lastName));

  const email = draft.email.trim();
  if (email.length > LIMITS.email) push(tooLong("email", email, LIMITS.email));
  else if (hasControlCharacters(email)) push(controlChars("email", email));
  else if (!EMAIL.test(email)) errors.push({ field: "email", errorKey: "email" });

  // Telefon jest dobrowolny, ale podany musi zmieścić się w CHECK-u bazy
  // (4..40 znaków) - inaczej `invalid_phone` przyszłoby dopiero z serwera.
  const phone = draft.phone.trim();
  if (phone !== "" && (phone.length < LIMITS.phoneMin || phone.length > LIMITS.phoneMax)) {
    errors.push({
      field: "phone",
      errorKey: "phoneLength",
      params: { min: LIMITS.phoneMin, max: LIMITS.phoneMax },
    });
  } else {
    push(controlChars("phone", phone));
  }
  push(
    tooLong("jobTitle", draft.jobTitle, LIMITS.jobTitle) ??
      controlChars("jobTitle", draft.jobTitle),
  );
  push(
    tooLong("companyText", draft.companyText, LIMITS.companyText) ??
      controlChars("companyText", draft.companyText),
  );

  const social = draft.socialProfileUrl.trim();
  if (social.length > LIMITS.socialProfileUrl) {
    push(tooLong("socialProfileUrl", social, LIMITS.socialProfileUrl));
  } else if (hasControlCharacters(social)) {
    push(controlChars("socialProfileUrl", social));
  } else if (social !== "" && !social.startsWith("https://")) {
    errors.push({ field: "socialProfileUrl", errorKey: "socialProfile" });
  }

  // Bilet wymagany wtedy, gdy wydarzenie ma AKTYWNE bilety (także same ukryte -
  // REG-05) - i tylko wybieralny, bo bilet spoza sprzedaży baza odrzuci
  // osobnym błędem.
  if (requiresTicketChoice(form)) {
    const chosen = form.tickets.find((ticket) => ticket.id === draft.ticketTypeId);
    if (chosen === undefined || !isTicketSelectable(chosen)) {
      // Nic do wybrania, a bilety są - ukryte za kodem. „Wybierz bilet" przy
      // pustej liście byłoby zdaniem bez wyjścia; mówimy, skąd wziąć kod.
      const hiddenOnly = !form.tickets.some(isTicketSelectable) && hasHiddenTickets(form);
      errors.push({ field: "ticketTypeId", errorKey: hiddenOnly ? "ticketHiddenOnly" : "ticket" });
    } else if (chosen.requiresAccessCode && draft.accessCode.trim() === "") {
      // Bez kodu `event_register` odmawia (`invalid_access_code`) - mówimy
      // to pod polem, zanim uczestnik straci wypełniony formularz. Czy kod
      // jest POPRAWNY, wie tylko baza (skrót kodu nie wychodzi do klienta).
      errors.push({ field: "accessCode", errorKey: "accessCode" });
    } else if (chosen.requiresAccessCode) {
      push(tooLong("accessCode", draft.accessCode, LIMITS.code));
    }
  }

  // ZGODY sa osobna lista, bo stoja w innym miejscu formularza - ale wymagalnosc
  // dziala tak samo, a serwer sprawdza JEDNO I DRUGIE. Gdyby ta petla ich nie
  // obejmowala, uczestnik dostawalby odmowe dopiero z bazy, komunikatem
  // `missing_required_consents`, ktory nic mu nie mowi o tym, co zaznaczyc.
  for (const consent of form.consents ?? []) {
    if (consent.isRequired && !isAnswered(consent, draft.answers[consent.key])) {
      errors.push({ field: `answer:${consent.key}`, errorKey: "requiredConsent" });
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
  // OBIE listy, bo `answers` w bazie jest JEDNYM obiektem: `event_register`
  // szuka w nim odpowiedzi po kluczu pola, nie zagladajac, z ktorej listy
  // formularza pole przyszlo. Petla wylacznie po `form.fields` znaczylaby, ze
  // zaznaczona zgoda NIE JEDZIE do bazy - i wymagana zgoda odrzucalaby zapis
  // nawet po zaznaczeniu.
  // `?? []` nie jest ozdoba: `RegistrationForm` sklada takze kod wywolujacy,
  // a brak jednego klucza nie moze wywrocic NAJWAZNIEJSZEGO przebiegu
  // publicznego. Parser zawsze ustawia te liste - to jest siatka pod nim.
  for (const field of [...(form.consents ?? []), ...form.fields]) {
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

/**
 * Kod dostępu, który jedzie do `event_register` - tylko dla wejściówki za
 * kodem. Niesie też wydarzenie i bilet, pod którymi formularz zapamiętuje kod
 * dla kasy (`rememberTicketAccessCode`): kasa zgłoszenia pyta
 * `event_ticket_checkout_quote` o ten sam kod.
 */
export interface DraftAccessCode {
  eventId: string;
  ticketTypeId: string;
  code: string;
}

export function draftAccessCode(
  draft: RegistrationDraft,
  form: RegistrationForm,
): DraftAccessCode | null {
  const chosen = form.tickets.find((ticket) => ticket.id === draft.ticketTypeId);
  const code = draft.accessCode.trim().toUpperCase();
  if (form.event === null || chosen === undefined || !chosen.requiresAccessCode || code === "") {
    return null;
  }
  return { eventId: form.event.id, ticketTypeId: chosen.id, code };
}

/**
 * Szkic z kodem dostępu z pamięci karty. Wpisany kod wygrywa - pamięć
 * uzupełnia tylko puste pole, a pusta pamięć niczego nie zmienia.
 */
export function withRememberedAccessCode(
  draft: RegistrationDraft | null,
  remembered: string,
): RegistrationDraft | null {
  if (draft === null || draft.accessCode !== "" || remembered === "") return draft;
  return { ...draft, accessCode: remembered };
}

/**
 * Kod ODSŁANIAJĄCY, który jedzie do zapisu (`reveal_code`, REG-05). Tylko dla
 * biletu ukrytego BEZ kodu dostępu, który ten kod odsłonił - baza odpowiada na
 * taki bilet bez ważnego kodu `not_found`, jak na bilet nieistniejący. Bilet
 * za kodem dostępu ma własną bramkę (`access_code`), a bilet jawny - żadnej,
 * więc w obu przypadkach kod nie jedzie.
 */
export function draftRevealCode(
  draft: RegistrationDraft,
  form: RegistrationForm,
  reveal: TicketReveal | null,
): string | null {
  if (reveal === null || draft.ticketTypeId === null) return null;
  const chosen = form.tickets.find((ticket) => ticket.id === draft.ticketTypeId);
  if (chosen === undefined || chosen.isHidden !== true || chosen.requiresAccessCode) return null;
  if (!reveal.ticketIds.includes(chosen.id)) return null;
  const code = reveal.code.trim();
  return code === "" ? null : code;
}

/** Porównanie adresów tak, jak robi to baza (`lower(btrim(...))`). */
function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Zapis z gośćmi należy do konta prowadzącego (REG-01, decyzja D1): baza wiąże
 * zgłoszenie z kontem WYŁĄCZNIE przez potwierdzony adres konta, a gości dopisuje
 * tylko zgłoszeniu z tego konta. Prowadzący z innym adresem niż konto dostałby
 * zgłoszenie bez gości i odmowę dopisania - mówimy to pod polem e-mail, ZANIM
 * cokolwiek zostanie zapisane.
 */
export function validateGroupLeadEmail(
  draft: RegistrationDraft,
  context: { accountEmail: string | null; guestCount: number },
): RegistrationDraftError | null {
  if (context.guestCount === 0 || context.accountEmail === null) return null;
  return sameEmail(draft.email, context.accountEmail)
    ? null
    : { field: "email", errorKey: "group.leadEmailMismatch" };
}

/**
 * Czy wpisany adres różni się od adresu konta zalogowanego - podpowiedź pod
 * polem: zgłoszenie na inny adres nie trafi do „Moich zgłoszeń", a płatnej
 * wejściówki baza nie przyjmie (`account_email_required`).
 */
export function emailDiffersFromAccount(email: string, accountEmail: string | null): boolean {
  if (accountEmail === null || accountEmail.trim() === "" || email.trim() === "") return false;
  return !sameEmail(email, accountEmail);
}
