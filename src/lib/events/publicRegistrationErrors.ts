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
// zgłoszenia prowadzącego na TYM koncie", a nie „nie ma wydarzenia".
// Słownik zapisu prowadzącego podsuwał więc zdanie nieprawdziwe albo ogólne
// „Nie udało się zapisać" - choć zgłoszenie kupującego już stało w bazie.
//
// ADRES GOŚCIA NIE WYCHODZI NIGDY (R38). Gość z zapisem na wydarzenie jest
// pomijany bez śladu w odpowiedzi; stara baza (okno wdrożenia) odpowiadała
// `already_registered: <email>` - zdanie nie powtarza adresu, nawet gdy ogon
// dotrze.
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

const CANCEL_PREFIX = "eventRegistration.cancelRefund.errors.";

/**
 * Odmowa REZYGNACJI -> zdanie. Ten sam słownik co zapis, z jednym wyjątkiem:
 * `event_ended` przy zapisie znaczy „zapisy zamknięte", a przy rezygnacji
 * „po wydarzeniu nie odwołasz zgłoszenia - w sprawie wpłaty napisz do
 * organizatora" (REG-13). Słowa z `cancelRefund.errors` wygrywają, reszta
 * spada do `registrationErrorMessage`.
 */
export function cancellationFailure(error: unknown): RegistrationFailure {
  ensureEventRegistrationI18n();
  const { head } = splitMessage(error);
  if (/^[a-z][a-z0-9_]*$/.test(head)) {
    const candidate = `${CANCEL_PREFIX}${camel(head)}`;
    if (i18n.exists(candidate)) return { key: candidate, params: {} };
  }
  return registrationFailure(error);
}

/** Gotowe zdanie odmowy rezygnacji (toast, pole błędu ekranu po zapisie). */
export function cancellationErrorMessage(error: unknown): string {
  const failure = cancellationFailure(error);
  return i18n.t(failure.key, failure.params);
}

const INVITE_PREFIX = "eventRegistration.invite.errors.";

/**
 * Każdy `RAISE EXCEPTION` z `event_register_group_guests` (ostatnia definicja:
 * migracja `20261012130000_event_ticket_seat_ledger.sql`), w kolejności
 * sprawdzeń w funkcji. Lista jest jawna, a nie wyliczana z `i18n.exists`, żeby
 * test mógł dowieść, że KAŻDA odmowa tej funkcji ma zdanie w obu językach.
 */
export const GROUP_GUEST_REFUSALS = [
  "account_required",
  "rate_limited",
  "invalid_guests",
  "group_too_large",
  "invalid_name",
  "invalid_email",
  "duplicate_guest",
  "not_found",
  "event_ended",
  "registration_closed",
  "already_settled",
  // TIX-03: kasa tego zgłoszenia jest otwarta - jej kwota policzyła już
  // miejsca, więc gość dopisany teraz nie byłby opłacony.
  "checkout_in_progress",
  "group_not_enabled",
  "sold_out",
] as const;

/**
 * Odmowy STAREJ bazy (okno wdrożenia „najpierw kod", przed 20261012180300):
 * `already_registered: <email>`. Nowa baza ich nie zna - gościa z zapisem
 * pomija - ale funkcja serwerowa woła starą funkcję przy PGRST202/42883, więc
 * kod ma zdanie, które NIE powtarza adresu.
 */
export const GROUP_GUEST_LEGACY_REFUSALS = ["already_registered"] as const;

export type GroupGuestRefusal = (typeof GROUP_GUEST_REFUSALS)[number];

function isGroupGuestRefusal(head: string): head is GroupGuestRefusal {
  return GROUP_GUEST_REFUSALS.some((known) => known === head);
}

/**
 * Czy baza odmówiła dopisania gości limitem grupy biletu (`group_too_large`).
 *
 * Tylko przy tej odmowie wołający czyta limit od nowa: formularz tnie listę
 * do limitu znanego przy otwarciu strony, więc odmowa znaczy, że limit w
 * bazie jest już NIŻSZY - i liczba z formularza byłaby w zdaniu nieprawdą.
 */
export function isGroupTooLarge(error: unknown): boolean {
  return splitMessage(error).head === "group_too_large";
}

export interface GroupGuestsFailureContext {
  /**
   * Limit grupy biletu (prowadzący + goście), gdy wołający go zna. Baza mówi
   * samo `group_too_large`, a kupujący musi wiedzieć, ilu gości usunąć.
   *
   * Musi to być limit przeczytany PO odmowie (patrz `isGroupTooLarge`), a nie
   * ten z chwili otwarcia formularza - tamten lista gości już spełnia.
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
  const { head } = splitMessage(error);

  if (isGroupGuestRefusal(head)) {
    if (head === "group_too_large") {
      const max = context.maxSize;
      return typeof max === "number" && Number.isInteger(max) && max > 0
        ? { key: `${GROUP_PREFIX}groupTooLargeMax`, params: { max } }
        : { key: `${GROUP_PREFIX}groupTooLarge`, params: {} };
    }
    return { key: `${GROUP_PREFIX}${camel(head)}`, params: {} };
  }
  // Stara baza: adres gościa z ogona NIE trafia do zdania (R38) - adres
  // czyjegoś zapisu to dokładnie to, czego odpowiedź nie może zdradzać.
  if (head === "already_registered") {
    return { key: `${GROUP_PREFIX}alreadyRegisteredUnknown`, params: {} };
  }

  const fallback = registrationFailure(error);
  return fallback.key === `${PREFIX}unknown`
    ? { key: `${GROUP_PREFIX}unknown`, params: {} }
    : fallback;
}
