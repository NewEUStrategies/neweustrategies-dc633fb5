// /admin/community/notifications - statystyki push + digestów, ZDROWIE
// HARMONOGRAMU doręczeń i akcje utrzymaniowe.
//
// Panel zdrowia (SchedulerHealthPanel) jest tu pierwszy świadomie: dyspozytor
// push/digestów jest kompletny, ale bez działającego harmonogramu nic nie
// wychodzi - a rosnąca kolejka wygląda dokładnie jak brak powiadomień do
// wysłania. Statystyki poniżej mówią „ile", panel mówi „czy w ogóle biegnie".
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminCommunityI18n } from "@/lib/i18n-admin-community";
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
  ensureAdminCommunityI18n();
  const { t } = useTranslation();
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
      toast.success(t("adminCommunity.notifications.removedFailedSubscriptions", { count: n }));
    },
    onError: () => toast.error(t("adminCommunity.notifications.failed")),
  });

  const s = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4" />
        <h2 className="text-lg font-semibold">{t("adminCommunity.notifications.notifications")}</h2>
      </div>

      <SchedulerHealthPanel />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat
          icon={Smartphone}
          label={t("adminCommunity.notifications.pushActive")}
          value={s?.push_subscriptions_active}
        />
        <Stat
          icon={AlertTriangle}
          label={t("adminCommunity.notifications.pushFailed")}
          value={s?.push_subscriptions_failed}
          tone="warn"
        />
        <Stat
          icon={Bell}
          label={t("adminCommunity.notifications.sent24h")}
          value={s?.notifications_last_24h}
        />
        <Stat
          icon={Bell}
          label={t("adminCommunity.notifications.unread")}
          value={s?.notifications_unread}
        />
        <Stat
          icon={Mail}
          label={t("adminCommunity.notifications.dailyDigest")}
          value={s?.digest_daily_users}
        />
        <Stat
          icon={Mail}
          label={t("adminCommunity.notifications.weeklyDigest")}
          value={s?.digest_weekly_users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("adminCommunity.notifications.maintenance")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => cleanupM.mutate()} disabled={cleanupM.isPending}>
            <Trash2 className="w-4 h-4 mr-2" />
            {t("adminCommunity.notifications.purgeFailedPushSubscriptions")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adminCommunity.notifications.info")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{t("adminCommunity.notifications.perUserPreferencesManage")}</p>
          <p>{t("adminCommunity.notifications.pushQueueNotificationPush")}</p>
          <p>{t("adminCommunity.notifications.stateEachPathRecent")}</p>
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
