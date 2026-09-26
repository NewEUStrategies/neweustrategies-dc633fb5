// Odmowy bazy w ekranie FAKTUR studia -> zdanie po ludzku.
//
// MECHANIKA JAK W RESZCIE STUDIA: klucz siedzi w glowie komunikatu plpgsql
// (`already_invoiced: an order already has an active invoice`), camelCase
// glowy wskazuje zdanie w `adminEventInvoices.errors.*`, a nieznana glowa
// spada do `unknown` - organizator nie czyta `23505` ani "violates check
// constraint".
//
// WYSCIG NA INDEKSIE UNIKALNYM. Dwaj administratorzy fakturujacy TO SAMO
// zamowienie naraz nie dostaja `already_invoiced` z ciala funkcji, tylko
// naruszenie czesciowego indeksu `event_invoice_sources_*_once` (glowa
// "duplicate key value ..."). To jest ta sama odmowa i dostaje to samo zdanie.
//
// BEZ PARAMETROW: mapa wola `t()` z samym kluczem (bramka "zdania bez
// interpolacji" w `eventErrorMapsI18n.gate.test.ts`).
import i18n from "@/lib/i18n";
import { ensureAdminEventInvoicesI18n } from "@/lib/i18n-admin-event-invoices";

const PREFIX = "adminEventInvoices.errors.";

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

export function adminEventInvoiceErrorKey(error: unknown): string {
  ensureAdminEventInvoicesI18n();
  const message = messageOf(error);
  if (/event_invoice_sources_[a-z_]+_once/.test(message)) return `${PREFIX}alreadyInvoiced`;
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return `${PREFIX}unknown`;
  const candidate = `${PREFIX}${camel(head)}`;
  return i18n.exists(candidate) ? candidate : `${PREFIX}unknown`;
}

/** Gotowe zdanie dla toasta. */
export function adminEventInvoiceErrorMessage(error: unknown): string {
  return i18n.t(adminEventInvoiceErrorKey(error));
}
