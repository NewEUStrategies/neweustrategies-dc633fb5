// Notification center - full inbox embedded inside /messages.
// - Search box (title/body/href text) + kind filter dropdown
// - Group-level quick actions (mark whole group read / unread)
// - Settings tab (toggle notification kinds + default behaviour)
// - Realtime: notifications + notification_preferences (widgets stay in sync)
// - Multi-tenant: RLS scopes rows to auth.uid() + current_tenant_id
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
// Nazwane importy + DynamicIcon zamiast namespace-importu lucide-react:
// namespace-import - nawet z chunka trasy - materializuje pełny rejestr
// (~640 KB raw) w bundlu wejściowym (patrz lib/icons/DynamicIconFull).
import { BellOff, Check, CheckCheck, Circle, Mail, Search, Trash2 } from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { supabase } from "@/integrations/supabase/client";
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
  useMarkAllNotificationsRead,
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
import {
  TOGGLEABLE_NOTIFICATION_KINDS,
  isNotificationKindEnabled,
} from "@/lib/notifications/preferences";
import {
  disablePushForThisBrowser,
  enablePushForThisBrowser,
  isPushSupported,
  vapidPublicKey,
} from "@/lib/notifications/push";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { ConsentsPanel } from "./ConsentsPanel";

type Lang = "pl" | "en";
type TabValue = "all" | "unread" | "settings";
type KindFilter = "all" | NotificationKind;

// Toggleable kinds + gating live in @/lib/notifications/preferences (pure, unit-tested).

const KIND_OPTIONS: KindFilter[] = [
  "all",
  "message",
  "comment",
  "follow",
  "subscription",
  "content",
  "saved_search",
  "system",
];

/** Rows fetched per page; "load more" grows the window by this amount. */
const NOTIFICATIONS_PAGE_SIZE = 50;

function pickTitle(n: NotificationRow, lang: Lang): string {
  return (lang === "en" && n.title_en) || n.title_pl;
}
function pickBody(n: NotificationRow, lang: Lang): string | null {
  return lang === "en" ? (n.body_en ?? n.body_pl) : (n.body_pl ?? n.body_en);
}
function fmtDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function NotificationIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  if (!name) return <Circle className={className} aria-hidden />;
  return <DynamicIcon name={name} className={className} />;
}

// Internal links get SPA navigation (no full reload); external ones stay
// plain anchors - same rule the header bell applies.
//
// Internal hrefs render a real <a href> for semantics, but plain left-clicks
// are hijacked and routed through router.navigate({ href }). Unlike
// <Link to={href}> - which treats `to` as a pathname verbatim and never splits
// out `?search`, 404-ing "/messages?c=<uuid>" - navigate({ href }) parses the
// query string correctly, so search params survive client-side navigation.
function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

