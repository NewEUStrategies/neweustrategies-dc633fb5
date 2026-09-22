// Organizm: bilet z kodem QR otwierany z maila `event_ticket_issued`
// (`/events/<slug>/ticket#t=<kod>&m=<klucz>`).
//
// KOD CZYTAMY Z FRAGMENTU, PO MONTAŻU. Fragment adresu nie dociera do serwera
// (ani do renderu SSR, ani do logów), więc kod wejścia - poświadczenie przy
// bramce - zostaje wyłącznie w przeglądarce. QR rysujemy lokalnie, tą samą
// biblioteką co karta biletu RSVP i identyfikatory z druku; obrazek koduje
// SAM kod, bo tak czyta go skaner (`event_checkin_record` szuka po skrócie).
//
// STRONA NICZEGO NIE ZMIENIA. Otwarcie biletu tylko go pokazuje - rezygnacja
// jest na osobnej stronie zarządzania (dla gościa grupy link stoi niżej).
//
// NAGŁÓWEK Z PUBLICZNEGO `event_page_header` po slugu, jak w samoobsłudze
// zgłoszenia: kod nie wyjeżdża do żadnego zapytania.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, QrCode } from "lucide-react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchEventPageHeader } from "@/lib/community/publicQueries";
import { formatEventDateTime } from "@/lib/events/timezone";
import { manageLinkPath, readTicketFragment, type TicketFragment } from "@/lib/events/manageToken";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { ensureEventRegistrationI18n } from "@/lib/i18n-event-registration";

ensureEventRegistrationI18n();

export function EventTicketCodePanel({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  // `undefined` = fragment jeszcze nieprzeczytany (pierwszy render), `null` = brak kodu.
  const [ticket, setTicket] = useState<TicketFragment | null | undefined>(undefined);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setTicket(readTicketFragment(window.location.hash));
  }, []);

  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    void QRCode.toDataURL(ticket.qrToken, { width: 320, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [ticket]);

  const headerQuery = useQuery({
    queryKey: ["event-page-header", slug, "ticket"],
    queryFn: () => fetchEventPageHeader(slug),
    staleTime: 60_000,
  });
  const header = headerQuery.data ?? null;
  const eventTitle = pickLocalized(
    { title_pl: header?.title_pl ?? null, title_en: header?.title_en ?? null },
    "title",
    lang,
  );
  const when = header === null ? "" : formatEventDateTime(header.starts_at, header.timezone, lang);

  if (ticket === undefined) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mx-auto h-72 w-72" />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <QrCode className="h-6 w-6 text-primary" aria-hidden="true" />
          {t("eventRegistration.ticketPage.title")}
        </h1>
        {eventTitle !== "" && <p className="text-base font-medium text-foreground">{eventTitle}</p>}
        {when !== "" && <p className="text-sm text-muted-foreground">{when}</p>}
      </header>

      {ticket === null ? (
        <div className="space-y-2 rounded-[6px] border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            {t("eventRegistration.ticketPage.missingTitle")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("eventRegistration.ticketPage.missingBody")}
          </p>
        </div>
      ) : (
        <div className="space-y-4 rounded-[6px] border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("eventRegistration.ticketPage.lead")}</p>
          {/* Białe tło także w trybie ciemnym - skaner czyta ciemne moduły na jasnym. */}
          <div className="mx-auto flex h-72 w-72 items-center justify-center rounded-[6px] bg-white p-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={t("eventRegistration.ticketPage.qrAlt")}
                className="h-full w-full"
              />
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </div>
          <div className="space-y-1 text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("eventRegistration.ticketPage.codeLabel")}
            </p>
            <p className="break-all font-mono text-sm text-foreground">{ticket.qrToken}</p>
            <p className="text-xs text-muted-foreground">
              {t("eventRegistration.ticketPage.codeHint")}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("eventRegistration.ticketPage.private")}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ticket?.manageToken ? (
          <Button asChild variant="outline">
            <a href={manageLinkPath(slug, ticket.manageToken)}>
              {t("eventRegistration.ticketPage.manage")}
            </a>
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link to="/events/$slug" params={{ slug }}>
            {t("eventRegistration.actions.back")}
          </Link>
        </Button>
      </div>
    </section>
  );
}
