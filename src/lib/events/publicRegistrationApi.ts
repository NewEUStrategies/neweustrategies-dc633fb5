// Publiczne RPC zapisu na wydarzenie: formularz, zapis, rezygnacja.
//
// TRZY WYWOŁANIA, JEDEN MODUŁ. `event_registration_form` czyta stan, a
// `event_register` i `event_registration_cancel` go zmieniają. Trzymamy je
// razem, bo mają wspólny kontrakt tenantowy (`public_tenant_id()`) i wspólną
// walidację po stronie bazy.
//
// GOŚĆ TEŻ SIĘ ZAPISUJE. Wszystkie trzy funkcje mają `GRANT ... TO anon`,
// więc niezalogowany uczestnik przechodzi zapis, a zalogowany dodatkowo wiąże
// go z kontem. Nie dodajemy tu bramki `auth.uid()`, bo powielałaby regułę,
// którą baza już rozstrzyga.
//
// `manage_token` I `qr_token` WRACAJĄ RAZ. Baza trzyma wyłącznie ich SHA-256,
// więc utrata odpowiedzi to utrata jedynego sposobu odwołania zapisu przez
// gościa. Dlatego zwracamy je z mutacji do wywołującego i nigdy nie wkładamy
// do cache zapytań.
//
// `undefined` NIE JEDZIE DO RPC. Pomijamy nieustawione klucze, bo w plpgsql
// `p_payload->>'x'` na jawnym `null` znaczy „wyczyść", a brak klucza znaczy
// „nie dotykaj".
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { parseRegistrationForm, type RegistrationForm } from "@/lib/events/registrationFormSurface";

/** Odpowiedzi bazy po zapisie - status ustala SQL, nie formularz. */
export const REGISTRATION_RESULT_STATUSES = ["approved", "pending", "waitlist"] as const;
export type RegistrationResultStatus = (typeof REGISTRATION_RESULT_STATUSES)[number];

export interface RegistrationResult {
  registrationId: string;
  /**
   * Wydarzenie zgłoszenia.
   *
   * Kasa (`createCheckoutOrder`) przyjmuje `event_id`, `ticket_type_id`
   * I `registration_id` NARAZ, więc odpowiedź zapisu musi nieść komplet -
   * inaczej ekran potwierdzenia musiałby go doszukiwać drugim zapytaniem.
   * `null` przy starszym backendzie: wołający ma wtedy własne źródło
   * (formularz zna `event.id`).
   */
  eventId: string | null;
  personId: string | null;
  status: RegistrationResultStatus;
  /** Powód decyzji bazy (`capacity`, reguła kwalifikująca) albo `null`. */
  decisionSource: string | null;
  waitlistPosition: number | null;
  ticketTypeId: string | null;
  /** Kod wejścia - tylko dla zapisu od razu zatwierdzonego. */
  qrToken: string | null;
  /** Jedyny klucz rezygnacji dla gościa bez konta. */
  manageToken: string | null;
  /**
   * Czy zgłoszenie czeka na zapłatę.
   *
   * `event_register` przy wejściówce płatnej zapisuje `payment_status = 'unpaid'`
   * i NIE wydaje kodu QR (migracja `20260828206000`). Front MUSI to wiedzieć:
   * bez tego pokazałby ekran „do zobaczenia na wydarzeniu" i wysłał
   * potwierdzenie komuś, kto nic nie zapłacił - a dokładnie tak działo się
   * przed tą naprawą, bo cena nie była w ogóle sprawdzana.
   */
  paymentRequired: boolean;
  /** `not_required` | `unpaid` | `paid` | `refunded` - oś pieniędzy, nie decyzji. */
  paymentStatus: string | null;
  /** Kwota do zapłaty w groszach - tylko gdy `paymentRequired`. */
  amountCents: number | null;
  /** Waluta kwoty powyżej. */
  currency: string | null;
}

export interface RegistrationCancelResult {
  registrationId: string;
  promotedFromWaitlist: number;
}

export interface RegistrationAnswer {
  key: string;
  /** Napis, liczba, prawda/fałsz albo lista wartości dla `multiselect`. */
  value: string | number | boolean | string[];
}

export interface RegisterInput {
  eventSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  jobTitle?: string | null;
  companyText?: string | null;
  socialProfileUrl?: string | null;
  ticketTypeId?: string | null;
  answers?: RegistrationAnswer[];
  acceptedTermIds?: string[];
  consentDataProcessing: boolean;
  consentMarketing?: boolean;
  consentPartnerSharing?: boolean;
}