// Unmodified left-click - the only case we hijack for SPA navigation.
// Modified clicks (ctrl/cmd/shift/alt, middle button) keep native anchor
// behaviour like open-in-new-tab; the real href makes that work.
function isPlainLeftClick(e: ReactMouseEvent<HTMLAnchorElement>): boolean {
  return (
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}

// React-query plumbing for optimistic updates. List caches live under
// ["notifications", <uid>, <filter>] (see useNotifications). The same
// "notifications" prefix also covers the preferences and unread-count queries,
// whose data is NOT a row array - list entries are recognized by key shape
// (third element is the filter object).
function isNotificationListQuery(query: { queryKey: readonly unknown[] }): boolean {
  const key = query.queryKey;
  return (
    key[0] === "notifications" && key.length === 3 && typeof key[2] === "object" && key[2] !== null
  );
}

const NOTIFICATION_LIST_FILTERS = {
  queryKey: ["notifications"],
  predicate: isNotificationListQuery,
};

/** Does this list cache hold only unread rows? (its filter set onlyUnread) */
function listKeyIsOnlyUnread(key: readonly unknown[]): boolean {
  const filter = key[2];
  return (
    typeof filter === "object" &&
    filter !== null &&
    "onlyUnread" in filter &&
    filter.onlyUnread === true
  );
}

type NotificationListSnapshot = Array<[QueryKey, NotificationRow[] | undefined]>;

export type NotificationsCenterMode = "full" | "inbox" | "preferences" | "consents";

export function NotificationsCenter({ mode = "full" }: { mode?: NotificationsCenterMode } = {}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const initialTab: TabValue = mode === "preferences" || mode === "consents" ? "settings" : "all";
  const [tab, setTab] = useState<TabValue>(initialTab);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [limit, setLimit] = useState(NOTIFICATIONS_PAGE_SIZE);

  // Switching tab/kind starts a fresh window - never carry an inflated limit
  // (grown by "load more") into a different filter.
  useEffect(() => {
    setLimit(NOTIFICATIONS_PAGE_SIZE);
  }, [tab, kindFilter]);

  useNotificationsRealtime();
  useNotificationPreferencesRealtime();

  const router = useRouter();
  const qc = useQueryClient();
  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPreferences = prefsQ.data ?? DEFAULT_NOTIFICATION_PREFERENCES;

  const listQ = useNotifications({
    limit,
    onlyUnread: tab === "unread",
    kind: kindFilter === "all" ? null : kindFilter,
  });
  const markAll = useMarkAllNotificationsRead();

  // Optimistic-cache plumbing shared by the mutations below: cancel in-flight
  // list fetches (so a stale response cannot clobber the patch), snapshot every
  // cached notifications list, apply the updater per list, and hand back the
  // snapshot for rollback on error.
  const patchNotificationLists = async (
    patch: (rows: NotificationRow[], key: QueryKey) => NotificationRow[],
  ): Promise<{ previous: NotificationListSnapshot }> => {
    await qc.cancelQueries(NOTIFICATION_LIST_FILTERS);
    const previous = qc.getQueriesData<NotificationRow[]>(NOTIFICATION_LIST_FILTERS);
    for (const [key, rows] of previous) {
      if (rows) qc.setQueryData(key, patch(rows, key));
    }
    return { previous };
  };
  const rollbackNotificationLists = (ctx: { previous: NotificationListSnapshot } | undefined) => {
    for (const [key, rows] of ctx?.previous ?? []) qc.setQueryData(key, rows);
  };
  // Re-sync with the server whatever happened - the "notifications" prefix
  // also covers the unread-count query, so it stays consistent too.
  const invalidateNotifications = () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  // Mark-read / mark-unread: optimistic variants of the shared hooks (same
  // RPCs), so rows flip state instantly instead of waiting for invalidation.
  const markMany = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
      if (error) throw error;
    },
    onMutate: (ids: string[]) => {
      const idSet = new Set(ids);
      const readAt = new Date().toISOString();
      // Unread-only lists drop the rows entirely; the rest just flip read_at.
      return patchNotificationLists((rows, key) =>
        listKeyIsOnlyUnread(key)
          ? rows.filter((row) => !idSet.has(row.id))
          : rows.map((row) =>
              idSet.has(row.id) && !row.read_at ? { ...row, read_at: readAt } : row,
            ),
      );
    },
    onError: (_err, _ids, ctx) => rollbackNotificationLists(ctx),
    onSettled: invalidateNotifications,
  });
  const unreadMany = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.rpc("mark_notifications_unread", { p_ids: ids });
      if (error) throw error;
    },
    onMutate: (ids: string[]) => {
      const idSet = new Set(ids);
      return patchNotificationLists((rows) =>
        rows.map((row) => (idSet.has(row.id) && row.read_at ? { ...row, read_at: null } : row)),
      );
    },
    onError: (_err, _ids, ctx) => rollbackNotificationLists(ctx),
    onSettled: invalidateNotifications,
  });
  // Batch delete by id array - a grouped conversation collapses many rows into
  // one entry, so the trash button must remove EVERY member id (deleting only
  // the latest left the rest to resurface as a "new" group). One statement,
  // with the rows optimistically removed from every cached list up front.
  const deleteGroup = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from("notifications").delete().in("id", ids);
      if (error) throw error;
    },
    onMutate: (ids: string[]) => {
      const idSet = new Set(ids);
      return patchNotificationLists((rows) => rows.filter((row) => !idSet.has(row.id)));
    },
    onError: (_err, _ids, ctx) => rollbackNotificationLists(ctx),
    onSettled: invalidateNotifications,
  });

  const items = listQ.data ?? [];
  // The raw fetch (pre client-side search) hit the ceiling -> more may exist.
  const canLoadMore = items.length >= limit;

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

  // Kanały doręczeń: push wymaga zgody przeglądarki + zapisu subskrypcji,
  // więc przełącznik ma własny stan zajętości zamiast updatePrefs.isPending.
  const { user } = useAuth();
  const [pushBusy, setPushBusy] = useState(false);
  const pushAvailable = isPushSupported() && !!vapidPublicKey();
  const handlePushToggle = async (enabled: boolean) => {
    if (!user) return;
    setPushBusy(true);
    try {
      if (enabled) {
        await enablePushForThisBrowser(user.id);
      } else {
        await disablePushForThisBrowser();
      }
      patch({ push_enabled: enabled });
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      toast.error(
        code === "push_denied"
          ? t("notifications.settings.pushDenied", {
              defaultValue: "Przeglądarka odmówiła zgody na powiadomienia.",
            })
          : t("notifications.settings.pushError", {
              defaultValue: "Nie udało się włączyć powiadomień push.",
            }),
      );
    } finally {
      setPushBusy(false);
    }
  };

  const showInboxTabs = mode !== "preferences" && mode !== "consents";
  const showSettingsTab = mode !== "inbox" && mode !== "consents";
  const headerTitleKey =
    mode === "consents"
      ? "notifications.consents.title"
      : mode === "preferences"
        ? "notifications.settings.title"
        : "notifications.title";
  const headerTitleDefault =
    mode === "consents"
      ? "Zgody komunikacji"
      : mode === "preferences"
        ? "Ustawienia powiadomień"
        : "Powiadomienia";
  const headerSubtitleKey =
    mode === "consents"
      ? "notifications.consents.subtitle"
      : mode === "preferences"
        ? "notifications.settings.subtitleLead"
        : "notifications.inboxSubtitle";
  const headerSubtitleDefault =
    mode === "consents"
      ? "Zdecyduj, jakie wiadomości mogą do Ciebie trafiać. Każdą zmianę zapisujemy w niezmiennym rejestrze RODO."
      : mode === "preferences"
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
            <CheckCheck className="h-4 w-4 mr-1.5" />
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
                  <Search
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
                    <BellOff className="mx-auto mb-3 h-8 w-8 opacity-40" aria-hidden />
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
                      const href = n.href;
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
                            <NotificationIcon name={n.icon} className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {href && isInternalHref(href) ? (
                                <a
                                  href={href}
                                  onClick={(e) => {
                                    if (unreadIds.length > 0) markMany.mutate(unreadIds);
                                    if (!isPlainLeftClick(e)) return;
                                    e.preventDefault();
                                    void router.navigate({ href });
                                  }}
                                  className={cn(
                                    "text-sm truncate hover:underline",
                                    isUnread ? "font-semibold" : "font-medium",
                                  )}
                                >
                                  {title}
                                </a>
                              ) : href ? (
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
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
                                <Check className="h-3.5 w-3.5" />
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
                                <Mail className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deleteGroup.isPending}
                              onClick={() => deleteGroup.mutate(allIds)}
                              aria-label={
                                g.isConversation && !g.isSingle
                                  ? t("notifications.deleteGroup", {
                                      defaultValue: "Usuń całą rozmowę",
                                    })
                                  : t("common.delete", { defaultValue: "Usuń" })
                              }
                              title={
                                g.isConversation && !g.isSingle
                                  ? t("notifications.deleteGroup", {
                                      defaultValue: "Usuń całą rozmowę",
                                    })
                                  : t("common.delete", { defaultValue: "Usuń" })
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!listQ.isLoading && canLoadMore && (
                  <div className="pt-3 flex justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={listQ.isFetching}
                      onClick={() => setLimit((n) => n + NOTIFICATIONS_PAGE_SIZE)}
                    >
                      {listQ.isFetching
                        ? t("common.loading", { defaultValue: "Ładowanie..." })
                        : t("notifications.loadMore", { defaultValue: "Załaduj więcej" })}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          ) : mode === "consents" ? (
            <TabsContent
              value="settings"
              className="mt-3 flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-4"
            >
              <ConsentsPanel />
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
                  {TOGGLEABLE_NOTIFICATION_KINDS.map((kind) => {
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
                          checked={isNotificationKindEnabled(prefs, kind)}
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
                    <Switch checked={isNotificationKindEnabled(prefs, "security")} disabled />
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
                      <Label htmlFor="pref-chat-bell" className="text-sm font-normal">
                        {t("notifications.settings.chatBell", {
                          defaultValue: "Ikona czatu (dzwonek) w nagłówku",
                        })}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.chatBellHint", {
                          defaultValue:
                            "Wyłącz, żeby ukryć skrót do czatu w topbarze. Rozmowy nadal działają w /messages i doku.",
                        })}
                      </p>
                    </div>
                    <Switch
                      id="pref-chat-bell"
                      checked={prefs.chat_bell_enabled}
                      disabled={updatePrefs.isPending}
                      onCheckedChange={(v) => patch({ chat_bell_enabled: v })}
                    />
                  </div>
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

              <div>
                <h3 className="text-sm font-semibold">
                  {t("notifications.settings.channelsHeader", {
                    defaultValue: "Kanały doręczeń",
                  })}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("notifications.settings.channelsSubtitle", {
                    defaultValue:
                      "Powiadomienia poza aplikacją: push w przeglądarce i zbiorczy e-mail.",
                  })}
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="pref-push" className="text-sm font-normal">
                        {t("notifications.settings.push", {
                          defaultValue: "Powiadomienia push w tej przeglądarce",
                        })}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {pushAvailable
                          ? t("notifications.settings.pushHint", {
                              defaultValue:
                                "Alert pojawi się nawet przy zamkniętej karcie. Każde urządzenie włączasz osobno.",
                            })
                          : t("notifications.settings.pushUnsupported", {
                              defaultValue:
                                "Ta przeglądarka lub instalacja nie wspiera powiadomień push.",
                            })}
                      </p>
                    </div>
                    <Switch
                      id="pref-push"
                      checked={prefs.push_enabled}
                      disabled={pushBusy || !pushAvailable || updatePrefs.isPending}
                      onCheckedChange={(v) => void handlePushToggle(v)}
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="pref-digest" className="text-sm font-normal">
                        {t("notifications.settings.digest", {
                          defaultValue: "Digest e-mail z nieprzeczytanych powiadomień",
                        })}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.digestHint", {
                          defaultValue: "Jedno zbiorcze podsumowanie zamiast pojedynczych e-maili.",
                        })}
                      </p>
                    </div>
                    <Select
                      value={prefs.email_digest}
                      onValueChange={(v) =>
                        patch({ email_digest: v as NotificationPreferences["email_digest"] })
                      }
                      disabled={updatePrefs.isPending}
                    >
                      <SelectTrigger id="pref-digest" className="w-36 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="off">
                          {t("notifications.settings.digestOff", { defaultValue: "Wyłączony" })}
                        </SelectItem>
                        <SelectItem value="daily">
                          {t("notifications.settings.digestDaily", { defaultValue: "Codziennie" })}
                        </SelectItem>
                        <SelectItem value="weekly">
                          {t("notifications.settings.digestWeekly", {
                            defaultValue: "Co tydzień",
                          })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
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

// Kanały doręczeń poza aplikacją: Web Push na tym urządzeniu + e-mailowy
// digest nieprzeczytanych. In-app (realtime) działa zawsze; push wymaga
// zgody przeglądarki i skonfigurowanego VAPID po stronie serwera.
function ChannelsSettings({
  prefs,
  pending,
  onPatch,
}: {
  prefs: NotificationPreferences;
  pending: boolean;
  onPatch: (patch: Partial<NotificationPreferences>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <h3 className="text-sm font-semibold">
        {t("notifications.settings.channelsHeader", { defaultValue: "Kanały doręczeń" })}
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("notifications.settings.channelsSubtitle", {
          defaultValue: "Docieraj do powiadomień także poza otwartą aplikacją.",
        })}
      </p>
      <div className="mt-3 space-y-2">
        <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <Label className="text-sm font-normal">
              {t("notifications.settings.digest", {
                defaultValue: "E-mailowe podsumowanie nieprzeczytanych",
              })}
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("notifications.settings.digestHint", {
                defaultValue:
                  "Zbiorczy e-mail z powiadomieniami, których nie przeczytasz w aplikacji. Puste podsumowania nie są wysyłane.",
              })}
            </p>
          </div>
          <Select
            value={prefs.email_digest}
            onValueChange={(v) =>
              onPatch({
                email_digest: v as NotificationPreferences["email_digest"],
              })
            }
            disabled={pending}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">
                {t("notifications.settings.digestOff", { defaultValue: "Wyłączone" })}
              </SelectItem>
              <SelectItem value="daily">
                {t("notifications.settings.digestDaily", { defaultValue: "Codziennie" })}
              </SelectItem>
              <SelectItem value="weekly">
                {t("notifications.settings.digestWeekly", { defaultValue: "Co tydzień" })}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
