// Powiadomienie KUPUJACEGO o wystawionym dokumencie organizatora.
//
// GRANICA AUTORYZACJI JEST W BAZIE. Ladunek maila czyta
// `admin_event_invoice_notify_payload` KLIENTEM UZYTKOWNIKA (bramka
// `assert_event_admin_tenant()`), wiec funkcja serwerowa nie moze wyslac
// maila o cudzym dokumencie ani w imieniu redaktora. Najemca maila pochodzi
// z tego ladunku (czyli z bramki), nie z danych wejscia.
//
// KIEDY MILCZYMY: dokument nie jest wystawiony (szkic, anulowany), nabywca
// nie ma konta (odnosnik do profilu nic by mu nie dal - dokument przekazuje
// organizator), albo nie ma adresu. Mail nie ma zalacznika: PDF sklada
// profil kupujacego z migawki dokumentu.
//
// KLUCZ IDEMPOTENCJI `event-invoice:<id>:issued` - dwa klikniecia i ponowna
// proba po awarii wysylaja jeden mail.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { txCopy } from "@/lib/email-templates/tx-copy";
import { formatMoney } from "@/lib/billing/types";

export interface EventInvoiceNotice {
  invoiceId: string;
  tenantId: string;
  to: string;
  lang: "pl" | "en";
  subjectName: string;
  details: TxDetail[];
}

function text(value: Json | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Ladunek RPC -> tresc maila albo `null`, gdy nie ma do kogo albo o czym pisac. */
export function buildEventInvoiceNotice(payload: Json | null): EventInvoiceNotice | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.status !== "issued" || payload.has_account !== true) return null;
  const to = text(payload.recipient);
  const tenantId = text(payload.tenant_id);
  if (to === "" || tenantId === "") return null;
  const lang = payload.locale === "en" ? "en" : "pl";
  const labels = txCopy("event_invoice_issued", lang).labels;
  const title = lang === "en" ? text(payload.event_title_en) : text(payload.event_title_pl);
  const gross = typeof payload.gross_cents === "number" ? payload.gross_cents : 0;
  const details: TxDetail[] = [];
  if (title !== "") details.push({ label: labels.event, value: title });
  details.push({ label: labels.documentNumber, value: text(payload.number) });
  details.push({ label: labels.price, value: formatMoney(gross, text(payload.currency) || "PLN", lang) });
  return { invoiceId: text(payload.invoice_id), tenantId, to, lang, subjectName: title, details };
}

export interface EventInvoiceNotifyResult {
  sent: number;
  skipped: number;
  failed: number;
}

export async function notifyIssuedInvoices(
  supabase: SupabaseClient<Database>,
  invoiceIds: readonly string[],
): Promise<EventInvoiceNotifyResult> {
  const result: EventInvoiceNotifyResult = { sent: 0, skipped: 0, failed: 0 };
  const { sendTxEmail } = await import("@/lib/email/transactional.server");
  for (const id of invoiceIds) {
    const { data, error } = await supabase.rpc("admin_event_invoice_notify_payload", { p_id: id });
    if (error) {
      result.failed += 1;
      continue;
    }
    const notice = buildEventInvoiceNotice(data);
    if (notice === null) {
      result.skipped += 1;
      continue;
    }
    const sent = await sendTxEmail({
      type: "event_invoice_issued",
      to: notice.to,
      lang: notice.lang,
      subjectName: notice.subjectName,
      details: notice.details,
      ctaPath: "/profile/invoices",
      tenantId: notice.tenantId,
      idempotencyKey: `event-invoice:${notice.invoiceId}:issued`,
    });
    if (!sent.ok) result.failed += 1;
    else if (sent.skipped === undefined) result.sent += 1;
    else result.skipped += 1;
  }
  return result;
}
