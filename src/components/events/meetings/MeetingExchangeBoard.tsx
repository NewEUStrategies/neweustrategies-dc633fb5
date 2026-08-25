// Organizm-scalajacy: PLASZCZYZNA UCZESTNIKA gieldy spotkan 1-1.
//
// BLOKADY SA STOPNIOWANE, A NIE BINARNE. Kazdy powod, dla ktorego uczestnik nie
// moze umawiac rozmow, ma inne nastepne dzialanie: "gielda nieskonfigurowana" -
// czekaj, "nie jestes zapisany" - zapisz sie, "zapisy zamkniete" - zglos
// dostepnosc juz teraz. Jeden komunikat "brak dostepu" kasowalby te roznice
// i generowal pytania do organizatora.
//
// PRZY ZAMKNIETYCH ZAPISACH EKRAN NADAL DZIALA. Zakladka dostepnosci i lista
// wlasnych spotkan sa czytelne zawsze, gdy uczestnik jest zapisany - zamkniete
// sa tylko NOWE zaproszenia, o czym mowi banner, a nie brak ekranu.
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MyAvailabilityPanel } from "@/components/events/meetings/MyAvailabilityPanel";
import { MyMeetingsPanel } from "@/components/events/meetings/MyMeetingsPanel";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { eventTimeZone } from "@/lib/events/timezone";
import { uiLang } from "@/lib/i18n/format";
import { meetingErrorI18nKey } from "@/lib/events/meetingsErrors";
import { exchangeBlock, exchangeIntro } from "@/lib/events/meetingExchange";
import { useMeetingExchange, useMyMeetings } from "@/lib/events/useMyMeetings";

export function MeetingExchangeBoard({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  const exchange = useMeetingExchange(slug);
  const meetings = useMyMeetings(slug);

  if (exchange.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (exchange.isError || exchange.data === undefined) {
    return (
      <FriendlyErrorPage
        variant="compact"
        error={exchange.error}
        title={t("eventMeetings.participant.heading")}
        footer={t(meetingErrorI18nKey(exchange.error))}
      />
    );
  }

  const state = exchange.data;
  const timezone = eventTimeZone({ timezone: state.timezone });
  const block = exchangeBlock(state);
  const intro = exchangeIntro(state, lang);
  // Ekran ma sens dopiero od momentu, w ktorym uczestnik jest zapisany:
  // bez rejestracji baza nie zna jego `registration_id`, wiec ani okno
  // dostepnosci, ani lista spotkan nie maja do czego sie przypiac.
  const registered = state.myRegistrationId !== null;
  const canEditAvailability = registered && state.isEnabled && state.canMeet;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("eventMeetings.participant.heading")}
        </h1>
        {intro.length > 0 ? <p className="text-sm text-muted-foreground">{intro}</p> : null}

        <div className="flex flex-wrap gap-2">
          {state.slotMinutes !== null ? (
            <Badge variant="secondary">
              {t("eventMeetings.participant.badges.slot", { count: state.slotMinutes })}
            </Badge>
          ) : null}
          <Badge variant="secondary">
            {t("eventMeetings.participant.badges.tables", { count: state.tablesCount })}
          </Badge>
          <Badge variant="secondary">
            {t("eventMeetings.participant.badges.timezone", { zone: timezone })}
          </Badge>
          {state.inviteExpiresAfterHours !== null ? (
            <Badge variant="secondary">
              {t("eventMeetings.participant.badges.expiry", {
                count: state.inviteExpiresAfterHours,
              })}
            </Badge>
          ) : null}
          {state.invitesLeft !== null ? (
            <Badge variant="outline">
              {t("eventMeetings.hints.invitesLeft", { count: state.invitesLeft })}
            </Badge>
          ) : null}
          {state.maxMeetingsPerDay !== null ? (
            <Badge variant="outline">
              {t("eventMeetings.hints.dailyLimit", { count: state.maxMeetingsPerDay })}
            </Badge>
          ) : null}
        </div>

        {block !== null ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {t(`eventMeetings.participant.blocks.${block}`)}
          </p>
        ) : null}
      </header>

      {registered ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("eventMeetings.participant.tabs.meetings")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCell
                label={t("eventMeetings.participant.summary.incoming")}
                value={state.summary.incomingPending}
              />
              <SummaryCell
                label={t("eventMeetings.participant.summary.outgoing")}
                value={state.summary.outgoingPending}
              />
              <SummaryCell
                label={t("eventMeetings.participant.summary.accepted")}
                value={state.summary.accepted}
              />
              <SummaryCell
                label={t("eventMeetings.participant.summary.held")}
                value={state.summary.held}
              />
            </CardContent>
          </Card>

          <Tabs defaultValue="meetings">
            <TabsList>
              <TabsTrigger value="meetings">
                {t("eventMeetings.participant.tabs.meetings")}
              </TabsTrigger>
              <TabsTrigger value="availability">
                {t("eventMeetings.participant.tabs.availability")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="meetings" className="mt-4">
              {meetings.isPending ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <MyMeetingsPanel slug={slug} rows={meetings.data ?? []} timezone={timezone} />
              )}
            </TabsContent>

            <TabsContent value="availability" className="mt-4">
              <MyAvailabilityPanel
                slug={slug}
                windows={state.myAvailability}
                timezone={timezone}
                canEdit={canEditAvailability}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {t("eventMeetings.hints.noContact")}
              </p>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
