// /admin/events/account-bindings - dowiazania kont do kartotek uczestnikow
// (REG-01, decyzja D14).
//
// EKRAN PANELU, NIE STUDIA. Kartoteka uczestnika (`event_people`) i dziennik
// odwiazan nie maja `event_id` - osoba jest wspolna dla wszystkich wydarzen
// organizacji, wiec ekran stoi obok listy wydarzen (kryterium podzialu
// z `adminNav.ts`), a nie w sidebarze jednego wydarzenia.
//
// BRAMKA ROLI JEST W BAZIE, TU JEST TYLKO KOMUNIKAT. Trzy RPC ekranu stoja za
// `assert_event_admin_tenant()` (admin albo super_admin) - redaktor dostanie
// `forbidden` niezaleznie od tego, co pokaze ekran. Zdanie zamiast pustej
// listy istnieje po to, zeby odmowa nie wygladala jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";

import { AccountBindingsPanel } from "@/components/admin/events/organisms/AccountBindingsPanel";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { adminPageHead } from "@/lib/adminPageHead";
import { ensureI18n } from "@/lib/i18n-admin-event-registration";

export const Route = createFileRoute("/admin/events/account-bindings")({
  head: () =>
    adminPageHead(
      "Participant account links",
      "Review attendee records linked to accounts without a confirmed e-mail, the unlink log, and restore or remove links. New European Strategies events administration.",
    ),
  component: AdminEventAccountBindingsPage,
});

function AdminEventAccountBindingsPage() {
  ensureI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-bold text-foreground">
          {t("adminEventRegistration.bindings.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("adminEventRegistration.bindings.lead")}</p>
      </header>
      {isAdmin ? (
        <AccountBindingsPanel />
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t("adminEventRegistration.errors.forbidden")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
