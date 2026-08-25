// Odmowy bazy w panelu zapisow i biletow -> zdanie po ludzku.
//
// KLUCZ WYCIAGAMY Z GLOWY KOMUNIKATU, TAK JAK RZUCA GO PLPGSQL:
// `quota_below_sold: 12 seats are already taken`. Czlon przed dwukropkiem to
// kontrakt bazy; ogon jest dla logow - poza liczbami, ktore wchodza do zdania.
//
// LICZBA Z OGONA TRAFIA DO INTERPOLACJI. „Pula nie moze zejsc ponizej {{count}}
// zajetych miejsc" bez liczby klamie albo pokazuje pusta luke, a PL/pgSQL nie ma
// innego kanalu na parametry wyjatku niz tekst komunikatu.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown` zamiast pokazywac
// organizatorowi `42501` albo techniczna angielszczyzne.
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-admin-event-registration";

// Slownik modulu zapisow istnieje od migracji `20260823150000` i zna KAZDA
// wartosc jej CHECK-ow. Drugi, wlasny zestaw kluczy rozjechalby sie z nim przy
// pierwszej zmianie SQL-a, wiec mapper czyta ten sam namespace, co ekrany.
const PREFIX = "adminEventRegistration.errors.";

/** `quota_below_sold` -> `quotaBelowSold`. Slownik camelCase, baza snake_case. */
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

export type AdminRegistrationErrorParams = Record<string, string | number>;

export interface AdminRegistrationFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminRegistrationErrorParams;
}

function paramsOf(tail: string): AdminRegistrationErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminRegistrationErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminRegistrationFailure(error: unknown): AdminRegistrationFailure {
  // Bez rejestracji nakladki `i18n.exists()` odpowiada „nie ma" na kazdy klucz,
  // wiec kazda odmowa bazy spadalaby do `unknown`.
  ensureI18n();
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  const tail = separator === -1 ? "" : message.slice(separator + 1);

  // Tylko glowa wygladajaca na klucz techniczny. Bez tego warunku „Failed to
  // fetch" oddaloby klucz „Failed" i pokazalo go jako etykiete bledu.
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return { key: `${PREFIX}unknown`, params: {} };

  const candidate = `${PREFIX}${camel(head)}`;
  if (!i18n.exists(candidate)) return { key: `${PREFIX}unknown`, params: {} };
  return { key: candidate, params: paramsOf(tail) };
}

/** Gotowe zdanie dla toasta - komponent nie musi znac prefiksu ani parametrow. */
export function adminRegistrationErrorMessage(error: unknown): string {
  const failure = adminRegistrationFailure(error);
  return i18n.t(failure.key, failure.params);
}
