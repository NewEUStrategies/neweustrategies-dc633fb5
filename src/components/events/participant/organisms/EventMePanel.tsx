// Organizm: PANEL UCZESTNIKA na wydarzeniu - „Moje" (`/events/<slug>/me`).
//
// PIĘĆ PYTAŃ, JEDEN EKRAN. Uczestnik pyta na wydarzeniu o: „jak mnie widzą
// inni", „gdzie mam być" (mój harmonogram), „z kim rozmawiam" (kontakty),
// „kiedy jestem dostępny" (networking) i „czy mój bilet jest ważny". Ekran nie
// kopiuje żadnej z tych powierzchni: SKŁADA istniejące organizmy, więc reguła
// dostępu i źródło danych zostają nieruszone.
//
// PROFIL JEST EDYTOWALNY TU, NIE W GLOBALNYM PROFILU. Kartoteka wydarzenia
// (`event_people`) to inne dane niż profil redakcyjny - inna rola, inna firma,
// inne bio na identyfikator. Zapis idzie przez `event_my_event_profile_set`,
// który przyjmuje wyłącznie tożsamość `auth.uid()`.
//
// FILTR ZGŁOSZEŃ JEST PREZENTACYJNY, NIE OCHRONNY. RPC `event_my_registrations`
// i tak oddaje wyłącznie zapisy `auth.uid()`; slug zawęża listę do TEGO
// wydarzenia.
//
// ZAKŁADKA JEST W ADRESIE (`?tab=`, spec B.13). Trasa waliduje ją
// (`parseEventMeTab`) i podaje tu `tab` + `onTabChange`; przełączenie
// zakładki podmienia adres bez nowego wpisu w historii. Odnośnik z e-maila
// (`?tab=schedule#event-session-<id>`) otwiera więc właściwą zakładkę.
//
// SERWER RYSUJE WYŁĄCZNIE SZKIELET. Dopóki `useAuth().loading` (a na serwerze
// jest ono zawsze prawdą), panel nie renderuje ani zakładek, ani danych - HTML
// z serwera jest więc taki sam dla każdego `?tab=` i dla każdego widza. Na tym
// stoi reguła pamięci podręcznej dokumentu, która pomija `tab` w kluczu tej
// trasy (`documentCache.ts`, MIN-2), i zero danych osobowych w SSR (R-UI/SSR).
//
// GNIAZDA TORÓW (spec B.11). Harmonogram i „Po wydarzeniu" renderują gniazda
// (`EventMeScheduleSlot`, `EventMeFollowUpSlot`), które przepisują tory A i C.
// Przycisk zakładki „Po wydarzeniu" pokazuje się dopiero, gdy organizator
// włączył certyfikat albo ankietę; TREŚĆ tej zakładki renderuje się jednak dla
// `?tab=follow-up` także wtedy, gdy flagi jeszcze się wczytują (MIN-16).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useViewerCardFacts } from "@/lib/profile/useViewerCard";
import { EventViewerCard } from "@/components/events/public/molecules/EventViewerCard";
import { MeetingExchangeBoard } from "@/components/events/meetings/MeetingExchangeBoard";
import { ParticipantTicketsPanel } from "@/components/profile/ParticipantTicketsPanel";
import { MyEventProfileForm } from "@/components/events/participant/molecules/MyEventProfileForm";
import { MyEventPublicPreview } from "@/components/events/participant/molecules/MyEventPublicPreview";
import { RegistrationStatusBadge } from "@/components/events/participant/atoms/RegistrationStatusBadge";
import { EventMeFollowUpSlot } from "@/components/events/participant/slots/EventMeFollowUpSlot";
import { EventMeScheduleSlot } from "@/components/events/participant/slots/EventMeScheduleSlot";
import { parseEventMeTab, type EventMeTab } from "@/lib/events/eventMeTabs";
import { useEventParticipantOptions } from "@/lib/events/useEventParticipantOptions";
import { useMyEventProfile } from "@/lib/events/useMyEventPanel";
import { useMyConnections } from "@/lib/network/useConnections";
import { ensureI18n } from "@/lib/i18n-cart";
import { ensureI18n as ensureEventParticipantI18n } from "@/lib/i18n-event-participant";

ensureI18n();
ensureEventParticipantI18n();

/** Szkielet na czas rozstrzygania sesji - jedyne, co widzi serwer. */
function EventMePanelSkeleton() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4" aria-busy="true">
      <p role="status" className="sr-only">
        {t("eventParticipant.loading")}
      </p>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-40 w-full" />
    </section>
  );
}

