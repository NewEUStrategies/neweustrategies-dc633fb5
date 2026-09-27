// Molekula: "Twoje miejsce na sali" w panelu uczestnika (zakladka rejestracji).
//
// TYLKO DLA ZALOGOWANYCH - panel "Moje" renderuje ja wylacznie w galezi
// z sesja, wiec pod SSR (zawsze anonimowym) nie powstaje ani jedno zapytanie.
//
// PUSTO = NIC NIE RYSUJEMY, jak na stronie biletu (`TicketSeatCards`) - z jednym
// wyjatkiem: zgloszenie zajmuje miejsce (approved|attended|no_show), plan jest
// opublikowany, a miejsca jeszcze nie ma. Tylko wtedy zdanie "organizator nie
// przydzielil Ci jeszcze miejsca" jest prawda. Zgloszenie oczekujace, wydarzenie
// bez planu sali albo plan w szkicu - sekcji nie ma wcale (20260927001200).
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { MySeatCardView } from "@/components/events/participant/molecules/MySeatCardView";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMySeats } from "@/lib/events/useMySeats";
import { ensureEventSeatingI18n } from "@/lib/i18n-event-seating";

ensureEventSeatingI18n();

export function MySeatsPanel({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const titleId = useId();
  const seats = useMySeats(slug, true);
  const cards = seats.data?.cards ?? [];
  const awaitingSeat = seats.data?.seatable === true && seats.data.hasPublishedPlan;
  if (!seats.isLoading && !seats.isError && cards.length === 0 && !awaitingSeat) return null;

  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-base font-semibold text-foreground">
        {t("eventSeating.card.title")}
      </h2>
      {seats.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t("eventSeating.card.loading")}</span>
          <Skeleton className="h-40 w-full rounded-[6px]" />
        </div>
      ) : seats.isError ? (
        <div className="space-y-2 rounded-[6px] border border-border p-4" role="alert">
          <p className="text-sm text-muted-foreground">{t("eventSeating.card.error")}</p>
          <Button size="sm" variant="outline" onClick={() => void seats.refetch()}>
            {t("eventSeating.card.retry")}
          </Button>
        </div>
      ) : cards.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("eventSeating.card.none")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <MySeatCardView key={card.mapId} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
