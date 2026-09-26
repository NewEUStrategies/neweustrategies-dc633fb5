// Odmowy bazy przy PROSBIE O FAKTURE (kupujacy) -> zdanie po ludzku.
//
// Ta sama mechanika co mapy studia, ale WLASNA nakladka publiczna
// (`i18n-event-invoices`): krok platnosci i profil nie moga wciagac slownika
// panelu. Nieznana glowa = `eventInvoices.errors.unknown`.
import i18n from "@/lib/i18n";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";

const PREFIX = "eventInvoices.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

export function eventInvoiceErrorKey(error: unknown): string {
  ensureEventInvoicesI18n();
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return `${PREFIX}unknown`;
  const candidate = `${PREFIX}${camel(head)}`;
  return i18n.exists(candidate) ? candidate : `${PREFIX}unknown`;
}

export function eventInvoiceErrorMessage(error: unknown): string {
  return i18n.t(eventInvoiceErrorKey(error));
}
