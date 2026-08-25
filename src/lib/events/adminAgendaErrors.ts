// Odmowy bazy w panelu agendy -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W MODULE ZAPISOW, INNY NAMESPACE. Klucz siedzi w glowie
// komunikatu plpgsql (`capacity_over_room: seat limit 200 exceeds room capacity 120`),
// a liczby z ogona wchodza do interpolacji - PL/pgSQL nie ma innego kanalu na
// parametry wyjatku niz tekst komunikatu.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, zeby organizator nie
// czytal `23514` ani „violates check constraint".
import i18n from "@/lib/i18n";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";

const PREFIX = "adminEventAgenda.errors.";

/** `capacity_over_room` -> `capacityOverRoom`. Slownik camelCase, baza snake_case. */
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

export type AdminAgendaErrorParams = Record<string, string | number>;

export interface AdminAgendaFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminAgendaErrorParams;
}

function paramsOf(tail: string): AdminAgendaErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminAgendaErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminAgendaFailure(error: unknown): AdminAgendaFailure {
  // Bez rejestracji nakladki `i18n.exists()` odpowiada „nie ma" na kazdy klucz,
  // wiec kazda odmowa bazy spadalaby do `unknown`.
  ensureAgendaI18n();
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  const tail = separator === -1 ? "" : message.slice(separator + 1);

  if (!/^[a-z][a-z0-9_]*$/.test(head)) return { key: `${PREFIX}unknown`, params: {} };

  const candidate = `${PREFIX}${camel(head)}`;
  if (!i18n.exists(candidate)) return { key: `${PREFIX}unknown`, params: {} };
  return { key: candidate, params: paramsOf(tail) };
}

/** Gotowe zdanie dla toasta - komponent nie musi znac prefiksu ani parametrow. */
export function adminAgendaErrorMessage(error: unknown): string {
  const failure = adminAgendaFailure(error);
  return i18n.t(failure.key, failure.params);
}
