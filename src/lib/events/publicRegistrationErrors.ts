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
import i18n from "@/lib/i18n";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

const PREFIX = "eventRegistration.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

export type RegistrationErrorParams = Record<string, string | number>;

export interface RegistrationFailure {
  /** Pełny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: RegistrationErrorParams;
}

/** Ile rzeczy brakuje - z listy kluczy albo z liczby w ogonie komunikatu. */
function paramsOf(head: string, tail: string): RegistrationErrorParams {
  const trimmed = tail.trim();
  if (trimmed === "") return {};
  if (head === "missing_required_fields" || head === "terms_required") {
    const items = trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return items.length > 0 ? { count: items.length } : {};
  }
  const numbers = trimmed.match(/\d+/g) ?? [];
  return numbers[0] === undefined ? {} : { count: Number(numbers[0]) };
}

export function registrationFailure(error: unknown): RegistrationFailure {
  ensureEventRegistrationI18n();
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  const tail = separator === -1 ? "" : message.slice(separator + 1);

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
