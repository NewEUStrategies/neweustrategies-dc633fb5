// Odmowy powierzchni uczestnika (agenda, zapis na sesję, zakładki) -> zdanie
// z NASTĘPNYM KROKIEM.
//
// TA SAMA MECHANIKA CO W `publicRegistrationErrors`, inny słownik. Klucz stoi
// w głowie komunikatu plpgsql (`overlap_conflict: you are already signed up for
// "…"`), a ogon bywa TYTUŁEM CUDZEJ SESJI - nie wstawiamy go do zdania, bo
// tytuł przyjechał z bazy w jednym języku i w komunikacie po angielsku
// wyglądałby jak awaria tłumaczenia.
//
// NIEZNANY KLUCZ NIE UDAJE ZNANEGO: wracamy do `unknown`, żeby zamiast surowego
// „violates check constraint" pokazać zdanie, po którym da się działać.
import i18n from "@/lib/i18n";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

const PREFIX = "eventFront.errors.";

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

/**
 * Pełny klucz i18n odmowy - zawsze istnieje, w najgorszym razie `...unknown`.
 */
export function publicEventErrorKey(error: unknown): string {
  ensureEventFrontI18n();
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return `${PREFIX}unknown`;
  const candidate = `${PREFIX}${camel(head)}`;
  return i18n.exists(candidate) ? candidate : `${PREFIX}unknown`;
}

/** Gotowe zdanie do toasta albo paska nad kontrolką. */
export function publicEventErrorMessage(error: unknown): string {
  return i18n.t(publicEventErrorKey(error));
}
