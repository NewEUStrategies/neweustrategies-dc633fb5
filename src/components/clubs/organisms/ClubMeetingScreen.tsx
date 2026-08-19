// Organizm: strona jednego spotkania klubu.
//
// PO CO OSOBNA TRASA. Kalendarz odpowiada na pytanie "co mnie czeka" i musi
// pokazać dwadzieścia wpisów naraz, więc o każdym mówi jednym wierszem.
// Decyzja "idę / nie idę" zapada natomiast przy JEDNYM wydarzeniu i potrzebuje
// rzeczy, których w wierszu nie ma: opisu, pełnej listy potwierdzonych,
// adresu pokoju i drogi do rozmowy, z której to spotkanie wyrosło.
//
// LISTA POTWIERDZONYCH JEST TREŚCIĄ, NIE OZDOBĄ. To jest jedyny powód, dla
// którego ta strona istnieje osobno: ludzie przychodzą do ludzi, nie do
// tematu. Dlatego "będę" i "może" stoją w DWÓCH grupach - lista, która je
// miesza, przestaje być powodem, żeby przyjść.
//
// LICZBA I NAZWISKA TO DWIE RÓŻNE INFORMACJE. `going_count` z wiersza
// wydarzenia liczy wszystkich; lista nazwisk pomija osoby, które ukryły się
// w katalogu (`profiles.discoverable`). Różnica jest widoczna i zamierzona -
// klub mówi "siedem osób", a wypisuje pięć, bo dwie o to prosiły.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarClock, MapPin, MessagesSquare, Users2, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClubErrorNotice } from "@/components/clubs/molecules/ClubErrorNotice";
import { ClubPersonCard } from "@/components/clubs/molecules/ClubPersonCard";
import {
  ClubEventKindIcon,
  clubEventToneClass,
} from "@/components/clubs/atoms/ClubWorkspaceBadges";
import { MessageOrConnectButton } from "@/components/network/MessageOrConnectButton";
import { useClubEvent, useClubEventAttendees } from "@/lib/clubs/useClubNetwork";
import { useClubEventRsvp } from "@/lib/clubs/useClubWorkspace";
import { toEventKind, type ClubRsvpState } from "@/lib/clubs/workspaceTypes";
import { formatDate, uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

const RSVP_STATES: readonly ClubRsvpState[] = ["going", "maybe", "declined"];

export function ClubMeetingScreen({
  clubId,
  clubSlug,
  eventSlug,
  canRsvp,
  canSeeMembers,
}: {
  clubId: string;
  clubSlug: string;
  eventSlug: string;
  canRsvp: boolean;
  canSeeMembers: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const eventQ = useClubEvent({ clubId, slug: eventSlug });
  const event = eventQ.data ?? null;
  const attendeesQ = useClubEventAttendees({
    clubId,
    eventId: event?.id,
    limit: 50,
    enabled: canSeeMembers && event !== null,
  });
  const rsvp = useClubEventRsvp(clubId);

  if (eventQ.isError) return <ClubErrorNotice onRetry={() => void eventQ.refetch()} />;

  if (eventQ.isPending) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />;
  }

  if (event === null) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-10 text-center">
        <CalendarClock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">{t("club.network.meeting.notFound")}</p>
        <Button asChild variant="outline" size="sm" className="mt-4 rounded-lg">
          <Link to="/club/$clubSlug/calendar" params={{ clubSlug }}>
            {t("club.network.meeting.toCalendar")}
          </Link>
        </Button>
      </div>
    );
  }

  const kind = toEventKind(event.kind);
  const attendees = attendeesQ.data ?? [];
  const going = attendees.filter((row) => row.state === "going");
  const maybe = attendees.filter((row) => row.state === "maybe");
  const description = pickLocalized(event, "description", lang);
  const cancelled = event.status === "cancelled";

  return (
    <div className="space-y-4">
      <section
        className={cn(
          "rounded-lg border border-border/60 bg-card p-4 sm:p-6",
          cancelled && "opacity-80",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
              clubEventToneClass(kind),
            )}
          >
            <ClubEventKindIcon kind={kind} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="rounded-lg text-[10px]">
                {t(`club.calendar.kind.${kind}`)}
              </Badge>
              {cancelled ? (
                <Badge
                  variant="outline"
                  className="rounded-lg border-destructive/40 text-[10px] text-destructive"
                >
                  {t("club.calendar.status.cancelled")}
                </Badge>
              ) : null}
            </div>
            <h2 className="mt-1.5 text-xl font-semibold leading-tight sm:text-2xl">
              {pickLocalized(event, "title", lang)}
            </h2>

            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <CalendarClock
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div>
                  <dt className="sr-only">{t("club.network.meeting.when")}</dt>
                  <dd>
                    {formatDate(event.starts_at, lang, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      hour: event.all_day ? undefined : "2-digit",
                      minute: event.all_day ? undefined : "2-digit",
                    })}
                    {event.ends_at !== null && !event.all_day ? (
                      <>
                        {" - "}
                        {formatDate(event.ends_at, lang, { hour: "2-digit", minute: "2-digit" })}
                      </>
                    ) : null}
                  </dd>
                </div>
              </div>

              {event.location !== null && event.location.trim() !== "" ? (
                <div className="flex items-start gap-2">
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <dt className="sr-only">{t("club.network.meeting.where")}</dt>
                    <dd className="break-words">{event.location}</dd>
                  </div>
                </div>
              ) : null}
            </dl>

            {description !== null && description.trim() !== "" ? (
              <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {event.meeting_url !== null && event.meeting_url.trim() !== "" ? (
                <Button asChild size="sm" className="rounded-lg">
                  <a href={event.meeting_url} target="_blank" rel="noreferrer">
                    <Video className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t("club.network.meeting.join")}
                  </a>
                </Button>
              ) : null}
              {/* Rozmowa, z której to spotkanie wyrosło - jeśli istnieje.
                  To jest ten sam dowód proweniencji, co przy dorobku. */}
              {event.thread_slug !== null ? (
                <Button asChild variant="outline" size="sm" className="rounded-lg">
                  <Link
                    to="/club/$clubSlug/t/$threadSlug"
                    params={{ clubSlug, threadSlug: event.thread_slug }}
                  >
                    <MessagesSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t("club.network.meeting.toThread")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {canRsvp && event.rsvp_enabled && !cancelled ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            <p className="text-xs font-medium text-muted-foreground">
              {t("club.network.meeting.rsvpLabel")}
            </p>
            <div
              role="radiogroup"
              aria-label={t("club.network.meeting.rsvpLabel")}
              className="mt-1.5 flex flex-wrap gap-2"
            >
              {RSVP_STATES.map((state) => {
                const active = event.my_rsvp === state;
                return (
                  <button
                    key={state}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={rsvp.isPending}
                    onClick={() =>
                      rsvp.mutate(
                        { eventId: event.id, state },
                        { onError: () => toast.error(t("club.network.meeting.rsvpFailed")) },
                      )
                    }
                    className={cn(
                      "inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground dark:bg-primary/15 dark:text-foreground"
                        : "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {t(`club.calendar.rsvp.${state}`)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* KTO BĘDZIE - powód istnienia tej strony. */}
      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Users2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("club.network.meeting.whoTitle")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("club.network.meeting.goingCount", { count: event.going_count })}
          {event.capacity !== null
            ? ` - ${t("club.network.meeting.capacity", { count: event.capacity })}`
            : ""}
        </p>

        {!canSeeMembers ? (
          <p className="mt-3 rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {t("club.network.meeting.namesHidden")}
          </p>
        ) : attendeesQ.isPending ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-busy="true">
            {[0, 1].map((index) => (
              <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/50" />
            ))}
          </div>
        ) : attendees.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            {t("club.network.meeting.nobodyYet")}
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {going.length > 0 ? (
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("club.calendar.rsvp.going")}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {going.map((row) => (
                    <li key={row.user_id}>
                      <ClubPersonCard
                        name={row.display_name}
                        avatarUrl={row.avatar_url}
                        profileSlug={row.profile_slug}
                        headline={row.headline}
                        meta={row.is_me ? t("club.network.meeting.you") : undefined}
                        actions={
                          row.is_me ? undefined : (
                            <DirectMessageButton
                              userId={row.user_id}
                              displayName={row.display_name}
                              displayAvatar={row.avatar_url}
                              compact
                            />
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {maybe.length > 0 ? (
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("club.calendar.rsvp.maybe")}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {maybe.map((row) => (
                    <li key={row.user_id}>
                      <ClubPersonCard
                        name={row.display_name}
                        avatarUrl={row.avatar_url}
                        profileSlug={row.profile_slug}
                        headline={row.headline}
                        className="opacity-80"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
