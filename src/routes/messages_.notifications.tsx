// Full inbox view - user-scoped, tenant-isolated via RLS.
// Adds a Settings tab (toggle notification kinds + default behaviour) and
// per-row quick actions (mark read / unread) that keep in sync with widgets.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as LucideIcons from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotifications,
  useNotificationPreferences,
  useNotificationsRealtime,
  useUpdateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationRow,
  type NotificationPreferences,
} from "@/lib/notifications/useNotifications";
import { groupNotifications } from "@/lib/notifications/grouping";

export const Route = createFileRoute("/messages_/notifications")({
  component: NotificationsInboxPage,
});

type Lang = "pl" | "en";
type TabValue = "all" | "unread" | "settings";

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

const TOGGLEABLE_KINDS = [
  "message",
  "comment",
  "follow",
  "subscription",
  "content",
  "system",
] as const;

function NotificationsInboxPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [tab, setTab] = useState<TabValue>("all");

  useNotificationsRealtime();
  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPreferences = prefsQ.data ?? DEFAULT_NOTIFICATION_PREFERENCES;

  const listQ = useNotifications({
    limit: 200,
    onlyUnread: tab === "unread",
  });
  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();
  const unreadOne = useMarkNotificationUnread();
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
  const groups = groupNotifications(items, {
    groupByConversation: prefs.group_by_conversation && tab !== "unread",
  });

  const patch = (next: Partial<NotificationPreferences>) => {
    updatePrefs.mutate(next, {
      onSuccess: () =>
        toast.success(t("notifications.settings.saved", { defaultValue: "Zapisano preferencje" })),
      onError: () =>
        toast.error(
          t("notifications.settings.saveError", {
            defaultValue: "Nie udało się zapisać preferencji",
          }),
        ),
    });
  };

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
        {tab !== "settings" && (
          <Button
            variant="outline"
            size="sm"
            disabled={unreadCount === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <LucideIcons.CheckCheck className="h-4 w-4 mr-1.5" />
            {t("notifications.markAllRead", { defaultValue: "Oznacz wszystkie" })}
          </Button>
        )}
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
            <TabsTrigger value="settings">
              {t("notifications.filters.settings", { defaultValue: "Ustawienia" })}
            </TabsTrigger>
          </TabsList>

          {tab !== "settings" ? (
            <TabsContent value={tab} className="mt-4">
              {listQ.isLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  {t("common.loading", { defaultValue: "Ładowanie..." })}
                </div>
              ) : groups.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  <LucideIcons.BellOff className="mx-auto mb-3 h-8 w-8 opacity-40" aria-hidden />
                  {t("notifications.empty", { defaultValue: "Brak powiadomień" })}
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {groups.map((g) => {
                    const n = g.latest;
                    const IconCmp = resolveIcon(n.icon) ?? LucideIcons.Circle;
                    const isUnread = g.unreadCount > 0;
                    const extra = g.items.length - 1;
                    const title =
                      g.isConversation && !g.isSingle
                        ? t("notifications.grouped.messagesFrom", {
                            name: pickTitle(n, lang),
                            defaultValue: `Messages from ${pickTitle(n, lang)}`,
                          })
                        : pickTitle(n, lang);
                    return (
                      <li key={g.key} className="py-3 flex items-start gap-3">
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
                                onClick={() => {
                                  g.items.forEach((it) => {
                                    if (!it.read_at) markOne.mutate(it.id);
                                  });
                                }}
                                className={[
                                  "text-sm truncate hover:underline",
                                  isUnread ? "font-semibold" : "font-medium",
                                ].join(" ")}
                              >
                                {title}
                              </a>
                            ) : (
                              <span
                                className={[
                                  "text-sm truncate",
                                  isUnread ? "font-semibold" : "font-medium",
                                ].join(" ")}
                              >
                                {title}
                              </span>
                            )}
                            {g.unreadCount > 0 && (
                              <span
                                className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                                aria-label={t("notifications.unread", { count: g.unreadCount })}
                              >
                                {g.unreadCount > 99 ? "99+" : g.unreadCount}
                              </span>
                            )}
                          </div>
                          {pickBody(n, lang) && (
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                              {pickBody(n, lang)}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
                            <span>{fmtDate(n.created_at, lang)}</span>
                            {extra > 0 && (
                              <span>
                                {t("notifications.grouped.moreMessages", {
                                  count: extra,
                                  defaultValue: `+${extra}`,
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isUnread ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                g.items.forEach((it) => {
                                  if (!it.read_at) markOne.mutate(it.id);
                                })
                              }
                              aria-label={t("notifications.markRead", {
                                defaultValue: "Oznacz jako przeczytane",
                              })}
                              title={t("notifications.markRead", {
                                defaultValue: "Oznacz jako przeczytane",
                              })}
                            >
                              <LucideIcons.Check className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => unreadOne.mutate(g.latest.id)}
                              aria-label={t("notifications.markUnread", {
                                defaultValue: "Oznacz jako nieprzeczytane",
                              })}
                              title={t("notifications.markUnread", {
                                defaultValue: "Oznacz jako nieprzeczytane",
                              })}
                            >
                              <LucideIcons.Mail className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOne.mutate(g.latest.id)}
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
          ) : (
            <TabsContent value="settings" className="mt-4 space-y-6">
              <div>
                <h3 className="text-sm font-semibold">
                  {t("notifications.settings.kindsHeader", { defaultValue: "Typy powiadomień" })}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("notifications.settings.subtitle", {
                    defaultValue: "Wybierz, jakie alerty trafiają do skrzynki.",
                  })}
                </p>
                <div className="mt-3 space-y-2">
                  {TOGGLEABLE_KINDS.map((kind) => {
                    const key = `enabled_${kind}` as keyof NotificationPreferences;
                    const id = `notif-kind-${kind}`;
                    return (
                      <div
                        key={kind}
                        className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"
                      >
                        <Label htmlFor={id} className="text-sm font-normal">
                          {t(`notifications.settings.kinds.${kind}`, { defaultValue: kind })}
                        </Label>
                        <Switch
                          id={id}
                          checked={Boolean(prefs[key])}
                          disabled={updatePrefs.isPending}
                          onCheckedChange={(v) => patch({ [key]: v } as Partial<NotificationPreferences>)}
                        />
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between rounded-md border border-dashed border-border/60 px-3 py-2 opacity-70">
                    <Label className="text-sm font-normal">
                      {t("notifications.settings.kinds.security", {
                        defaultValue: "Alerty bezpieczeństwa (zawsze włączone)",
                      })}
                    </Label>
                    <Switch checked disabled />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold">
                  {t("notifications.settings.behaviourHeader", {
                    defaultValue: "Zachowanie domyślne",
                  })}
                </h3>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="pref-auto-mark" className="text-sm font-normal">
                        {t("notifications.settings.autoMarkOnOpen", {
                          defaultValue:
                            "Automatycznie oznaczaj wiadomości jako przeczytane po otwarciu czatu",
                        })}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.autoMarkOnOpenHint", {
                          defaultValue:
                            "Wyłącz, żeby powiadomienia zostawały do ręcznego zamknięcia.",
                        })}
                      </p>
                    </div>
                    <Switch
                      id="pref-auto-mark"
                      checked={prefs.auto_mark_on_open}
                      disabled={updatePrefs.isPending}
                      onCheckedChange={(v) => patch({ auto_mark_on_open: v })}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="pref-group" className="text-sm font-normal">
                        {t("notifications.settings.groupByConversation", {
                          defaultValue: "Grupuj powiadomienia o wiadomościach wg rozmowy",
                        })}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.groupByConversationHint", {
                          defaultValue: "Zwiń wiele wiadomości z tego samego czatu w jeden wpis.",
                        })}
                      </p>
                    </div>
                    <Switch
                      id="pref-group"
                      checked={prefs.group_by_conversation}
                      disabled={updatePrefs.isPending}
                      onCheckedChange={(v) => patch({ group_by_conversation: v })}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
