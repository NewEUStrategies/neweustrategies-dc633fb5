// /admin/events/agenda - program wydarzenia: sesje, ścieżki, sale, kolizje.
//
// JEDNA TRASA NA PODMODUŁ, WYDARZENIE WYBIERANE W ŚRODKU - tak jak zapisy i
// giełda spotkań.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Każde RPC agendy ma asercję
// roli w tenancie, więc redaktor bez uprawnień dostanie odmowę niezależnie od
// tego, co pokaże ekran; komunikat istnieje po to, żeby odmowa nie wyglądała
// jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { AgendaManager } from "@/components/admin/events/organisms/AgendaManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureAgendaI18n } from "@/lib/i18n-admin-event-agenda";

export const Route = createFileRoute("/admin/events/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda and sessions · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Build the event programme: sessions, tracks, rooms and agenda conflicts.",
      },
    ],
  }),
  component: AdminEventAgendaPage,
});

function AdminEventAgendaPage() {
  ensureAdminEventsI18n();
  ensureAgendaI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventAgenda.errors.forbidden")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <AgendaManager />
    </div>
  );
}
