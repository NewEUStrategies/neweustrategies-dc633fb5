// Organizm: PANEL UCZESTNIKA na wydarzeniu - „Moje" (`/events/<slug>/me`).
//
// TRZY PYTANIA, JEDEN EKRAN. Zalogowany uczestnik pyta na wydarzeniu dokładnie
// o trzy rzeczy: „jak mnie widzą inni", „z kim i kiedy się umawiam", „czy mój
// bilet jest ważny". Do tej pory każda z odpowiedzi mieszkała gdzie indziej -
// karta profilu w lewej kolumnie przeglądu, giełda pod `/meetings/<slug>`,
// zgłoszenia w globalnym profilu. Ekran nie kopiuje żadnej z nich: SKŁADA te
// same organizmy, więc reguła dostępu i źródło danych zostają nieruszone.
//
// FILTR ZGŁOSZEŃ JEST PREZENTACYJNY, NIE OCHRONNY. RPC `event_my_registrations`
// i tak oddaje wyłącznie zapisy `auth.uid()`; slug zawęża listę do TEGO
// wydarzenia, żeby uczestnik nie przeglądał całej historii w kontekście jednej
// konferencji.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useViewerCardFacts } from "@/lib/profile/useViewerCard";
import { EventViewerCard } from "@/components/events/public/molecules/EventViewerCard";
import { MeetingExchangeBoard } from "@/components/events/meetings/MeetingExchangeBoard";
import { ParticipantTicketsPanel } from "@/components/profile/ParticipantTicketsPanel";
import { ensureI18n } from "@/lib/i18n-cart";

ensureI18n();

export function EventMePanel({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const viewer = useViewerCardFacts();

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

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">{t("eventMe.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("eventMe.lead")}</p>
      </header>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList>
          <TabsTrigger value="profile">{t("eventMe.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="networking">{t("eventMe.tabs.networking")}</TabsTrigger>
          <TabsTrigger value="registration">{t("eventMe.tabs.registration")}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-3">
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
