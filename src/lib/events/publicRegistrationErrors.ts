// Odmowy publicznego zapisu -> zdanie dla uczestnika (nie dla organizatora).
//
// TA SAMA MECHANIKA, INNY TON. Klucz stoi w głowie komunikatu plpgsql
// (`terms_required: <uuid>,<uuid>`), ale odbiorcą jest ktoś, kto właśnie
// próbował się zapisać - zdania mówią, co zrobić, a nie co naruszył warunek
// tabeli.
//
// OGON KOMUNIKATU BYWA LISTĄ IDENTYFIKATORÓW, a nie liczbą: `missing_required_fields`
// i `terms_required` wysyłają klucze pól i zgód. Liczymy je i podajemy jako
// `count`, bo pokazywanie uczestnikowi UUID-ów jest gorsze niż milczenie o nich.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, żeby zamiast
// „violates check constraint" pokazać zdanie, po którym można działać.
//
// ODMOWY DOPISANIA GOŚCI MAJĄ WŁASNY SŁOWNIK (`groupGuestsFailure`).
// `event_register_group_guests` używa części tych samych słów co
// `event_register`, ale mówi nimi o czym innym: `not_found` znaczy tam „nie ma
// zgłoszenia prowadzącego na TYM koncie", a nie „nie ma wydarzenia", a
// `already_registered: <email>` dotyczy jednego z gości, nie kupującego.
// Słownik zapisu prowadzącego podsuwał więc zdanie nieprawdziwe albo ogólne
// „Nie udało się zapisać" - choć zgłoszenie kupującego już stało w bazie.
import i18n from "@/lib/i18n";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

const PREFIX = "eventRegistration.errors.";
const GROUP_PREFIX = "eventRegistration.group.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "";
}

/** Głowa (kod odmowy) i ogon (szczegół) komunikatu `RAISE EXCEPTION`. */
function splitMessage(error: unknown): { head: string; tail: string } {
  const message = messageOf(error);
  const separator = message.indexOf(":");
  return {
    head: (separator === -1 ? message : message.slice(0, separator)).trim(),
    tail: separator === -1 ? "" : message.slice(separator + 1).trim(),
  };
}

export type RegistrationErrorParams = Record<string, string | number>;

export interface RegistrationFailure {
  /** Pełny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: RegistrationErrorParams;
}

/** Ile rzeczy brakuje - z listy kluczy albo z liczby w ogonie komunikatu. */
function paramsOf(head: string, tail: string): RegistrationErrorParams {
  if (tail === "") return {};
  if (head === "missing_required_fields" || head === "terms_required") {
    const items = tail
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return items.length > 0 ? { count: items.length } : {};
  }
  const numbers = tail.match(/\d+/g) ?? [];
  return numbers[0] === undefined ? {} : { count: Number(numbers[0]) };
}

export function registrationFailure(error: unknown): RegistrationFailure {
  ensureEventRegistrationI18n();
  const { head, tail } = splitMessage(error);

  if (!/^[a-z][a-z0-9_]*$/.test(head)) return { key: `${PREFIX}unknown`, params: {} };

  const candidate = `${PREFIX}${camel(head)}`;
  if (!i18n.exists(candidate)) return { key: `${PREFIX}unknown`, params: {} };
  return { key: candidate, params: paramsOf(head, tail) };
}

/** Gotowe zdanie dla toasta albo pola błędu w formularzu zapisu. */
export function registrationErrorMessage(error: unknown): string {
  const failure = registrationFailure(error);
  return i18n.t(failure.key, failure.params);
}

/**
 * Każdy `RAISE EXCEPTION` z `event_register_group_guests`
 * (migracja `20260922230000_event_ticket_tax_and_group.sql`), w kolejności
 * sprawdzeń w funkcji. Lista jest jawna, a nie wyliczana z `i18n.exists`, żeby
 * test mógł dowieść, że KAŻDA odmowa tej funkcji ma zdanie w obu językach.
 */
export const GROUP_GUEST_REFUSALS = [
  "account_required",
  "invalid_guests",
  "not_found",
  "registration_closed",
  "already_settled",
  "group_not_enabled",
  "group_too_large",
  "sold_out",
  "invalid_name",
  "invalid_email",
  "already_registered",
] as const;

export type GroupGuestRefusal = (typeof GROUP_GUEST_REFUSALS)[number];

function isGroupGuestRefusal(head: string): head is GroupGuestRefusal {
  return GROUP_GUEST_REFUSALS.some((known) => known === head);
}

export interface GroupGuestsFailureContext {
  /**
   * Limit grupy biletu (prowadzący + goście), gdy wołający go zna. Baza mówi
   * samo `group_too_large`, a kupujący musi wiedzieć, ilu gości usunąć.
   */
  maxSize?: number | null;
}

/**
 * Odmowa `event_register_group_guests` -> klucz `eventRegistration.group.errors.*`.
 *
 * Kolejność: odmowa tej funkcji -> słownik zapisu prowadzącego (to samo
 * połączenie może odmówić np. limitem prób) -> `group.errors.unknown`, które
 * mówi, że zgłoszenie kupującego STOI - ogólne „nie udało się zapisać"
 * brzmiałoby jak utrata całego zapisu.
 */
export function groupGuestsFailure(
  error: unknown,
  context: GroupGuestsFailureContext = {},
): RegistrationFailure {
  ensureEventRegistrationI18n();
  const { head, tail } = splitMessage(error);

  if (isGroupGuestRefusal(head)) {
    if (head === "group_too_large") {
      const max = context.maxSize;
      return typeof max === "number" && Number.isInteger(max) && max > 0
        ? { key: `${GROUP_PREFIX}groupTooLargeMax`, params: { max } }
        : { key: `${GROUP_PREFIX}groupTooLarge`, params: {} };
    }
    if (head === "already_registered") {
      // Ogon to adres gościa (`RAISE EXCEPTION 'already_registered: %', v_email`)
      // - bez niego kupujący zgadywałby, którą osobę z listy usunąć.
      return tail === ""
        ? { key: `${GROUP_PREFIX}alreadyRegisteredUnknown`, params: {} }
        : { key: `${GROUP_PREFIX}alreadyRegistered`, params: { email: tail } };
    }
    return { key: `${GROUP_PREFIX}${camel(head)}`, params: {} };
  }

  const fallback = registrationFailure(error);
  return fallback.key === `${PREFIX}unknown`
    ? { key: `${GROUP_PREFIX}unknown`, params: {} }
    : fallback;
}
