// Widok mojego biletu na wydarzenie: kod QR do okazania przy wejściu,
// numer biletu, numer transakcji i pobranie potwierdzenia jako pliku.
//
// Dane pochodzą wyłącznie z backendu (`getMyEventTicket`, RLS na własnym
// wierszu RSVP i zamówieniu) - komponent niczego nie wylicza z ceny klienta.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Download, QrCode } from "lucide-react";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyEventTicket } from "@/lib/events/ticket.functions";
import { ticketQrPayload } from "@/lib/events/ticketCode";
import { formatMoney } from "@/lib/billing/types";
import { buildTicketDocument, downloadTicketDocument } from "./ticketDocument";

export interface EventTicketCardProps {
  eventId: string;
  lang: "pl" | "en";
  /** Pokazujemy bilet dopiero, gdy backend potwierdził wejściówkę. */
  enabled: boolean;
}

export function EventTicketCard({ eventId, lang, enabled }: EventTicketCardProps) {
  const { t } = useTranslation();
  const loadTicket = useServerFn(getMyEventTicket);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const ticketQ = useQuery({
    queryKey: ["event-ticket", eventId],
    queryFn: () => loadTicket({ data: { eventId } }),
    enabled: enabled && !!eventId,
    staleTime: 60_000,
  });

  const ticket = ticketQ.data ?? null;

  const qrPayload = useMemo(() => {
    if (!ticket || typeof window === "undefined") return null;
    return ticketQrPayload(window.location.origin, ticket.slug, ticket.code);
  }, [ticket]);

  useEffect(() => {
    if (!qrPayload) return;
    let cancelled = false;
    void QRCode.toDataURL(qrPayload, { width: 320, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [qrPayload]);

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
          <QrCode className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("community.events.ticket.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-[auto,1fr]">
        <div className="flex flex-col items-center gap-2">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={t("community.events.ticket.qrAlt", { code: ticket.code })}
              className="h-40 w-40 rounded-md border border-border bg-white p-2"
              width={160}
              height={160}
            />
          ) : (
            <div
              className="h-40 w-40 animate-pulse rounded-md border border-border bg-muted"
              aria-hidden="true"
            />
          )}
          <p className="font-mono text-xs tracking-wide text-muted-foreground">{ticket.code}</p>
        </div>

        <div className="space-y-3">
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
          <Button
            type="button"
            variant="outline"
            disabled={!qrDataUrl}
            onClick={() =>
              downloadTicketDocument(
                buildTicketDocument({ ticket, lang, title, dateLabel, qrDataUrl }),
                `${ticket.code}.html`,
              )
            }
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("community.events.ticket.download")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("community.events.ticket.hint")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
