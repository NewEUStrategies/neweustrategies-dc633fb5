// Odmowy bazy w modulе on-site -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W SPONSORACH I AGENDZIE, INNY NAMESPACE. Klucz siedzi w
// glowie komunikatu plpgsql (`checkpoint_in_use: 12 check-in(s) recorded ...`),
// a liczby z ogona wchodza do interpolacji.
//
// TU STAWKA JEST WYZSZA NIZ GDZIE INDZIEJ: przy bramce operator czyta komunikat
// na oczach uczestnika. „device_locked" musi znaczyc „to urzadzenie jest
// chwilowo zablokowane", a nie „blad 42501".
import i18n from "@/lib/i18n";
import { ensureOnsiteI18n } from "@/lib/i18n-admin-event-onsite";

const PREFIX = "adminEventOnsite.errors.";

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

export type AdminOnsiteErrorParams = Record<string, string | number>;

export interface AdminOnsiteFailure {
  /** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
  key: string;
  params: AdminOnsiteErrorParams;
}

function paramsOf(tail: string): AdminOnsiteErrorParams {
  const numbers = tail.match(/\d+/g) ?? [];
  const out: AdminOnsiteErrorParams = {};
  if (numbers[0] !== undefined) out.count = Number(numbers[0]);
  if (numbers[1] !== undefined) out.total = Number(numbers[1]);
  return out;
}

export function adminOnsiteFailure(error: unknown): AdminOnsiteFailure {
  ensureOnsiteI18n();
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
export function adminOnsiteErrorMessage(error: unknown): string {
  const failure = adminOnsiteFailure(error);
  return i18n.t(failure.key, failure.params);
}
