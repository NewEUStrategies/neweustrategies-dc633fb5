// Molekula: "Twoje miejsce na sali" w panelu uczestnika (zakladka rejestracji).
//
// TYLKO DLA ZALOGOWANYCH - panel "Moje" renderuje ja wylacznie w galezi
// z sesja, wiec pod SSR (zawsze anonimowym) nie powstaje ani jedno zapytanie.
// Pusty wynik to nie blad: organizator moze jeszcze nie opublikowac planu,
// a uczestnik ma wiedziec, ze miejsce "pojawi sie tutaj".
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
      ) : (seats.data ?? []).length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("eventSeating.card.none")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(seats.data ?? []).map((card) => (
            <MySeatCardView key={card.mapId} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
