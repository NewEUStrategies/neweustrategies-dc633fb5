// Organizm: MOJE WYDARZENIA w globalnym profilu - historia zapisów uczestnika.
//
// TA SAMA PRAWDA, CO „MOJE ZGŁOSZENIA". Obie powierzchnie czytają RPC
// `event_my_registrations` (jedno źródło: zapis + pieniądze + ślad webhooków).
// Różnica jest w PYTANIU: tam użytkownik pyta „co się stało z moją płatnością",
// tu - „gdzie ja właściwie byłem i gdzie będę". Dlatego ten ekran grupuje po
// kalendarzu, a szczegóły płatności zostawia karcie zgłoszenia.
//
// PODZIAŁ NA NADCHODZĄCE/MINIONE LICZY CZYSTA FUNKCJA (`groupMyEvents`) -
// testowalna bez sieci i bez DOM.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchMyRegistrations, type ParticipantRegistration } from "@/lib/events/participantTicketsApi";
import { awaitsPayment, groupMyEvents } from "@/lib/events/myEventsGrouping";
import { uiLang } from "@/lib/i18n/format";
import { ensureI18n } from "@/lib/i18n-cart";

ensureI18n();

const QUERY_KEY = ["profile", "event-registrations"] as const;

function EventRow({ item }: { item: ParticipantRegistration }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const locale = lang === "en" ? "en-GB" : "pl-PL";
  const title = (lang === "en" ? item.eventTitleEn : item.eventTitlePl) ?? item.eventSlug;
  const when =
    item.eventStartsAt === null
      ? t("myEvents.noDate")
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(item.eventStartsAt),
        );
  const unpaid = awaitsPayment(item);
  const free = item.amountCents === null || item.amountCents === 0;

  return (
    <li className="flex flex-col gap-3 rounded-[6px] border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          {when}
        </p>
        <Badge variant={unpaid ? "destructive" : "secondary"} className="rounded-[6px]">
          {free ? t("myEvents.free") : unpaid ? t("myEvents.unpaid") : t("myEvents.paid")}
        </Badge>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/events/$slug" params={{ slug: item.eventSlug }}>
            {t("myEvents.openEvent")}
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/events/$slug/me" params={{ slug: item.eventSlug }}>
            {t("myEvents.myPanel")}
          </Link>
        </Button>
        {unpaid && (
          <Button asChild size="sm">
            <Link to="/events/$slug" params={{ slug: item.eventSlug }} hash="tickets">
              <Ticket className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("myEvents.payNow")}
            </Link>
          </Button>
        )}
      </div>
    </li>
  );
}

function Group({ items, emptyLabel }: { items: ParticipantRegistration[]; emptyLabel: string }) {
  if (items.length === 0) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <EventRow key={item.registrationId} item={item} />
      ))}
    </ul>
  );
}

export function MyEventsPanel() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchMyRegistrations });
  const groups = useMemo(
    () => groupMyEvents(query.data ?? [], new Date()),
    [query.data],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{t("myEvents.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("myEvents.lead")}</p>
      </header>

      {query.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-[6px]" />
          <Skeleton className="h-24 w-full rounded-[6px]" />
        </div>
      )}

      {query.isError && (
        <p className="rounded-[6px] border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {t("myEvents.loadError")}
        </p>
      )}

      {query.isSuccess && (
        // Trzy koszyki kalendarza: nadchodzące, bieżące (trwają teraz) i przeszłe.
        // Domyślnie otwieramy „bieżące", gdy coś właśnie trwa - to jedyny moment,
        // w którym uczestnik ma pilną sprawę (wejście, agenda, QR).
        <Tabs defaultValue={groups.current.length > 0 ? "current" : "upcoming"} className="space-y-4">
          <TabsList>
            <TabsTrigger value="upcoming">{t("myEvents.tabs.upcoming")}</TabsTrigger>
            <TabsTrigger value="current">{t("myEvents.tabs.current")}</TabsTrigger>
            <TabsTrigger value="past">{t("myEvents.tabs.past")}</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming">
            <Group items={groups.upcoming} emptyLabel={t("myEvents.emptyUpcoming")} />
          </TabsContent>
          <TabsContent value="current">
            <Group items={groups.current} emptyLabel={t("myEvents.emptyCurrent")} />
          </TabsContent>
          <TabsContent value="past">
            <Group items={groups.past} emptyLabel={t("myEvents.emptyPast")} />
          </TabsContent>
        </Tabs>
      )}

      <p className="text-sm">
        <Link
          to="/profile/tickets"
          className="text-primary underline-offset-2 hover:underline"
        >
          {t("myEvents.manageTickets")}
        </Link>
      </p>
    </div>
  );
}
