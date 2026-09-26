// Odmowy bazy na ekranie "Lejek Google Ads" -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W POZOSTALYCH MAPACH PANELU. Klucz siedzi w glowie
// komunikatu plpgsql (`invalid_cost_row: row 3 is invalid`), a liczby z ogona
// wchodza do interpolacji (`{{count}}` = numer wiersza wsadu) - plpgsql nie ma
// innego kanalu na parametry wyjatku niz tekst komunikatu.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, zeby organizator nie
// czytal `23514` ani "violates check constraint". Lista kodow jest pilnowana
// przez `eventErrorMapsI18n.gate.test.ts` (wpis `adminAdsFunnelErrors`).
import i18n from "@/lib/i18n";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

const PREFIX = "adminEventAdsFunnel.errors.";

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

export type AdminAdsFunnelErrorParams = Record<string, number>;

export interface AdminAdsFunnelFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminAdsFunnelErrorParams;
}

function paramsOf(tail: string): AdminAdsFunnelErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  return numbers[0] === undefined ? {} : { count: Number(numbers[0]) };
}

export function adminAdsFunnelFailure(error: unknown): AdminAdsFunnelFailure {
  ensureAdsFunnelI18n();
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
export function adminAdsFunnelErrorMessage(error: unknown): string {
  const failure = adminAdsFunnelFailure(error);
  return i18n.t(failure.key, failure.params);
}
