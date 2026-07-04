// Full inbox view - user-scoped, tenant-isolated via RLS.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as LucideIcons from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationsRealtime,
  type NotificationRow,
} from "@/lib/notifications/useNotifications";

export const Route = createFileRoute("/profile/notifications")({
  component: NotificationsInboxPage,
});

type Lang = "pl" | "en";
type TabValue = "all" | "unread";

function pickTitle(n: NotificationRow, lang: Lang): string {
  return (lang === "en" && n.title_en) || n.title_pl;
}
function pickBody(n: NotificationRow, lang: Lang): string | null {
  return lang === "en" ? (n.body_en ?? n.body_pl) : (n.body_pl ?? n.body_en);
}
function fmtDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function resolveIcon(name: string | null | undefined) {
  if (!name) return null;
  const reg = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return reg[name] ?? null;
}

function NotificationsInboxPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [tab, setTab] = useState<TabValue>("all");

  useNotificationsRealtime();
  const listQ = useNotifications({
    limit: 200,
    onlyUnread: tab === "unread",
  });
  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();
  const removeOne = useDeleteNotification();

  if (!user) {
    return (
      <Card>
        <CardContent className="p-6 text-sm">
          <Link to="/login" className="underline">
            {t("auth.signInRequired", { defaultValue: "Zaloguj się, aby zobaczyć powiadomienia" })}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const items = listQ.data ?? [];
  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>{t("notifications.title", { defaultValue: "Powiadomienia" })}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("notifications.inboxSubtitle", {
              defaultValue: "Twoja prywatna skrzynka - widzisz tylko własne powiadomienia.",
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <LucideIcons.CheckCheck className="h-4 w-4 mr-1.5" />
          {t("notifications.markAllRead", { defaultValue: "Oznacz wszystkie" })}
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList>
            <TabsTrigger value="all">
              {t("notifications.filters.all", { defaultValue: "Wszystkie" })}
            </TabsTrigger>
            <TabsTrigger value="unread">
              {t("notifications.filters.unread", { defaultValue: "Nieprzeczytane" })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {listQ.isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t("common.loading", { defaultValue: "Ładowanie..." })}
              </div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <LucideIcons.BellOff className="mx-auto mb-3 h-8 w-8 opacity-40" aria-hidden />
                {t("notifications.empty", { defaultValue: "Brak powiadomień" })}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const IconCmp = resolveIcon(n.icon) ?? LucideIcons.Circle;
                  const isUnread = !n.read_at;
                  return (
                    <li key={n.id} className="py-3 flex items-start gap-3">
                      <div
                        className={[
                          "mt-0.5 shrink-0 rounded-full p-2",
                          isUnread
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                        ].join(" ")}
                        aria-hidden
                      >
                        <IconCmp className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {n.href ? (
                            <a
                              href={n.href}
                              onClick={() => isUnread && markOne.mutate(n.id)}
                              className={[
                                "text-sm truncate hover:underline",
                                isUnread ? "font-semibold" : "font-medium",
                              ].join(" ")}
                            >
                              {pickTitle(n, lang)}
                            </a>
                          ) : (
                            <span
                              className={[
                                "text-sm truncate",
                                isUnread ? "font-semibold" : "font-medium",
                              ].join(" ")}
                            >
                              {pickTitle(n, lang)}
                            </span>
                          )}
                          {isUnread && (
                            <span
                              className="h-2 w-2 rounded-full bg-primary shrink-0"
                              aria-hidden
                            />
                          )}
                        </div>
                        {pickBody(n, lang) && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {pickBody(n, lang)}
                          </p>
                        )}
                        <div className="mt-1 text-[11px] text-muted-foreground/80">
                          {fmtDate(n.created_at, lang)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isUnread && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markOne.mutate(n.id)}
                            aria-label={t("notifications.markRead", {
                              defaultValue: "Oznacz jako przeczytane",
                            })}
                          >
                            <LucideIcons.Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeOne.mutate(n.id)}
                          aria-label={t("common.delete", { defaultValue: "Usuń" })}
                        >
                          <LucideIcons.Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
