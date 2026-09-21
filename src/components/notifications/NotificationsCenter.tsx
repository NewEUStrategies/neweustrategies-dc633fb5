// Notification center - full inbox embedded inside /messages.
// - Search box (title/body/href text) + kind filter dropdown
// - Group-level quick actions (mark whole group read / unread)
// - Settings tab (toggle notification kinds + default behaviour)
// - Realtime: notifications + notification_preferences (widgets stay in sync)
// - Multi-tenant: RLS scopes rows to auth.uid() + current_tenant_id
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
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
  useNotificationsInfinite,
  useNotificationPreferences,
  useNotificationPreferencesRealtime,
  useNotificationsRealtime,
  useUpdateNotificationPreferences,
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationKind,
  type NotificationRow,
  type NotificationPreferences,
} from "@/lib/notifications/useNotifications";
import { groupNotifications } from "@/lib/notifications/grouping";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_GROUPS,
  isNotificationKindEnabled,
} from "@/lib/notifications/preferences";
import { NotificationKindToggle } from "./molecules/NotificationKindToggle";
import {
  disablePushForThisBrowser,
  enablePushForThisBrowser,
  isPushSupported,
  vapidPublicKey,
} from "@/lib/notifications/push";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNotificationActorProfiles } from "@/lib/notifications/useActorProfiles";
import {
  isInternalHref,
  isPlainLeftClick,
  notificationActorId,
} from "@/lib/notifications/notificationLink";
import { fmtDate, pickBody, pickTitle } from "@/lib/notifications/notificationText";
import {
  NOTIFICATION_LIST_FILTERS,
  listKeyIsOnlyUnread,
} from "@/lib/notifications/notificationListKeys";
import { ConsentsPanel } from "./ConsentsPanel";
import type { AppLang } from "@/lib/i18n/localePath";

type Lang = AppLang;
type TabValue = "all" | "unread" | "settings";
type KindFilter = "all" | NotificationKind;

// Toggleable kinds + gating live in @/lib/notifications/preferences (pure, unit-tested).

// Filtr skrzynki jedzie z katalogu rodzajów, a nie z ręcznej listy - ręczna
// gubiła tracker/connection/security, więc powiadomienia tych rodzajów nie dało
// się odfiltrować mimo że lądują w skrzynce.
const KIND_OPTIONS: KindFilter[] = ["all", ...NOTIFICATION_KINDS];

// Rozmiar strony pochodzi z warstwy danych - Bell i Center współdzielą cache
// tylko wtedy, gdy używają tego samego `pageSize` (patrz useNotifications.ts).

function NotificationIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  if (!name) return <Circle className={className} aria-hidden />;
  return <DynamicIcon name={name} className={className} />;
}

// Odnośniki wewnętrzne dostają nawigację SPA (bez pełnego przeładowania),
// zewnętrzne zostają zwykłymi kotwicami - ta sama reguła co w dzwonku.
// Predykaty żyją w `@/lib/notifications/notificationLink`, a rozpoznanie kluczy
// cache listy (pułapka wspólnego prefiksu `notifications`) w
// `@/lib/notifications/notificationListKeys` - oba czyste i otestowane
// jednostkowo, bez renderu tego organizmu.

type NotificationInfiniteData = InfiniteData<NotificationRow[], number>;
type NotificationListSnapshot = Array<[QueryKey, NotificationInfiniteData | undefined]>;

export type NotificationsCenterMode = "full" | "inbox" | "preferences" | "consents";

