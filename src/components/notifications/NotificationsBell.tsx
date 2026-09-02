// Header notification bell - molecule.
// - Popover with recent notifications, unread badge, mark-all-read, inbox link
// - Realtime updates (channel scoped per user_id)
// - Multi-tenant safe: reads go through RLS (auth.uid() + current_tenant_id)
// - i18n PL/EN, respects prefers-reduced-motion, uses semantic tokens only
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRouter } from "@tanstack/react-router";
// Nazwane importy + DynamicIcon zamiast `import * as lucide-react`: dzwonek
// renderuje się w chrome każdej strony, a namespace-import z dynamicznym
// lookupem wciągał CAŁĄ bibliotekę ikon (~640 KB raw) do bundla wejściowego.
import {
  AlarmClock,
  Bell,
  BellOff,
  BellRing,
  CalendarClock,
  Check,
  Circle,
  Crown,
  Eye,
  Handshake,
  HelpCircle,
  Inbox,
  Info,
  Landmark,
  Mail,
  MessageCircle,
  MessagesSquare,
  Quote,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";
import { useAuth } from "@/hooks/useAuth";
import {
  useNotificationsInfinite,
  useNotificationsRealtime,
  useNotificationPreferences,
  useNotificationPreferencesRealtime,
  useUnreadCountExcluding,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useMarkNotificationUnread,
  type NotificationKind,
  type NotificationRow,
} from "@/lib/notifications/useNotifications";
import { groupNotifications } from "@/lib/notifications/grouping";
import {
  isInternalHref,
  isPlainLeftClick,
  notificationActorId,
} from "@/lib/notifications/notificationLink";
import { pickBody, pickTitle, relTime } from "@/lib/notifications/notificationText";
import { useNotificationActorProfiles } from "@/lib/notifications/useActorProfiles";
import type { AppLang } from "@/lib/i18n/localePath";

// Ikona zapasowa per rodzaj (spójna z /profile/notifications), gdy producent
// nie zapisał własnej. Ikony po nazwie z DB (kebab-case) renderuje DynamicIcon
// (kurowany zestaw synchronicznie, resztę dociąga leniwie).
//
// Mapa jest KOMPLETNA (Record po NotificationKind) - dopisanie rodzaju bez
// ikony nie skompiluje się, zamiast po cichu spaść do neutralnego kółka.
const KIND_ICONS: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  system: Info,
  follow: UserPlus,
  content: Sparkles,
  subscription: Crown,
  comment: MessageCircle,
  security: ShieldAlert,
  connection: UserCheck,
  crm_task: AlarmClock,
  message: Mail,
  tracker: Landmark,
  saved_search: BellRing,
  expert_request: HelpCircle,
  introduction: Handshake,
  recommendation: Quote,
  endorsement: ThumbsUp,
  profile_view: Eye,
  meeting_booking: CalendarClock,
  club: MessagesSquare,
};

// `notifications.kind` przychodzi z bazy jako `string`, więc odczyt idzie przez
// widok mapy z indeksem stringowym - bez rzutowania i bez `any`.
const KIND_ICON_BY_NAME: Readonly<Record<string, React.ComponentType<{ className?: string }>>> =
  KIND_ICONS;

// Odnośnik wewnętrzny renderuje prawdziwe <a href> dla semantyki, ale
// niemodyfikowany klik lewym przyciskiem przechwytujemy na
// `router.navigate({ href })`. `<Link to={href}>` traktuje `to` jako czystą
// ścieżkę i NIGDY nie odcina `?search`, przez co "/messages?c=<uuid>" kończyło
// się 404; `navigate({ href })` parsuje query poprawnie. Predykaty
// (`isInternalHref`, `isPlainLeftClick`, `notificationActorId`) mieszkają
// w `@/lib/notifications/notificationLink` - jedna kopia dla dzwonka, skrzynki
// i warstwy profili aktorów.

/** Rodzaje obsługiwane przez ikonę czatu - dzwonek ich nie pokazuje. */
const CHAT_KINDS: readonly NotificationKind[] = ["message"];


export interface NotificationsBellProps {
  panelWidth?: number;
}

