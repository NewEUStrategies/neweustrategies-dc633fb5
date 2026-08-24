// /admin/events/types - katalog rodzajów wydarzeń.
//
// Osobna trasa, a nie zakładka w konkretnym wydarzeniu: rodzaj jest wspólny dla
// całej organizacji i decyduje o tym, co widać w kreatorze wydarzenia oraz jakie
// ustawienia dostaje nowe wydarzenie.
//
// BRAMKA ROLI JEST W BAZIE, TU JEST TYLKO KOMUNIKAT. Wszystkie cztery RPC
// katalogu stoją za `assert_admin_tenant()`, więc edytor bez roli admina dostanie
// `42501` niezależnie od tego, co pokaże ekran. Zdanie zamiast pustej listy
// istnieje po to, żeby odmowa nie wyglądała jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { EventTypesManager } from "@/components/admin/events/organisms/EventTypesManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

export const Route = createFileRoute("/admin/events/types")({
  head: () => ({
    meta: [
      { title: "Event types · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Manage the event type catalogue for your organisation.",
      },
    ],
  }),
  component: AdminEventTypesPage,
});

function AdminEventTypesPage() {
  ensureAdminEventsI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEvents.types.adminOnly")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <EventTypesManager />
    </div>
  );
}
