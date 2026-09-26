// Molekula: MIEJSCE NA SALI na stronie biletu (`/events/<slug>/ticket#t=...`).
//
// KOD JEDZIE W CIELE JEDNEGO ODCZYTU, NIGDZIE INDZIEJ. Strona biletu nie ma
// sesji, wiec miejsce da sie wskazac tylko kodem z fragmentu adresu: kluczem
// samoobslugi `m` (gosc grupy) albo kodem QR `t`. Oba ida WYLACZNIE w ciele
// POST do `event_ticket_seats` (baza porownuje skrot SHA-256), nigdy w adresie
// zapytania, w kluczu cache ani w logach. Nieznany kod, inne wydarzenie
// i plan w szkicu daja te sama pusta odpowiedz - strona nie mowi, dlaczego.
//
// PUSTO = NIC NIE RYSUJEMY. Bilet bez miejsca (wydarzenie bez planu sali albo
// plan nieopublikowany) to normalny bilet; zdanie "miejsca brak" myliloby
// uczestnika wydarzenia bez numerowanych miejsc.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { MySeatCardView } from "@/components/events/participant/molecules/MySeatCardView";
import type { TicketFragment } from "@/lib/events/manageToken";
import { useTicketSeats } from "@/lib/events/useMySeats";
import { ensureEventSeatingI18n } from "@/lib/i18n-event-seating";

ensureEventSeatingI18n();

export function TicketSeatCards({ slug, ticket }: { slug: string; ticket: TicketFragment }) {
  const { t } = useTranslation();
  const titleId = useId();
  const seats = useTicketSeats(slug, ticket);
  const cards = seats.data ?? [];
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="space-y-2">
      <h2 id={titleId} className="text-base font-semibold text-foreground">
        {t("eventSeating.card.title")}
      </h2>
      {cards.map((card) => (
        <MySeatCardView key={card.mapId} card={card} />
      ))}
    </section>
  );
}
