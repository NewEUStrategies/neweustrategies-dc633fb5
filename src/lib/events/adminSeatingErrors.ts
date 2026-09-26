// Odmowy bazy w panelu PLANU SALI -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W AGENDZIE I SPONSORACH, INNY NAMESPACE. Klucz siedzi
// w glowie komunikatu plpgsql (`seats_in_use: 3 assigned seat(s) would be
// removed`), a liczby z ogona wchodza do interpolacji - PL/pgSQL nie ma innego
// kanalu na parametry wyjatku niz tekst komunikatu.
//
// TEN SAM SLOWNIK CZYTAJA KODY ODRZUTOW PRZYDZIALU ZBIORCZEGO. RPC
// `admin_event_seat_assign_batch` oddaje przy kazdej odrzuconej pozycji kod
// (`seat_taken`, `seat_held_for_other`...) - dokladnie te glowy, ktore
// pojedynczy przydzial podnosi jako wyjatek. Jedna mapa, jedno zdanie.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, zeby organizator nie
// czytal `23514` ani "violates check constraint".
import i18n from "@/lib/i18n";
import { ensureSeatingI18n } from "@/lib/i18n-admin-event-seating";

const PREFIX = "adminEventSeating.errors.";

/** `seats_in_use` -> `seatsInUse`. Slownik camelCase, baza snake_case. */
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

export type AdminSeatingErrorParams = Record<string, string | number>;

export interface AdminSeatingFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminSeatingErrorParams;
}

function paramsOf(tail: string): AdminSeatingErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminSeatingErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminSeatingFailure(error: unknown): AdminSeatingFailure {
  // Bez rejestracji nakladki `i18n.exists()` odpowiada "nie ma" na kazdy klucz.
  ensureSeatingI18n();
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
export function adminSeatingErrorMessage(error: unknown): string {
  const failure = adminSeatingFailure(error);
  return i18n.t(failure.key, failure.params);
}
