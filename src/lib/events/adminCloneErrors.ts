// Odmowy bazy przy KLONIE EDYCJI -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W PLANIE SALI I SPONSORACH, INNY NAMESPACE. Klucz
// siedzi w glowie komunikatu plpgsql (`clone_sessions_outside_window: 3
// session(s) ...`), a liczby z ogona wchodza do interpolacji - PL/pgSQL nie ma
// innego kanalu na parametry wyjatku niz tekst komunikatu.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, zeby organizator nie
// czytal `23505` ani "violates check constraint".
import i18n from "@/lib/i18n";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

const PREFIX = "adminEventClone.errors.";

/** `slug_taken` -> `slugTaken`. Slownik camelCase, baza snake_case. */
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

export type AdminCloneErrorParams = Record<string, number>;

export interface AdminCloneFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminCloneErrorParams;
}

function paramsOf(tail: string): AdminCloneErrorParams {
  const first = /\d+/.exec(tail);
  return first === null ? {} : { count: Number(first[0]) };
}

export function adminCloneFailure(error: unknown): AdminCloneFailure {
  // Bez rejestracji nakladki `i18n.exists()` odpowiada "nie ma" na kazdy klucz.
  ensureCloneI18n();
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
export function adminCloneErrorMessage(error: unknown): string {
  const failure = adminCloneFailure(error);
  return i18n.t(failure.key, failure.params);
}
