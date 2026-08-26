// Odmowy bazy w studiu wydarzenia -> zdanie po ludzku.
//
// TA SAMA MECHANIKA, CO W GRUPACH I SPONSORACH: klucz siedzi w glowie
// komunikatu plpgsql (`slug_taken: another event ...`), a ogon jest dla
// programisty. Nieznany klucz NIE udaje znanego - wracamy do `unknown`, zeby
// redaktor nie czytal „violates check constraint".
import i18n from "@/lib/i18n";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

const PREFIX = "adminEvents.studio.errors.";

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

/** Pelny klucz i18n - zawsze istnieje, w najgorszym razie `...unknown`. */
export function adminEventStudioErrorKey(error: unknown): string {
  ensureAdminEventsI18n();
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return `${PREFIX}unknown`;
  const candidate = `${PREFIX}${camel(head)}`;
  return i18n.exists(candidate) ? candidate : `${PREFIX}unknown`;
}

/** Gotowe zdanie dla toasta. */
export function adminEventStudioErrorMessage(error: unknown): string {
  return i18n.t(adminEventStudioErrorKey(error));
}