export function NotificationsCenter({ mode = "full" }: { mode?: NotificationsCenterMode } = {}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const initialTab: TabValue = mode === "preferences" || mode === "consents" ? "settings" : "all";
  const [tab, setTab] = useState<TabValue>(initialTab);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  // Paginacja jest teraz w warstwie danych - `useNotificationsInfinite`
  // trzyma strony w cache i sam resetuje je przy zmianie queryKey (tab/kind).

  useNotificationsRealtime();
  useNotificationPreferencesRealtime();

  const router = useRouter();
  const qc = useQueryClient();
  const prefsQ = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const prefs: NotificationPreferences = prefsQ.data ?? DEFAULT_NOTIFICATION_PREFERENCES;

  const listQ = useNotificationsInfinite({
    onlyUnread: tab === "unread",
    kind: kindFilter === "all" ? null : kindFilter,
  });
  const markAll = useMarkAllNotificationsRead();

  // Optimistic-cache plumbing shared by the mutations below: cancel in-flight
  // list fetches (so a stale response cannot clobber the patch), snapshot every
  // cached notifications list, apply the updater per list, and hand back the
  // snapshot for rollback on error.
  // Optymistyczne łatanie działa na `InfiniteData<NotificationRow[]>`:
  // walkujemy strony i patchujemy każdą - jeden mapper zachowuje układ stron
  // (żeby paginacja nie posypała się po mark-read/delete).
  const patchNotificationLists = async (
    patch: (rows: NotificationRow[], key: QueryKey) => NotificationRow[],
  ): Promise<{ previous: NotificationListSnapshot }> => {
    await qc.cancelQueries(NOTIFICATION_LIST_FILTERS);
    const previous = qc.getQueriesData<NotificationInfiniteData>(NOTIFICATION_LIST_FILTERS);
    for (const [key, cached] of previous) {
      if (!cached) continue;
      qc.setQueryData<NotificationInfiniteData>(key, {
        ...cached,
        pages: cached.pages.map((rows) => patch(rows, key)),
      });
    }
    return { previous };
  };
  const rollbackNotificationLists = (ctx: { previous: NotificationListSnapshot } | undefined) => {
    for (const [key, cached] of ctx?.previous ?? []) qc.setQueryData(key, cached);
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

  // Spłaszczamy strony do jednej tablicy - komponent renderuje ciągłą listę,
  // a `fetchNextPage()` domawia kolejne strony pod tym samym queryKey.
  const items: NotificationRow[] = useMemo(() => listQ.data?.pages.flat() ?? [], [listQ.data]);
  const canLoadMore = !!listQ.hasNextPage;

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
      onSuccess: () => toast.success(t("notifications.settings.saved")),
      onError: () => toast.error(t("notifications.settings.saveError")),
    });
  };

  // Kanały doręczeń: push wymaga zgody przeglądarki + zapisu subskrypcji,
  // więc przełącznik ma własny stan zajętości zamiast updatePrefs.isPending.
  const { user } = useAuth();
  const actorProfiles = useNotificationActorProfiles(items, !!user);
  const [pushBusy, setPushBusy] = useState(false);
  // Klucz VAPID pobierany jest z serwera (sekret), więc dostępność push
  // ustala się po hydracji - do tego czasu przełącznik pozostaje ukryty.
  const [pushKeyReady, setPushKeyReady] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!isPushSupported()) return;
    void vapidPublicKey().then((key) => {
      if (alive) setPushKeyReady(!!key);
    });
    return () => {
      alive = false;
    };
  }, []);
  const pushAvailable = isPushSupported() && pushKeyReady;
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
          ? t("notifications.settings.pushDenied")
          : t("notifications.settings.pushError"),
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
            {t("notifications.markAllRead")}
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
                <TabsTrigger value="all">{t("notifications.filters.all")}</TabsTrigger>
                <TabsTrigger value="unread">{t("notifications.filters.unread")}</TabsTrigger>
                {showSettingsTab && (
                  <TabsTrigger value="settings">{t("notifications.filters.settings")}</TabsTrigger>
                )}
              </TabsList>
            </div>
          )}
          {mode === "inbox" && (
            <div className="px-3 sm:px-4 pt-3">
              <TabsList>
                <TabsTrigger value="all">{t("notifications.filters.all")}</TabsTrigger>
                <TabsTrigger value="unread">{t("notifications.filters.unread")}</TabsTrigger>
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
                    placeholder={t("notifications.searchPlaceholder")}
                    aria-label={t("notifications.searchPlaceholder")}
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
                          ? t("notifications.filters.allKinds")
                          : t(`notifications.settings.kinds.${k}`, { defaultValue: k })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pb-3">
                {listQ.isLoading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {t("common.loading")}
                  </div>
                ) : groups.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    <BellOff className="mx-auto mb-3 h-8 w-8 opacity-40" aria-hidden />
                    {query || kindFilter !== "all"
                      ? t("notifications.noMatches")
                      : t("notifications.empty")}
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
                            })
                          : pickTitle(n, lang);
                      const allIds = g.items.map((i) => i.id);
                      const unreadIds = g.items.filter((i) => !i.read_at).map((i) => i.id);
                      const href = n.href;
                      const actorId = notificationActorId(n.href);
                      const actor = actorId ? actorProfiles.get(actorId) : undefined;
                      const initials =
                        (actor?.display_name ?? pickTitle(n, lang))
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((w) => w[0]?.toUpperCase() ?? "")
                          .join("") || "•";
                      return (
                        <li key={g.key} className="py-3 flex items-start gap-3">
                          <Avatar
                            className={cn(
                              "mt-0.5 h-9 w-9 shrink-0 rounded-[6px] border border-border/60",
                              isUnread ? "ring-1 ring-primary/40" : "",
                            )}
                          >
                            {actor?.avatar_url ? (
                              <AvatarImage
                                src={actor.avatar_url}
                                alt={actor.display_name ?? pickTitle(n, lang)}
                                className="rounded-[6px] object-cover"
                              />
                            ) : null}
                            <AvatarFallback
                              className={cn(
                                "rounded-[6px] text-[11px] font-semibold",
                                isUnread
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted text-muted-foreground",
                              )}
                              aria-hidden={!actor}
                            >
                              {actor ? (
                                initials
                              ) : (
                                <NotificationIcon name={n.icon} className="h-4 w-4" />
                              )}
                            </AvatarFallback>
                          </Avatar>
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
                                    "text-[15px] truncate hover:underline",
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
                                    "text-[15px] truncate hover:underline",
                                    isUnread ? "font-semibold" : "font-medium",
                                  )}
                                >
                                  {title}
                                </a>
                              ) : (
                                <span
                                  className={cn(
                                    "text-[15px] truncate",
                                    isUnread ? "font-semibold" : "font-medium",
                                  )}
                                >
                                  {title}
                                </span>
                              )}
                              {g.unreadCount > 0 && (
                                <UnreadBadge
                                  count={g.unreadCount}
                                  size="sm"
                                  className="rounded-[6px]"
                                  labelKey="notifications.unread"
                                />
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
                                    ? t("notifications.markGroupRead")
                                    : t("notifications.markRead")
                                }
                                title={
                                  g.isConversation && !g.isSingle
                                    ? t("notifications.markGroupRead")
                                    : t("notifications.markRead")
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
                                    ? t("notifications.markGroupUnread")
                                    : t("notifications.markUnread")
                                }
                                title={
                                  g.isConversation && !g.isSingle
                                    ? t("notifications.markGroupUnread")
                                    : t("notifications.markUnread")
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
                                  ? t("notifications.deleteGroup")
                                  : t("common.delete")
                              }
                              title={
                                g.isConversation && !g.isSingle
                                  ? t("notifications.deleteGroup")
                                  : t("common.delete")
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
                      disabled={listQ.isFetchingNextPage}
                      onClick={() => void listQ.fetchNextPage()}
                      aria-label={t("notifications.loadMore")}
                    >
                      {listQ.isFetchingNextPage
                        ? t("common.loading")
                        : t("notifications.loadMore", {
                            count: NOTIFICATIONS_PAGE_SIZE,
                          })}
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
                <h3 className="text-sm font-semibold">{t("notifications.settings.kindsHeader")}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("notifications.settings.subtitle")}
                </p>
                {/* Sekcje tematyczne z katalogu (@/lib/notifications/preferences):
                    szesnaście jednakowych wierszy to ściana, a nie wybór. Podział
                    i kolejność są danymi, nie strukturą JSX. */}
                <div className="mt-3 space-y-4">
                  {NOTIFICATION_KIND_GROUPS.map((group) => (
                    <section key={group.id} aria-labelledby={`notif-group-${group.id}`}>
                      <h4
                        id={`notif-group-${group.id}`}
                        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/70"
                      >
                        <NotificationIcon name={group.icon} className="h-3.5 w-3.5 text-primary" />
                        {t(`notifications.settings.kindGroups.${group.id}`, {
                          defaultValue: group.id,
                        })}
                      </h4>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(`notifications.settings.kindGroups.${group.id}Hint`, {
                          defaultValue: "",
                        })}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {group.kinds.map((kind) => (
                          <NotificationKindToggle
                            key={kind}
                            kind={kind}
                            label={t(`notifications.settings.kinds.${kind}`, {
                              defaultValue: kind,
                            })}
                            checked={isNotificationKindEnabled(prefs, kind)}
                            disabled={updatePrefs.isPending}
                            onCheckedChange={(v) =>
                              patch({
                                [`enabled_${kind}`]: v,
                              } as Partial<NotificationPreferences>)
                            }
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                  <NotificationKindToggle
                    kind="security"
                    alwaysOn
                    label={t("notifications.settings.kinds.security")}
                    checked={isNotificationKindEnabled(prefs, "security")}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold">
                  {t("notifications.settings.behaviourHeader")}
                </h3>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="pref-chat-bell" className="text-sm font-normal">
                        {t("notifications.settings.chatBell")}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.chatBellHint")}
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
                        {t("notifications.settings.autoMarkOnOpen")}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.autoMarkOnOpenHint")}
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
                        {t("notifications.settings.groupByConversation")}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.groupByConversationHint")}
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
                  {t("notifications.settings.channelsHeader")}
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("notifications.settings.channelsSubtitle")}
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <Label htmlFor="pref-push" className="text-sm font-normal">
                        {t("notifications.settings.push")}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {pushAvailable
                          ? t("notifications.settings.pushHint")
                          : t("notifications.settings.pushUnsupported")}
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
                        {t("notifications.settings.digest")}
                      </Label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t("notifications.settings.digestHint")}
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
                        <SelectItem value="off">{t("notifications.settings.digestOff")}</SelectItem>
                        <SelectItem value="daily">
                          {t("notifications.settings.digestDaily")}
                        </SelectItem>
                        <SelectItem value="weekly">
                          {t("notifications.settings.digestWeekly")}
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
