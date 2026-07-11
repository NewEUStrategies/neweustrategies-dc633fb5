// Notification center - full inbox embedded inside /messages.
// - Search box (title/body/href text) + kind filter dropdown
// - Group-level quick actions (mark whole group read / unread)
// - Settings tab (toggle notification kinds + default behaviour)
// - Realtime: notifications + notification_preferences (widgets stay in sync)
// - Multi-tenant: RLS scopes rows to auth.uid() + current_tenant_id
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as LucideIcons from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useNotifications,
  useNotificationPreferences,
  useNotificationPreferencesRealtime,
  useNotificationsRealtime,
  useUpdateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
  type NotificationRow,
  type NotificationPreferences,
} from "@/lib/notifications/useNotifications";
import { groupNotifications } from "@/lib/notifications/grouping";
import { cn } from "@/lib/utils";

type Lang = "pl" | "en";
type TabValue = "all" | "unread" | "settings";
type KindFilter = "all" | NotificationKind;

const TOGGLEABLE_KINDS = [
  "message",
  "comment",
  "follow",
  "subscription",
  "content",
  "system",
] as const;

const KIND_OPTIONS: KindFilter[] = [
  "all",
  "message",
  "comment",
  "follow",
  "subscription",
  "content",
  "system",
];

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

export type NotificationsCenterMode = "full" | "inbox" | "preferences";

