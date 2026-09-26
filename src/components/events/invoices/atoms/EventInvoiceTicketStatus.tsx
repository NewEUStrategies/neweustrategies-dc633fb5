// Atom: stan FAKTURY przy bilecie w "Moich zgloszeniach" (/profile/tickets).
//
// Jedno zdanie z odnosnikiem do /profile/invoices: numer wystawionej faktury,
// przyjeta prosba albo informacja, ze o fakture mozna jeszcze poprosic.
// Karty wszystkich biletow czytaja TEN SAM klucz React Query, wiec lista
// z dziesiecioma biletami robi jedno zapytanie, nie dziesiec. Zanim dane
// przyjda (i dla biletow bez platnosci) atom nie rysuje niczego.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useMyInvoiceSources } from "@/lib/events/useMyEventInvoices";
import { ensureEventInvoicesI18n } from "@/lib/i18n-event-invoices";

export function EventInvoiceTicketStatus({ registrationId }: { registrationId: string }) {
  ensureEventInvoicesI18n();
  const { t } = useTranslation();
  const { session } = useAuth();
  const sourcesQ = useMyInvoiceSources(session !== null);
  const row = (sourcesQ.data ?? []).find(
    (item) => item.source_kind === "registration" && item.source_id === registrationId,
  );
  if (row === undefined) return null;
  const sentence =
    row.invoice_number !== null
      ? t("eventInvoices.ticket.invoiced", { number: row.invoice_number })
      : row.request_status === "pending"
        ? t("eventInvoices.ticket.requested")
        : row.can_request && row.payment_state === "paid"
          ? t("eventInvoices.ticket.requestable")
          : null;
  if (sentence === null) return null;
  return (
    <Link
      to="/profile/invoices"
      className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
      {sentence}
    </Link>
  );
}
