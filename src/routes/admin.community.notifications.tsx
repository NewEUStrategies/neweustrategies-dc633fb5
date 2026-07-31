// /admin/community/notifications - statystyki push + digestów, ZDROWIE
// HARMONOGRAMU doręczeń i akcje utrzymaniowe.
//
// Panel zdrowia (SchedulerHealthPanel) jest tu pierwszy świadomie: dyspozytor
// push/digestów jest kompletny, ale bez działającego harmonogramu nic nie
// wychodzi - a rosnąca kolejka wygląda dokładnie jak brak powiadomień do
// wysłania. Statystyki poniżej mówią „ile", panel mówi „czy w ogóle biegnie".
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Trash2, Mail, Smartphone, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SchedulerHealthPanel } from "@/components/admin/community/SchedulerHealthPanel";
import { cleanupFailedPushSubscriptions, fetchNotificationStats } from "@/lib/admin/community";

export const Route = createFileRoute("/admin/community/notifications")({
  head: () => ({ meta: [{ title: "Notifications · Community · Admin" }] }),
  component: NotificationsAdmin,
});

function NotificationsAdmin() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["admin-notification-stats"],
    queryFn: fetchNotificationStats,
    staleTime: 30_000,
  });

  const cleanupM = useMutation({
    mutationFn: cleanupFailedPushSubscriptions,
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["admin-notification-stats"] });
      toast.success(
        isPl ? `Usunięto ${n} nieudanych subskrypcji` : `Removed ${n} failed subscriptions`,
      );
    },
    onError: () => toast.error(isPl ? "Błąd" : "Failed"),
  });

  const s = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4" />
        <h2 className="text-lg font-semibold">{isPl ? "Powiadomienia" : "Notifications"}</h2>
      </div>

      <SchedulerHealthPanel />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat
          icon={Smartphone}
          label={isPl ? "Push aktywne" : "Push active"}
          value={s?.push_subscriptions_active}
        />
        <Stat
          icon={AlertTriangle}
          label={isPl ? "Push nieudane" : "Push failed"}
          value={s?.push_subscriptions_failed}
          tone="warn"
        />
        <Stat
          icon={Bell}
          label={isPl ? "Wysł. / 24h" : "Sent / 24h"}
          value={s?.notifications_last_24h}
        />
        <Stat icon={Bell} label={isPl ? "Nieprzecz." : "Unread"} value={s?.notifications_unread} />
        <Stat
          icon={Mail}
          label={isPl ? "Dig. dzienny" : "Daily digest"}
          value={s?.digest_daily_users}
        />
        <Stat
          icon={Mail}
          label={isPl ? "Dig. tygod." : "Weekly digest"}
          value={s?.digest_weekly_users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Akcje serwisowe" : "Maintenance"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => cleanupM.mutate()} disabled={cleanupM.isPending}>
            <Trash2 className="w-4 h-4 mr-2" />
            {isPl ? "Wyczyść nieudane subskrypcje push" : "Purge failed push subscriptions"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isPl ? "Informacje" : "Info"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            {isPl
              ? "Preferencje powiadomień per użytkownik zarządzają: kanałami (email/push), grupowaniem, digestami (off/daily/weekly) i widocznością statusu online."
              : "Per-user preferences manage: channels (email/push), grouping, digests (off/daily/weekly) and online status visibility."}
          </p>
          <p>
            {isPl
              ? "Kolejkę push (notification_push_queue) drenują trzy równoważne ścieżki: pg_cron + pg_net co minutę (POST /api/public/jobs-tick), scheduler repo co 5 minut (POST /api/public/community-cron) i przycisk „Uruchom tick teraz”. Claimy są atomowe (SKIP LOCKED), więc równoległe przebiegi niczego nie dublują; nieudane subskrypcje mają wypełnione failed_at."
              : "The push queue (notification_push_queue) is drained by three equivalent paths: pg_cron + pg_net every minute (POST /api/public/jobs-tick), the repo scheduler every 5 minutes (POST /api/public/community-cron) and the 'Run tick now' button. Claims are atomic (SKIP LOCKED), so parallel runs never duplicate work; failed subscriptions have failed_at set."}
          </p>
          <p>
            {isPl
              ? "Stan każdej ścieżki i log ostatnich przebiegów są w panelu zdrowia harmonogramu powyżej. Szczegóły operacyjne: docs/RUNBOOK_COMMUNITY.md."
              : "The state of each path and the recent-run log live in the scheduler health panel above. Operational detail: docs/RUNBOOK_COMMUNITY.md."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Bell;
  label: string;
  value: number | undefined;
  tone?: "warn";
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className={"w-3.5 h-3.5 " + (tone === "warn" ? "text-destructive" : "")} />
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value ?? "-"}</div>
      </CardContent>
    </Card>
  );
}