export interface CancelRegistrationInput {
  registrationId?: string;
  /** Token z odpowiedzi zapisu - jedyna droga rezygnacji bez konta. */
  manageToken?: string;
  reason?: string | null;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function nullableText(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalInt(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function statusOf(source: Bag): RegistrationResultStatus {
  const value = nullableText(source, "status");
  // Nieznany status czytamy jako `pending`: „czeka na decyzję" jest jedyną
  // odpowiedzią, która nie obiecuje uczestnikowi wejścia ani go nie odbiera.
  return value !== null && (REGISTRATION_RESULT_STATUSES as readonly string[]).includes(value)
    ? (value as RegistrationResultStatus)
    : "pending";
}

function answersPayload(answers: RegistrationAnswer[] | undefined): Json {
  const out: Record<string, Json> = {};
  for (const answer of answers ?? []) {
    const key = answer.key.trim();
    if (key === "") continue;
    out[key] = answer.value;
  }
  return out;
}

/** Formularz zapisu - jedno wywołanie, więc jedna chwila w czasie. */
export async function fetchRegistrationForm(eventSlug: string): Promise<RegistrationForm> {
  const { data, error } = await supabase.rpc("event_registration_form", {
    p_event_slug: eventSlug,
  });
  if (error) throw error;
  return parseRegistrationForm(data);
}

export async function submitRegistration(input: RegisterInput): Promise<RegistrationResult> {
  const payload: Record<string, Json> = {
    event_slug: input.eventSlug,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    answers: answersPayload(input.answers),
    accepted_term_ids: input.acceptedTermIds ?? [],
    consent_data_processing: input.consentDataProcessing,
    consent_marketing: input.consentMarketing === true,
    consent_partner_sharing: input.consentPartnerSharing === true,
  };
  if (input.phone !== undefined) payload.phone = input.phone;
  if (input.jobTitle !== undefined) payload.job_title = input.jobTitle;
  if (input.companyText !== undefined) payload.company_text = input.companyText;
  if (input.socialProfileUrl !== undefined) payload.social_profile_url = input.socialProfileUrl;
  if (input.ticketTypeId !== undefined) payload.ticket_type_id = input.ticketTypeId;

  const { data, error } = await supabase.rpc("event_register", {
    p_payload: payload,
  });
  if (error) throw error;

  const source = bag(data);
  const registrationId = source === null ? null : nullableText(source, "registration_id");
  if (source === null || registrationId === null) {
    // Zapis mógł się udać, ale bez identyfikatora nie umiemy go pokazać ani
    // odwołać - mówimy o tym wprost, zamiast rysować sukces bez treści.
    throw new Error("unknown: registration response is not readable");
  }

  return {
    registrationId,
    eventId: nullableText(source, "event_id"),
    personId: nullableText(source, "person_id"),
    status: statusOf(source),
    decisionSource: nullableText(source, "decision_source"),
    waitlistPosition: optionalInt(source, "waitlist_position"),
    ticketTypeId: nullableText(source, "ticket_type_id"),
    qrToken: nullableText(source, "qr_token"),
    manageToken: nullableText(source, "manage_token"),
    // Starszy backend nie zna tych kluczy - czytamy je zachowawczo, żeby
    // formularz nie wywrócił się na odpowiedzi sprzed migracji.
    paymentRequired: source.payment_required === true,
    paymentStatus: nullableText(source, "payment_status"),
    amountCents: optionalInt(source, "amount_cents"),
    currency: nullableText(source, "currency"),
  };
}

/**
 * Stan WLASNEGO zgloszenia widziany ze strony samoobslugi.
 *
 * MINIMUM, NIE KARTOTEKA. `event_registration_manage_view` oddaje wylacznie to,
 * czego potrzebuje zdanie „czekamy na wplate, oto kwota" i przycisk do kasy -
 * zadnego adresu e-mail, nazwiska ani odpowiedzi z formularza.
 */
export interface RegistrationManageView {
  registrationId: string;
  eventId: string | null;
  eventSlug: string | null;
  ticketTypeId: string | null;
  status: string;
  /** `not_required` | `unpaid` | `paid` | `partially_refunded` | `refunded`. */
  paymentStatus: string | null;
  waitlistPosition: number | null;
  amountCents: number | null;
  currency: string | null;
  /** Czy ZALOGOWANY wolajacy jest wlascicielem - decyduje o przycisku kasy. */
  ownedByCaller: boolean;
}

/**
 * Zgloszenie pod kluczem `manage_token` (gosc) albo pod identyfikatorem
 * (wlasciciel konta). `null` = nie ma czego pokazac; odmowa NIE jest wyjatkiem,
 * bo „zly klucz" to normalny stan strony, a nie awaria.
 */
export async function fetchRegistrationManageView(input: {
  manageToken?: string;
  registrationId?: string;
}): Promise<RegistrationManageView | null> {
  const payload: Record<string, Json> = {};
  if (input.manageToken !== undefined) payload.manage_token = input.manageToken;
  if (input.registrationId !== undefined) payload.registration_id = input.registrationId;

  const { data, error } = await supabase.rpc("event_registration_manage_view", {
    p_payload: payload,
  });
  if (error) throw error;

  const source = bag(data);
  if (source === null || source.ok !== true) return null;
  const registrationId = nullableText(source, "registration_id");
  if (registrationId === null) return null;

  return {
    registrationId,
    eventId: nullableText(source, "event_id"),
    eventSlug: nullableText(source, "event_slug"),
    ticketTypeId: nullableText(source, "ticket_type_id"),
    status: nullableText(source, "status") ?? "pending",
    paymentStatus: nullableText(source, "payment_status"),
    waitlistPosition: optionalInt(source, "waitlist_position"),
    amountCents: optionalInt(source, "amount_cents"),
    currency: nullableText(source, "currency"),
    ownedByCaller: source.owned_by_caller === true,
  };
}

export async function cancelRegistration(
  input: CancelRegistrationInput,
): Promise<RegistrationCancelResult> {
  const payload: Record<string, Json> = {};
  if (input.registrationId !== undefined) payload.registration_id = input.registrationId;
  if (input.manageToken !== undefined) payload.manage_token = input.manageToken;
  if (input.reason !== undefined) payload.reason = input.reason;

  const { data, error } = await supabase.rpc("event_registration_cancel", {
    p_payload: payload,
  });
  if (error) throw error;

  const source = bag(data);
  return {
    registrationId: source === null ? "" : (nullableText(source, "registration_id") ?? ""),
    promotedFromWaitlist:
      source === null ? 0 : (optionalInt(source, "promoted_from_waitlist") ?? 0),
  };
}