function MyContacts() {
  const { t } = useTranslation();
  const connections = useMyConnections("", 12);
  const rows = connections.data?.pages.flat() ?? [];

  if (connections.isLoading) {
    return <Skeleton className="h-24 w-full rounded-[6px]" />;
  }
  if (rows.length === 0) {
    return (
      <div className="space-y-3 rounded-[6px] border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">{t("eventMe.contactsEmpty")}</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/network">{t("eventMe.openNetwork")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.connection_id}
            className="flex items-center gap-3 rounded-[6px] border border-border bg-card p-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{row.display_name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[row.job_title, row.current_company].filter(Boolean).join(" - ")}
              </span>
            </span>
            {row.slug ? (
              <Link
                to="/author/$slug"
                params={{ slug: row.slug }}
                className="shrink-0 text-xs underline-offset-2 hover:underline"
              >
                {t("eventMe.openProfile")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      <Button asChild size="sm" variant="outline">
        <Link to="/network">{t("eventMe.openNetwork")}</Link>
      </Button>
    </div>
  );
}

export function EventMePanel({
  slug,
  tab,
  onTabChange,
}: {
  slug: string;
  /** Zakładka z adresu; brak = `profile`. */
  tab?: EventMeTab;
  /** Zmiana zakładki - trasa zapisuje ją w adresie (`replace`, bez przewijania). */
  onTabChange: (tab: EventMeTab) => void;
}) {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const viewer = useViewerCardFacts();
  const signedIn = session !== null && !loading;
  const panel = useMyEventProfile(slug, signedIn);
  const options = useEventParticipantOptions(slug, signedIn);
  // „Zobacz, jak widzą Cię inni" - ten sam rekord, tylko w kształcie karty
  // katalogowej. Stan jest lokalny, bo to sposób patrzenia, nie dane.
  const [publicView, setPublicView] = useState(false);

  if (loading) return <EventMePanelSkeleton />;

  if (session === null) {
    return (
      <section className="space-y-3 rounded-[6px] border border-border bg-muted/30 p-6">
        <h1 className="text-lg font-bold">{t("eventMe.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventMe.signedOut")}</p>
        <Button asChild size="sm">
          <Link to="/login">{t("eventMe.signIn")}</Link>
        </Button>
      </section>
    );
  }

  const registration = panel.data?.registration ?? null;
  const flags = options.data ?? null;
  const followUpOffered = flags !== null && (flags.certificateEnabled || flags.surveyEnabled);

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">{t("eventMe.title")}</h1>
          <RegistrationStatusBadge status={registration?.status ?? null} />
        </div>
        <p className="text-sm text-muted-foreground">{t("eventMe.lead")}</p>
      </header>

      <Tabs
        value={tab ?? "profile"}
        onValueChange={(value) => {
          const next = parseEventMeTab(value);
          if (next !== undefined) onTabChange(next);
        }}
        className="space-y-4"
      >
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="profile">{t("eventMe.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="schedule">{t("eventMe.tabs.schedule")}</TabsTrigger>
          <TabsTrigger value="contacts">{t("eventMe.tabs.contacts")}</TabsTrigger>
          <TabsTrigger value="networking">{t("eventMe.tabs.networking")}</TabsTrigger>
          <TabsTrigger value="registration">{t("eventMe.tabs.registration")}</TabsTrigger>
          {followUpOffered && (
            <TabsTrigger value="follow-up">{t("eventParticipant.tabs.followUp")}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          {viewer !== null && (
            <div className="max-w-sm">
              <EventViewerCard
                name={viewer.name}
                jobTitle={viewer.jobTitle}
                company={viewer.company}
                avatarUrl={viewer.avatarUrl}
                editSlot={
                  <Link
                    to="/profile/edit"
                    className="rounded-[4px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t("eventMe.editProfile")}
                  </Link>
                }
              />
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("eventMe.profileHint")}</p>
            {panel.data?.profile != null && (
              <Button
                type="button"
                size="sm"
                variant={publicView ? "default" : "outline"}
                onClick={() => setPublicView((prev) => !prev)}
              >
                <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {publicView ? t("eventMe.publicPreview.close") : t("eventMe.publicPreview.open")}
              </Button>
            )}
          </div>
          {publicView && panel.data?.profile != null ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("eventMe.publicPreview.hint")}</p>
              <div className="max-w-xl">
                <MyEventPublicPreview
                  profile={panel.data.profile}
                  actions={{ slug: null, userId: null, self: true }}
                />
              </div>
            </div>
          ) : (
            <MyEventProfileForm
              slug={slug}
              profile={panel.data?.profile ?? null}
              account={panel.data?.account ?? null}
              loading={panel.isLoading}
            />
          )}
        </TabsContent>

        <TabsContent value="schedule">
          <EventMeScheduleSlot slug={slug} registration={registration} options={flags} />
        </TabsContent>

        <TabsContent value="contacts">
          <MyContacts />
        </TabsContent>

        <TabsContent value="networking">
          {/* Widoczność w katalogu, okna dostępności i zaproszenia 1-1 - ten
              sam organizm, co pod `/meetings/<slug>`; zero drugiej kopii reguł. */}
          <MeetingExchangeBoard slug={slug} />
        </TabsContent>

        <TabsContent value="registration">
          <ParticipantTicketsPanel slugFilter={slug} hideHeader />
        </TabsContent>

        <TabsContent value="follow-up" className="space-y-4">
          {options.isError && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("eventParticipant.options.loadError")}
            </p>
          )}
          <EventMeFollowUpSlot slug={slug} registration={registration} options={flags} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