export function NotificationsBell({ panelWidth = 340 }: NotificationsBellProps) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const lang: AppLang = i18n.language === "en" ? "en" : "pl";
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Always call hooks in the same order - even when unauth we render nothing.
  useNotificationsRealtime();
  useNotificationPreferencesRealtime();
  // Współdzielony cache z NotificationsCenter (identyczny queryKey przy pustym
  // filtrze) - jedno zapytanie zasila dzwonek i skrzynkę po zalogowaniu.
  // Powiadomienia o wiadomościach czatu NIE należą do dzwonka - ich miejscem
  // jest ikona czatu (licznik + podgląd treści), więc odcinamy rodzaj
  // `message` zarówno z listy, jak i z badge'a.
  const listQ = useNotificationsInfinite({ excludeKinds: CHAT_KINDS });
  const countQ = useUnreadCountExcluding(CHAT_KINDS);

  const prefsQ = useNotificationPreferences();
  const markAll = useMarkAllNotificationsRead();
  const markMany = useMarkNotificationsRead();
  const unreadOne = useMarkNotificationUnread();

  const items: NotificationRow[] = listQ.data?.pages[0] ?? [];
  // Profile aktorów przez WSPÓLNY hook (`useActorProfiles`) - dzwonek i skrzynka
  // budują ten sam klucz cache `["notifications","actor-profiles",<ids>]`, więc
  // otwarcie obu powierzchni to jedno zapytanie, nie dwa. Wcześniej dzwonek miał
  // własną, znakowo identyczną kopię tego zapytania.
  const actorProfiles = useNotificationActorProfiles(items, !!user);

  if (!user) return null;

  // Dzwonek pokazuje tylko pierwszą stronę - "Zobacz wszystkie" kieruje do
  // /messages?view=notifications, gdzie Center dokleja kolejne strony.
  const unread = countQ.data ?? 0;
  const groupByConversation = prefsQ.data?.group_by_conversation ?? true;
  const groups = groupNotifications(items, { groupByConversation });

  const panelStyle: CSSProperties = {
    width: panelWidth,
    maxWidth: "calc(100vw - 24px)",
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={[
            "relative isolate inline-flex items-center justify-center p-0 m-0 shrink-0 overflow-visible",
            "bg-transparent border-0 text-foreground",
            "transition-colors duration-200",
            "hover:text-brand",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:opacity-50 disabled:pointer-events-none",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={t("notifications.title")}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden />

          <UnreadBadge
            count={unread}
            variant="alert"
            size="sm"
            fontSizePx={9}
            className="absolute -right-2.5 -top-2 z-[100]"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        sticky="always"
        hideWhenDetached={false}
        avoidCollisions
        className={[
          "p-0 overflow-hidden shadow-xl border-border/60 backdrop-blur-md bg-popover text-popover-foreground",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "duration-220 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
          "will-change-[transform,opacity]",
          "origin-(--radix-popover-content-transform-origin)",
        ].join(" ")}
        style={panelStyle}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide">
              {t("notifications.title")}
            </span>
            {unread > 0 && (
              <UnreadBadge
                count={unread}
                size="lg"
                className="static"
                labelKey="notifications.unread"
              />
            )}
          </div>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {t("notifications.markAllRead")}
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {listQ.isLoading ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              {t("common.loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-xs text-muted-foreground text-center">
              <BellOff className="mx-auto mb-2 h-5 w-5 opacity-50" aria-hidden />
              {t("notifications.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {groups.map((g) => {
                const n = g.latest;
                const KindIcon = KIND_ICON_BY_NAME[n.kind] ?? Circle;
                const actorId = notificationActorId(n.href);
                const actor = actorId ? actorProfiles.get(actorId) : undefined;
                const groupUnread = g.unreadCount;
                const isUnread = groupUnread > 0;
                const extra = g.items.length - 1;
                const title =
                  g.isConversation && !g.isSingle
                    ? t("notifications.grouped.messagesFrom", {
                        name: pickTitle(n, lang),
                      })
                    : pickTitle(n, lang);
                const inner = (
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    <Avatar className="mt-0.5 h-8 w-8 rounded-[5px] border border-border/60 bg-muted">
                      {actor?.avatar_url ? (
                        <AvatarImage
                          src={actor.avatar_url}
                          alt={actor.display_name ?? title}
                          className="rounded-[5px] object-cover"
                        />
                      ) : null}
                      <AvatarFallback
                        className={[
                          "rounded-[5px]",
                          isUnread
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                        ].join(" ")}
                        aria-hidden
                      >
                        {n.icon ? (
                          <DynamicIcon name={n.icon} className="h-3.5 w-3.5" size={14} />
                        ) : (
                          <KindIcon className="h-3.5 w-3.5" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={[
                            "text-xs truncate",
                            isUnread ? "font-semibold" : "font-medium text-muted-foreground",
                          ].join(" ")}
                        >
                          {title}
                        </span>
                        {groupUnread > 0 && (
                          <UnreadBadge
                            count={groupUnread}
                            size="sm"
                            className="rounded-[5px] text-[5px]"
                            labelKey="notifications.unread"
                          />
                        )}
                      </div>
                      {pickBody(n, lang) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                          {pickBody(n, lang)}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                        <span>{relTime(n.created_at, lang)}</span>
                        {extra > 0 && (
                          <span aria-hidden>
                            {t("notifications.grouped.moreMessages", {
                              count: extra,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className="ml-1 flex shrink-0 items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const ids = g.items.filter((it) => !it.read_at).map((it) => it.id);
                            if (ids.length > 0) markMany.mutate(ids);
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t("notifications.markRead")}
                          title={t("notifications.markRead")}
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            unreadOne.mutate(g.latest.id);
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t("notifications.markUnread")}
                          title={t("notifications.markUnread")}
                        >
                          <Mail className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                );
                const onClick = () => {
                  // Clicking the row navigates and marks all wrapped rows read.
                  const ids = g.items.filter((it) => !it.read_at).map((it) => it.id);
                  if (ids.length > 0) markMany.mutate(ids);
                  setOpen(false);
                };
                const href = n.href;
                return (
                  <li key={g.key}>
                    {href && isInternalHref(href) ? (
                      // Wewnętrzna nawigacja SPA - router.navigate({ href })
                      // zachowuje query string (np. "/messages?c=<uuid>"),
                      // bez pełnego reloadu; <a href> zostaje dla semantyki.
                      <a
                        href={href}
                        onClick={(e) => {
                          onClick();
                          if (!isPlainLeftClick(e)) return;
                          e.preventDefault();
                          void router.navigate({ href });
                        }}
                        className="block hover:bg-muted/50 transition-colors"
                      >
                        {inner}
                      </a>
                    ) : href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onClick}
                        className="block hover:bg-muted/50 transition-colors"
                      >
                        {inner}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={onClick}
                        className="block w-full text-left hover:bg-muted/50 transition-colors"
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border/60 p-2">
          <Link
            to="/messages"
            search={{ view: "notifications" }}
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium hover:bg-muted/60 transition-colors"
          >
            <Inbox className="h-3.5 w-3.5" aria-hidden />
            {t("notifications.openInbox")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
