// /admin/events/meetings - giełda spotkań biznesowych 1-1.
//
// JEDNA TRASA NA MODUŁ, WYDARZENIE WYBIERANE W ŚRODKU: konfiguracja giełdy,
// stoliki, lista spotkań i statystyki to cztery widoki tego samego kontekstu,
// a organizator przełącza kontekst częściej niż widok.
//
// BRAMKA ROLI JEST W BAZIE, TU STOI TYLKO ZDANIE. Wszystkie RPC organizatora
// stoją za asercją roli w tenancie, więc redaktor bez uprawnień dostanie odmowę
// niezależnie od tego, co pokaże ekran - komunikat istnieje po to, żeby odmowa
// nie wyglądała jak awaria.
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { MeetingsManager } from "@/components/admin/events/organisms/MeetingsManager";
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";
import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";

export const Route = createFileRoute("/admin/events/meetings")({
  head: () => ({
    meta: [
      { title: "1-1 meetings · Events · Admin" },
      { name: "robots", content: "noindex, nofollow" },
      {
        name: "description",
        content: "Run the 1-1 business matching exchange: tables, slot grid, meetings and stats.",
      },
    ],
  }),
  component: AdminEventMeetingsPage,
});

function AdminEventMeetingsPage() {
  ensureAdminEventsI18n();
  ensureMeetingsI18n();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventMeetings.errors.forbidden")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <MeetingsManager />
    </div>
  );
}
