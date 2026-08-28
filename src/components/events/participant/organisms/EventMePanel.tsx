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
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useViewerCardFacts } from "@/lib/profile/useViewerCard";
import { EventViewerCard } from "@/components/events/public/molecules/EventViewerCard";
import { MeetingExchangeBoard } from "@/components/events/meetings/MeetingExchangeBoard";
import { ParticipantTicketsPanel } from "@/components/profile/ParticipantTicketsPanel";
import { MyEventProfileForm } from "@/components/events/participant/molecules/MyEventProfileForm";
import { MyAgendaList } from "@/components/events/participant/molecules/MyAgendaList";
import { useMyAgenda, useMyEventProfile } from "@/lib/events/useMyEventPanel";
import { useMyConnections } from "@/lib/network/useConnections";
import { ensureI18n } from "@/lib/i18n-cart";

ensureI18n();

function RegistrationStatusBadge({ status }: { status: string | null }) {
  const { t } = useTranslation();
  if (status === null) return null;
  const active = status === "confirmed" || status === "registered" || status === "paid";
  return (
    <Badge variant={active ? "default" : "secondary"} className="rounded-[6px]">
      {active ? t("eventMe.statusActive") : t("eventMe.statusPending")}
    </Badge>
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
                to="/profile/$slug"
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

export function EventMePanel({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const viewer = useViewerCardFacts();
  const signedIn = Boolean(session);
  const panel = useMyEventProfile(slug, signedIn);
  const agenda = useMyAgenda(slug, signedIn);

  if (!session) {
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

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">{t("eventMe.title")}</h1>
          <RegistrationStatusBadge status={registration?.status ?? null} />
        </div>
        <p className="text-sm text-muted-foreground">{t("eventMe.lead")}</p>
      </header>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="profile">{t("eventMe.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="schedule">{t("eventMe.tabs.schedule")}</TabsTrigger>
          <TabsTrigger value="contacts">{t("eventMe.tabs.contacts")}</TabsTrigger>
          <TabsTrigger value="networking">{t("eventMe.tabs.networking")}</TabsTrigger>
          <TabsTrigger value="registration">{t("eventMe.tabs.registration")}</TabsTrigger>
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
          <p className="text-sm text-muted-foreground">{t("eventMe.profileHint")}</p>
          <MyEventProfileForm
            slug={slug}
            profile={panel.data?.profile ?? null}
            loading={panel.isLoading}
          />
        </TabsContent>

        <TabsContent value="schedule">
          <MyAgendaList sessions={agenda.data ?? []} loading={agenda.isLoading} />
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
      </Tabs>
    </section>
  );
}