export function NotificationsCenter({ mode = "full" }: { mode?: NotificationsCenterMode } = {}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const initialTab: TabValue = mode === "preferences" ? "settings" : "all";
  const [tab, setTab] = useState<TabValue>(initialTab);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  useNotificationsRealtime();
  useNotificationPreferencesRealtime();

  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPreferences = prefsQ.data ?? DEFAULT_NOTIFICATION_PREFERENCES;

  const listQ = useNotifications({
    limit: 200,
    onlyUnread: tab === "unread",
    kind: kindFilter === "all" ? null : kindFilter,
  });
  const markAll = useMarkAllNotificationsRead();
  const markMany = useMarkNotificationsRead();
  const unreadMany = useMarkNotificationsUnread();
  const removeOne = useDeleteNotification();

  const items = listQ.data ?? [];

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((n) => {
      const t1 = pickTitle(n, lang).toLowerCase();
      const t2 = (pickBody(n, lang) ?? "").toLowerCase();
      const t3 = (n.href ?? "").toLowerCase();
      return t1.includes(q) || t2.includes(q) || t3.includes(q);
    });
  }, [items, query, lang]);

  const unreadCount = filteredItems.filter((n) => !n.read_at).length;
  const groups = groupNotifications(filteredItems, {
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

  const showInboxTabs = mode !== "preferences";
  const showSettingsTab = mode !== "inbox";
  const headerTitleKey = mode === "preferences" ? "notifications.settings.title" : "notifications.title";
  const headerTitleDefault = mode === "preferences" ? "Zgody i powiadomienia" : "Powiadomienia";
  const headerSubtitleKey = mode === "preferences" ? "notifications.settings.subtitleLead" : "notifications.inboxSubtitle";
  const headerSubtitleDefault =
    mode === "preferences"
      ? "Zdecyduj, o czym chcesz być informowany. Zmiany zapisują się natychmiast."
      : "Twoja prywatna skrzynka - widzisz tylko własne powiadomienia.";

  return (
    <Card className="border-0 rounded-none shadow-none h-full flex flex-col bg-transparent">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-3 sm:px-4 border-b border-border/60">
        <div className="min-w-0">
          <CardTitle className="text-base">
            {t(headerTitleKey, { defaultValue: headerTitleDefault })}
          </CardTitle>
          <p className="text-xs text-muted-foreground truncate">
            {t(headerSubtitleKey, { defaultValue: headerSubtitleDefault })}
          </p>
        </div>
        {showInboxTabs && tab !== "settings" && (
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
      <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabValue)}
          className="flex-1 min-h-0 flex flex-col"
        >
          {mode === "full" && (
            <div className="px-3 sm:px-4 pt-3">
              <TabsList>
                <TabsTrigger value="all">
                  {t("notifications.filters.all", { defaultValue: "Wszystkie" })}
                </TabsTrigger>
                <TabsTrigger value="unread">
                  {t("notifications.filters.unread", { defaultValue: "Nieprzeczytane" })}
                </TabsTrigger>
                {showSettingsTab && (
                  <TabsTrigger value="settings">
                    {t("notifications.filters.settings", { defaultValue: "Ustawienia" })}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
          )}
          {mode === "inbox" && (
            <div className="px-3 sm:px-4 pt-3">
              <TabsList>
                <TabsTrigger value="all">
                  {t("notifications.filters.all", { defaultValue: "Wszystkie" })}
                </TabsTrigger>
                <TabsTrigger value="unread">
                  {t("notifications.filters.unread", { defaultValue: "Nieprzeczytane" })}
                </TabsTrigger>
              </TabsList>
            </div>
          )}

          {showInboxTabs && tab !== "settings" ? (
            <TabsContent
              value={tab}
              className="mt-3 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden"
              forceMount
            >
              {/* Search + kind filter */}
              <div className="px-3 sm:px-4 pb-2 flex flex-col sm:flex-row gap-2">
                <label className="relative flex-1">
                  <LucideIcons.Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("notifications.searchPlaceholder", {
                      defaultValue: "Szukaj po treści, nadawcy...",
                    })}
                    aria-label={t("notifications.searchPlaceholder", {
                      defaultValue: "Szukaj po treści, nadawcy...",
                    })}
                    className="h-9 w-full rounded-[6px] border border-input bg-muted/40 !pl-[38px] pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as KindFilter)}>
                  <SelectTrigger className="h-9 sm:w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KIND_OPTIONS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k === "all"
                          ? t("notifications.filters.allKinds", {
                              defaultValue: "Wszystkie typy",
                            })
                          : t(`notifications.settings.kinds.${k}`, { defaultValue: k })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-3">
                {listQ.isLoading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {t("common.loading", { defaultValue: "Ładowanie..." })}
                  </div>
                ) : groups.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <LucideIcons.BellOff className="mx-auto mb-3 h-8 w-8 opacity-40" aria-hidden />
                    {query || kindFilter !== "all"
                      ? t("notifications.noMatches", {
                          defaultValue: "Brak wyników dla zadanych filtrów",
                        })
                      : t("notifications.empty", { defaultValue: "Brak powiadomień" })}
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
                      const allIds = g.items.map((i) => i.id);
                      const unreadIds = g.items.filter((i) => !i.read_at).map((i) => i.id);
                      return (
                        <li key={g.key} className="py-3 flex items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 shrink-0 rounded-full p-2",
                              isUnread
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground",
                            )}
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
                                    if (unreadIds.length > 0) markMany.mutate(unreadIds);
                                  }}
                                  className={cn(
                                    "text-sm truncate hover:underline",
                                    isUnread ? "font-semibold" : "font-medium",
                                  )}
                                >
                                  {title}
                                </a>
                              ) : (
                                <span
                                  className={cn(
                                    "text-sm truncate",
                                    isUnread ? "font-semibold" : "font-medium",
                                  )}
                                >
                                  {title}
                                </span>
                              )}
                              {g.unreadCount > 0 && (
                                <span
                                  className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                                  aria-label={t("notifications.unread", {
                                    count: g.unreadCount,
                                  })}
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
                                onClick={() => markMany.mutate(unreadIds)}
                                aria-label={
                                  g.isConversation && !g.isSingle
                                    ? t("notifications.markGroupRead", {
                                        defaultValue: "Oznacz całą rozmowę jako przeczytaną",
                                      })
                                    : t("notifications.markRead", {
                                        defaultValue: "Oznacz jako przeczytane",
                                      })
                                }
                                title={
                                  g.isConversation && !g.isSingle
                                    ? t("notifications.markGroupRead", {
                                        defaultValue: "Oznacz całą rozmowę jako przeczytaną",
                                      })
                                    : t("notifications.markRead", {
                                        defaultValue: "Oznacz jako przeczytane",
                                      })
                                }
                              >
                                <LucideIcons.Check className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => unreadMany.mutate(allIds)}
                                aria-label={
                                  g.isConversation && !g.isSingle
                                    ? t("notifications.markGroupUnread", {
                                        defaultValue: "Oznacz całą rozmowę jako nieprzeczytaną",
                                      })
                                    : t("notifications.markUnread", {
                                        defaultValue: "Oznacz jako nieprzeczytane",
                                      })
                                }
                                title={
                                  g.isConversation && !g.isSingle
                                    ? t("notifications.markGroupUnread", {
                                        defaultValue: "Oznacz całą rozmowę jako nieprzeczytaną",
                                      })
                                    : t("notifications.markUnread", {
                                        defaultValue: "Oznacz jako nieprzeczytane",
                                      })
                                }
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
              </div>
            </TabsContent>
          ) : (
            <TabsContent
              value="settings"
              className="mt-3 flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-4 space-y-6"
            >
              <div>
                <h3 className="text-sm font-semibold">
                  {t("notifications.settings.kindsHeader", {
                    defaultValue: "Typy powiadomień",
                  })}
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
                          onCheckedChange={(v) =>
                            patch({ [key]: v } as Partial<NotificationPreferences>)
                          }
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
