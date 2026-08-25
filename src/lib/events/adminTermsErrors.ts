// Odmowy bazy w panelu grup i zgod -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W SPONSORACH, INNY NAMESPACE. Klucz siedzi w glowie
// komunikatu plpgsql (`group_in_use: 3 registration(s)...`), a liczby z ogona
// wchodza do interpolacji - plpgsql nie ma innego kanalu na parametry wyjatku
// niz tekst komunikatu.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, zeby organizator nie
// czytal „violates check constraint".
import i18n from "@/lib/i18n";
import { ensureTermsI18n } from "@/lib/i18n-admin-event-terms";

const PREFIX = "adminEventTerms.errors.";

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

export type AdminTermsErrorParams = Record<string, string | number>;

export interface AdminTermsFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminTermsErrorParams;
}

function paramsOf(tail: string): AdminTermsErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminTermsErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminTermsFailure(error: unknown): AdminTermsFailure {
  ensureTermsI18n();
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
export function adminTermsErrorMessage(error: unknown): string {
  const failure = adminTermsFailure(error);
  return i18n.t(failure.key, failure.params);
}
