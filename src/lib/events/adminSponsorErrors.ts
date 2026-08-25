// Odmowy bazy w panelu sponsorow -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W AGENDZIE, INNY NAMESPACE. Klucz siedzi w glowie
// komunikatu plpgsql (`tier_full: tier allows 3 company(ies), 3 already pinned`),
// a liczby z ogona wchodza do interpolacji - plpgsql nie ma innego kanalu na
// parametry wyjatku niz tekst komunikatu.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, zeby organizator nie
// czytal `23514` ani „violates check constraint".
import i18n from "@/lib/i18n";
import { ensureSponsorsI18n } from "@/lib/i18n-admin-event-sponsors";

const PREFIX = "adminEventSponsors.errors.";

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

export type AdminSponsorErrorParams = Record<string, string | number>;

export interface AdminSponsorFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminSponsorErrorParams;
}

function paramsOf(tail: string): AdminSponsorErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminSponsorErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminSponsorFailure(error: unknown): AdminSponsorFailure {
  ensureSponsorsI18n();
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
export function adminSponsorErrorMessage(error: unknown): string {
  const failure = adminSponsorFailure(error);
  return i18n.t(failure.key, failure.params);
}
