// Warstwa danych KUPUJACEGO: prosba o fakture za wlasne zamowienie
// i wlasne wystawione dokumenty.
//
// PLASZCZYZNA PUBLICZNA. Wszystkie funkcje biora najemce z hosta
// (`public_tenant_id()`) i wlasciciela z sesji (`auth.uid()`); to baza
// sprawdza, ze zapis albo zamowienie pakietu nalezy do wolajacego, i ona
// pilnuje terminu prosby (do konca trzeciego miesiaca po miesiacu zaplaty).
// Modul nie importuje niczego z panelu - trafia do publicznego pakietu
// (krok platnosci, zakup pakietu, profil).
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { parseInvoiceDocument, type EventInvoiceDocument } from "@/lib/events/eventInvoiceDocument";
import { buyerDraftToPayload, type InvoiceBuyerDraft } from "@/lib/events/eventInvoiceBuyerDraft";

type Fns = Database["public"]["Functions"];

export type MyInvoiceSourceRow = Fns["event_my_invoice_sources"]["Returns"][number];
export type MyInvoiceRow = Fns["event_my_invoices"]["Returns"][number];

export async function fetchMyInvoiceSources(): Promise<MyInvoiceSourceRow[]> {
  const { data, error } = await supabase.rpc("event_my_invoice_sources");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMyInvoices(): Promise<MyInvoiceRow[]> {
  const { data, error } = await supabase.rpc("event_my_invoices");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMyInvoice(id: string): Promise<EventInvoiceDocument> {
  const { data, error } = await supabase.rpc("event_my_invoice", { p_id: id });
  if (error) throw new Error(error.message);
  const doc = parseInvoiceDocument(data);
  if (doc === null) throw new Error("unknown: document response is not readable");
  return doc;
}

export type InvoiceRequestTarget = { registrationId: string } | { packageOrderId: string };

export async function saveInvoiceRequest(
  target: InvoiceRequestTarget,
  buyer: InvoiceBuyerDraft,
): Promise<string> {
  const source =
    "registrationId" in target
      ? { registration_id: target.registrationId }
      : { package_order_id: target.packageOrderId };
  const { data, error } = await supabase.rpc("event_invoice_request_save", {
    p_payload: { ...source, buyer: buyerDraftToPayload(buyer) },
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function cancelInvoiceRequest(requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("event_invoice_request_cancel", {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  return String(data);
}
