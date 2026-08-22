// Lista czytelnicza: zapisane / obserwowane / rekomendacje.
//
// Trasa jest CIENKA z zamysłu: rozstrzyga trzy bramki dostępu (wyłączona
// personalizacja, gość bez trybu gościnnego, wybór zakładki) i rozdziela render
// do organizmów w `components/readingList/organisms`. Dane, zapytania i stany
// pustki/awarii mieszkają tam, prezentacja w molekułach, a czyste reguły
// (widoczne zakładki, klasy siatki, klucz badge'a powodu) w atomach - dzięki
// temu każda z nich ma dowód bez montowania całej strony.
//
// Obserwowane to PRAWDZIWY feed postów obserwowanych autorów, kategorii i tagów
// (RPC get_followed_feed) z klikalnymi chipami obserwacji (unfollow jednym
// kliknięciem), a nie statyczne chipy. Rekomendacje idą przez
// get_recommended_posts_v2 - działają też dla gościa (zainteresowania
// z localStorage), więc strona nie jest już twardym login-wallem: gość przy
// włączonym allowGuests widzi rekomendacje i lokalnie zapisane artykuły.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { openLoginPopup } from "@/lib/loginPopupBus";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureReadingListI18n } from "@/lib/i18n-reading-list";
import {
  readingListTabs,
  type ReadingListTab,
} from "@/components/readingList/atoms/readingListTabs";
import { GuestLoginNudge } from "@/components/readingList/molecules/GuestLoginNudge";
import { ReadingListGateNotice } from "@/components/readingList/molecules/ReadingListGateNotice";
import { ReadingListTabs } from "@/components/readingList/molecules/ReadingListTabs";
import { GuestSavedSection } from "@/components/readingList/organisms/GuestSavedSection";
import { FollowedSection } from "@/components/readingList/organisms/FollowedSection";
import { RecommendedSection } from "@/components/readingList/organisms/RecommendedSection";
import { SavedSection } from "@/components/readingList/organisms/SavedSection";

export const Route = createFileRoute("/reading-list")({
  component: ReadingListPage,
  head: () => ({
    meta: [{ title: "Twoja lista do przeczytania" }, { name: "robots", content: "noindex" }],
  }),
});

function ReadingListPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureReadingListI18n();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const settings = usePersonalizedSettings();
  const [tab, setTab] = useState<ReadingListTab>("saved");

  // Wyłącznik główny personalizacji obowiązuje także tutaj.
  if (!settings.enabled) {
    return (
      <ReadingListGateNotice
        title={t("readingList.disabledTitle")}
        body={t("readingList.disabledBody")}
      />
    );
  }

  // Gość bez trybu gościnnego: dotychczasowa zachęta do logowania.
  if (!user && !settings.allowGuests) {
    return (
      <ReadingListGateNotice
        title={settings.restrictedTitle}
        body={settings.restrictedDescription}
        action={
          <Button
            onClick={() =>
              openLoginPopup({
                title: settings.restrictedTitle,
                description: settings.restrictedDescription,
              })
            }
          >
            {t("readingList.signIn")}
          </Button>
        }
      />
    );
  }

  const currentSection = settings.sections[tab];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 max-w-6xl mx-auto px-4 lg:px-8 py-10 w-full">
        <header className="text-center mb-8">
          <h1 className="font-display text-4xl mb-2">{currentSection.heading}</h1>
          <p className="text-muted-foreground">{currentSection.description}</p>
        </header>

        <ReadingListTabs tabs={readingListTabs(settings.sections)} active={tab} onSelect={setTab} />

        {tab === "saved" &&
          (user ? (
            <SavedSection columns={settings.sections.saved.columns} lang={lang} />
          ) : (
            <GuestSavedSection lang={lang} />
          ))}
        {tab === "followed" &&
          (user ? (
            <FollowedSection columns={settings.sections.followed.columns} lang={lang} />
          ) : (
            <GuestLoginNudge
              text={t("readingList.followedGuest")}
              title={settings.restrictedTitle}
              description={settings.restrictedDescription}
            />
          ))}
        {tab === "recommended" && (
          <RecommendedSection
            columns={settings.sections.recommended.columns}
            limit={settings.sections.recommended.postsPerPage ?? 9}
            lang={lang}
          />
        )}
      </div>
    </div>
  );
}
