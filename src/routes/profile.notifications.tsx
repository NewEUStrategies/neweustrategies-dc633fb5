// USTAWIENIA POWIADOMIEN (/profile/notifications).
//
// STAN ZASTANY - funkcja gotowa i nieosiagalna. `NotificationsCenter` ma cztery
// tryby (`full`, `inbox`, `preferences`, `consents`), a zakladka „Ustawienia"
// pokazuje sie tylko gdy `showSettingsTab` jest prawdziwe, czyli w trybach
// `full` i `preferences` (NotificationsCenter.tsx:353). Tymczasem jedyne dwa
// montowania komponentu w calej aplikacji - /messages - uzywaja trybow `inbox`
// i `consents`. Skutek: opt-in Web Push, digest e-mail, grupowanie rozmow,
// auto-oznaczanie po otwarciu czatu i przelacznik dzwonka w naglowku byly
// zaimplementowane, przetestowane po stronie danych i CALKOWICIE niedostepne
// dla uzytkownika. W nawigacji profilu pozycja „Powiadomienia" prowadzila do
// SKRZYNKI (/messages?view=notifications), wiec nie bylo nawet skad zgadnac,
// ze ustawienia istnieja.
//
// TERAZ - osobna strona w grupie „Prywatnosc i bezpieczenstwo", bo uzytkownik
// szukajacy „czy moge wylaczyc te maile" idzie tam, a nie do skrzynki. Strona
// linkuje w obie strony: do skrzynki (lista powiadomien) i do centrum
// prywatnosci (zgody marketingowe + rejestr RODO), bo granica „preferencje
// kanalow" / „zgody na komunikacje" nie jest oczywista i bez linkow uzytkownik
// szuka zgod tutaj.
//
// Tryb `preferences` renderuje wlasny naglowek z kluczy
// `notifications.settings.title` / `.subtitleLead`, dlatego strona nie dokleja
// drugiego H2 - inaczej czytnik oglaszalby ten sam tytul dwa razy.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Inbox, ShieldCheck } from "lucide-react";

import { SurfaceLinkCard } from "@/components/atoms/SurfaceLinkCard";
import { NotificationsCenter } from "@/components/notifications/NotificationsCenter";
import { ensureI18n as ensureNotificationsI18n } from "@/lib/i18n-notifications";

export const Route = createFileRoute("/profile/notifications")({
  component: NotificationSettingsRoute,
  head: () => ({
    meta: [{ title: "Notification settings" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function NotificationSettingsRoute() {
  // Rejestracja slownika w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureNotificationsI18n();
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl space-y-8 py-6">
      <NotificationsCenter mode="preferences" />

      <section aria-labelledby="notification-related-heading" className="space-y-3">
        <h3 id="notification-related-heading" className="text-sm font-semibold text-foreground/80">
          {t("notifications.page.relatedHeading")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <SurfaceLinkCard
            to="/messages"
            search={{ view: "notifications" }}
            icon={Inbox}
            title={t("notifications.page.inboxLinkTitle")}
            body={t("notifications.page.inboxLinkBody")}
          />
          <SurfaceLinkCard
            to="/profile/privacy"
            icon={ShieldCheck}
            title={t("notifications.page.consentsLinkTitle")}
            body={t("notifications.page.consentsLinkBody")}
          />
        </div>
      </section>
    </div>
  );
}
