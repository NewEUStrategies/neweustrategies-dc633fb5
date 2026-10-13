// Publiczny zapis na wydarzenie: formularz, zapis, rezygnacja.
//
// TRZY WYWOŁANIA, JEDEN MODUŁ. `event_registration_form` czyta stan, zapis
// i `event_registration_cancel` go zmieniają (rezygnację poprzedza podgląd
// skutku finansowego `event_registration_cancel_preview`, REG-03). Trzymamy je razem, bo mają
// wspólny kontrakt tenantowy i wspólne słownictwo odmów.
//
// ZAPIS IDZIE PRZEZ SERWER (REG-04, decyzja D2). Przeglądarka nie woła już
// `event_register`: najemcę z hosta, konto z sesji i solony skrót adresu zna
// tylko serwer (`eventRegistration.functions.ts`), a baza liczy na nich
// kubełki prób. Formularz i rezygnacja zostają publicznymi RPC (`anon`).
//
// GOŚĆ TEŻ SIĘ ZAPISUJE, ALE WYNIK DOSTAJE SKRZYNKA (decyzja D3). Klucz
// samoobsługi, status i płatność wracają do przeglądarki tylko wtedy, gdy
// wołający jest zweryfikowanym właścicielem adresu (potwierdzony e-mail konta
// równy adresowi zgłoszenia). Każdy inny dostaje `check_email` - identyczne dla
// „zapisano" i „już zapisany" - a serwer wysyła mail z linkiem samoobsługi.
//
// `manage_token` WRACA RAZ. Baza trzyma wyłącznie jego SHA-256, więc
// zwracamy go z mutacji do wywołującego i nigdy nie wkładamy do cache zapytań.
//
// `undefined` NIE JEDZIE DO RPC. Pomijamy nieustawione klucze, bo w plpgsql
// `p_payload->>'x'` na jawnym `null` znaczy „wyczyść", a brak klucza znaczy
// „nie dotykaj" - biała lista kluczy zapisu żyje w `registrationPayload.ts`.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  parseCancellationPreview,
  parseCancellationRefundResult,
  type CancellationEffect,
  type CancellationPreview,
  type CancellationRefundResult,
} from "@/lib/events/cancellationPreview";
import { submitEventRegistration } from "@/lib/events/eventRegistration.functions";
import { parseRegistrationForm, type RegistrationForm } from "@/lib/events/registrationFormSurface";
import type { RegisterInput, RegistrationAttribution } from "@/lib/events/registrationPayload";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export type { RegisterInput, RegistrationAnswer } from "@/lib/events/registrationPayload";

/** Odpowiedzi bazy po zapisie - status ustala SQL, nie formularz. */
export const REGISTRATION_RESULT_STATUSES = ["approved", "pending", "waitlist"] as const;
export type RegistrationResultStatus = (typeof REGISTRATION_RESULT_STATUSES)[number];

/**
 * Zapis ZWERYFIKOWANEGO właściciela adresu - jedyny przypadek, w którym
 * przeglądarka dostaje identyfikatory i klucz samoobsługi.
 *
 * BEZ KODU QR. Odpowiedź bazy niesie kod z chwili zapisu, ale serwer od razu
 * wydaje i wysyła mailem bilet (`_event_issue_ticket_codes`), co ten kod
 * rotuje - pokazany na ekranie przestałby wpuszczać. Bilet otwiera się z maila.
 */
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
  /** Jedyny klucz rezygnacji dla gościa bez konta. */
  manageToken: string | null;
  /**
   * Czy zgłoszenie czeka na zapłatę.
   *
   * Zapis wejściówki płatnej stawia `payment_status = 'unpaid'` i NIE wydaje
   * kodu QR (migracja `20260828206000`). Front MUSI to wiedzieć: bez tego
   * pokazałby ekran „do zobaczenia na wydarzeniu" komuś, kto nic nie zapłacił.
   */
  paymentRequired: boolean;
  /** `not_required` | `unpaid` | `paid` | `refunded` - oś pieniędzy, nie decyzji. */
  paymentStatus: string | null;
  /** Kwota do zapłaty w groszach - tylko gdy `paymentRequired`. */
  amountCents: number | null;
  /** Waluta kwoty powyżej. */
  currency: string | null;
  /**
   * Do kiedy obowiązuje cena z chwili zapisu (REG-16, decyzja D8) - ISO albo
   * `null` (zapis bezpłatny, starszy backend).
   */
  quoteValidUntil: string | null;
  /**
   * Czy zgłoszenie jest dowiązane do konta wołającego (REG-01). `false` przy
   * zalogowanym znaczy: zgłoszenie stoi, ale nie trafi do „Moich zgłoszeń"
   * (konto ma potwierdzony inny adres albo jest dowiązane do innej osoby).
   * `null` = baza tego nie mówi (okno wdrożenia).
   */
  accountLinked: boolean | null;
  /**
   * Zaznaczone zgody marketingowe / partnerskie czekają na potwierdzenie
   * mailem (double opt-in, decyzja D5) - ekran mówi, gdzie go szukać.
   */
  consentConfirmationRequired: boolean;
}

