// Potwierdzenie rezerwacji na stronie wydarzenia: numer potwierdzenia, termin,
// miejsce, kwota, numer transakcji, zdanie o tym, gdzie jest kod wejścia,
// i pobranie potwierdzenia jako pliku.
//
// BEZ KODU QR (REG-12). Dawniej karta rysowała QR z numerem `NES-XXXX-XXXX`
// (adres `?ticket=`), którego skaner przy bramce nie zna: każdy taki skan był
// „nieznanym kodem" liczonym do blokady urządzenia. Prawdziwy kod wejścia
// (losowy, 32 znaki) wydaje baza zgłoszeniu rozliczonemu i wysyła mailem
// „Twój bilet" - karta mówi, gdzie go szukać (`ticket.entry`), i odsyła do
// listy zgłoszeń w profilu.
//
// Dane pochodzą wyłącznie z backendu (`getMyEventTicket`, RLS na własnym
// wierszu RSVP, zamówieniu i zgłoszeniu) - komponent niczego nie wylicza
// z ceny klienta.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Download, Info, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyEventTicket } from "@/lib/events/ticket.functions";
import type { TicketEntryMode } from "@/lib/events/ticketTypes";
import { formatMoney } from "@/lib/billing/types";
import { buildTicketDocument, downloadTicketDocument } from "./ticketDocument";

export interface EventTicketCardProps {
  eventId: string;
  lang: "pl" | "en";
  /** Pokazujemy kartę dopiero, gdy backend potwierdził wejściówkę. */
  enabled: boolean;
}

/** Tryb wejścia -> zdanie (literały kluczy dla bramki słowników). */
const ENTRY_KEYS: Record<TicketEntryMode, string> = {
  emailed_qr: "community.events.ticket.entryEmailedQr",
  qr_pending: "community.events.ticket.entryQrPending",
  contact_organizer: "community.events.ticket.entryContactOrganizer",
  guest_list: "community.events.ticket.entryGuestList",
};

export function EventTicketCard({ eventId, lang, enabled }: EventTicketCardProps) {
  const { t } = useTranslation();
  const loadTicket = useServerFn(getMyEventTicket);

  const ticketQ = useQuery({
    queryKey: ["event-ticket", eventId],
    queryFn: () => loadTicket({ data: { eventId } }),
    enabled: enabled && !!eventId,
    staleTime: 60_000,
  });

  const ticket = ticketQ.data ?? null;
  if (!enabled || !ticket) return null;

  const title = (lang === "en" ? ticket.titleEn : ticket.titlePl) || ticket.titlePl;
  const dateLabel = ticket.startsAt
    ? new Date(ticket.startsAt).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : null;

  const rows: Array<{ label: string; value: string }> = [
    { label: t("community.events.ticket.code"), value: ticket.code },
  ];
  if (dateLabel) rows.push({ label: t("community.events.ticket.date"), value: dateLabel });
  if (ticket.location) {
    rows.push({ label: t("community.events.ticket.place"), value: ticket.location });
  }
  if (ticket.holderName) {
    rows.push({ label: t("community.events.ticket.holder"), value: ticket.holderName });
  }
  if (ticket.amountCents) {
    rows.push({
      label: t("community.events.ticket.amount"),
      value: formatMoney(ticket.amountCents, ticket.currency ?? "PLN", lang),
    });
  }
  if (ticket.transactionId) {
    rows.push({ label: t("community.events.ticket.transaction"), value: ticket.transactionId });
  }

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ticket className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("community.events.ticket.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="inline-flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {t("community.events.ticket.confirmed")}
        </p>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="break-words text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {t(ENTRY_KEYS[ticket.entry])}{" "}
              {ticket.entry === "emailed_qr" && (
                <>
                  <Link to="/profile/tickets" className="text-primary hover:underline">
                    {t("community.events.ticket.myRegistrations")}
                  </Link>
                  .
                </>
              )}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t("community.events.ticket.notEntryCode")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            downloadTicketDocument(
              buildTicketDocument({ ticket, lang, title, dateLabel }),
              `${ticket.code}.html`,
            )
          }
        >
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {t("community.events.ticket.download")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("community.events.ticket.hint")}</p>
      </CardContent>
    </Card>
  );
}