/**
 * Wynik wysłania formularza. `check_email` NIE niesie niczego - ani adresu,
 * ani identyfikatora: to ta sama odpowiedź dla nowego zgłoszenia i dla adresu,
 * który już je ma.
 */
export type RegistrationSubmitOutcome =
  { kind: "registered"; result: RegistrationResult } | { kind: "check_email" };

export interface RegistrationCancelResult {
  registrationId: string;
  promotedFromWaitlist: number;
  /**
   * Co dzieje się z wpłatą (REG-03): zlecony zwrot albo decyzja organizatora.
   * `null` przy starszej bazie, która tego nie mówi.
   */
  refund: CancellationRefundResult | null;
}

/** Wejście zapisu z przeglądarki - ładunek formularza plus atrybucja kampanii. */
export interface SubmitRegistrationInput extends RegisterInput {
  /** `attributionPayload()` - `null`/brak = bez atrybucji (brak zgody na pomiar). */
  attribution?: RegistrationAttribution | null;
}

export interface CancelRegistrationInput {
  registrationId?: string;
  /** Token z odpowiedzi zapisu - jedyna droga rezygnacji bez konta. */
  manageToken?: string;
  reason?: string | null;
  /**
   * Skutek finansowy, który uczestnik zobaczył w podglądzie (REG-03). Baza
   * wymaga go przy rezygnacji opłaconego zgłoszenia (`refund_ack_required`)
   * i odmawia, gdy skutek się zmienił (`refund_terms_changed`).
   */
  acknowledgedEffect?: CancellationEffect;
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

/**
 * Formularz zapisu - jedno wywołanie, więc jedna chwila w czasie.
 *
 * KLUCZ BILETU Z LINKU (`?ticket=`) jedzie do bazy: od REG-05 formularz nie
 * oddaje biletów ukrytych, z wyjątkiem biletu za kodem dostępu wskazanego tym
 * kluczem. Baza sprzed migracji nie zna argumentu (PGRST202/42883) - wtedy
 * pytamy ją po staremu, a ona i tak oddaje bilety ukryte na liście.
 */
export async function fetchRegistrationForm(
  eventSlug: string,
  ticketKey?: string | null,
): Promise<RegistrationForm> {
  const key = ticketKey?.trim() ?? "";
  if (key !== "") {
    const { data, error } = await supabase.rpc("event_registration_form", {
      p_event_slug: eventSlug,
      p_ticket_key: key,
    });
    if (!error) return parseRegistrationForm(data);
    if (!isMigrationPending(error)) throw error;
  }
  const { data, error } = await supabase.rpc("event_registration_form", {
    p_event_slug: eventSlug,
  });
  if (error) throw error;
  return parseRegistrationForm(data);
}

/** Odpowiedź zapisu zweryfikowanego właściciela adresu -> model ekranu. */
function registrationResultOf(source: Bag): RegistrationResult | null {
  const registrationId = nullableText(source, "registration_id");
  if (registrationId === null) return null;
  return {
    registrationId,
    eventId: nullableText(source, "event_id"),
    personId: nullableText(source, "person_id"),
    status: statusOf(source),
    decisionSource: nullableText(source, "decision_source"),
    waitlistPosition: optionalInt(source, "waitlist_position"),
    ticketTypeId: nullableText(source, "ticket_type_id"),
    manageToken: nullableText(source, "manage_token"),
    // Starszy backend nie zna części kluczy - czytamy je zachowawczo, żeby
    // formularz nie wywrócił się na odpowiedzi sprzed migracji.
    paymentRequired: source.payment_required === true,
    paymentStatus: nullableText(source, "payment_status"),
    amountCents: optionalInt(source, "amount_cents"),
    currency: nullableText(source, "currency"),
    quoteValidUntil: nullableText(source, "quote_valid_until"),
    accountLinked: typeof source.account_linked === "boolean" ? source.account_linked : null,
    consentConfirmationRequired: source.consent_confirmation_required === true,
  };
}

/**
 * Zapis przez funkcję serwerową. Odmowa bazy przychodzi WARTOŚCIĄ
 * (`{ ok: false, error, detail }`) - rzucamy ją w kształcie, który dawał
 * dawny wyjątek bazy (`kod: ogon`), więc `registrationErrorMessage` mapuje ją
 * tym samym słownikiem co zawsze.
 */
export async function submitRegistration(
  input: SubmitRegistrationInput,
): Promise<RegistrationSubmitOutcome> {
  const { attribution, ...form } = input;
  const client = await submitEventRegistration({
    data: { ...form, lang: form.lang ?? "pl", attribution: attribution ?? null },
  });

  const source = bag(client);
  if (source !== null && source.ok === false) {
    const error = nullableText(source, "error") ?? "unknown";
    throw new Error(`${error}: ${nullableText(source, "detail") ?? "registration refused"}`);
  }
  if (source !== null && source.ok === true && source.outcome === "check_email") {
    return { kind: "check_email" };
  }
  const result = source === null ? null : registrationResultOf(source);
  if (result === null) {
    // Zapis mógł się udać, ale bez identyfikatora nie umiemy go pokazać ani
    // odwołać - mówimy o tym wprost, zamiast rysować sukces bez treści.
    throw new Error("unknown: registration response is not readable");
  }
  return { kind: "registered", result };
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

/**
 * Podgląd rezygnacji: skutek finansowy i odmowa znana z góry (REG-03, REG-13).
 *
 * Ta sama tożsamość co rezygnacja - klucz `manage_token` albo konto
 * właściciela. Odmowa jest WARTOŚCIĄ (`not_found` / `expired`), bo „zły klucz"
 * to normalny stan strony. Baza sprzed migracji (PGRST202/42883) daje
 * `unavailable`: ekran pokazuje wtedy rezygnację jak dotąd, bez skutku.
 */
export async function fetchCancellationPreview(input: {
  manageToken?: string;
  registrationId?: string;
}): Promise<CancellationPreview> {
  const payload: Record<string, Json> = {};
  if (input.registrationId !== undefined) payload.registration_id = input.registrationId;
  if (input.manageToken !== undefined) payload.manage_token = input.manageToken;

  const { data, error } = await supabase.rpc("event_registration_cancel_preview", {
    p_payload: payload,
  });
  if (error) {
    if (isMigrationPending(error)) return { kind: "unavailable" };
    throw error;
  }
  return parseCancellationPreview(data);
}

export async function cancelRegistration(
  input: CancelRegistrationInput,
): Promise<RegistrationCancelResult> {
  const payload: Record<string, Json> = {};
  if (input.registrationId !== undefined) payload.registration_id = input.registrationId;
  if (input.manageToken !== undefined) payload.manage_token = input.manageToken;
  if (input.reason !== undefined) payload.reason = input.reason;
  if (input.acknowledgedEffect !== undefined)
    payload.acknowledged_effect = input.acknowledgedEffect;

  const { data, error } = await supabase.rpc("event_registration_cancel", {
    p_payload: payload,
  });
  if (error) throw error;

  const source = bag(data);
  if (source === null) {
    // Odpowiedź, której nie umiemy przeczytać, NIE jest odwołanym zgłoszeniem.
    // Wynik zastępczy rysowałby ekran „zgłoszenie odwołane" nad miejscem, które
    // nadal jest zajęte, a gość bez konta uznałby swój `manage_token` za zużyty.
    // Bliźniacza `submitRegistration` rozstrzyga to tak samo („response is not
    // readable").
    throw new Error("unknown: cancel response is not readable");
  }
  return {
    registrationId: nullableText(source, "registration_id") ?? "",
    promotedFromWaitlist: optionalInt(source, "promoted_from_waitlist") ?? 0,
    refund: parseCancellationRefundResult(source.refund),
  };
}
