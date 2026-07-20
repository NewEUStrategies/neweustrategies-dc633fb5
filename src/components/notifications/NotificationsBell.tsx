// Header notification bell - molecule.
// - Popover with recent notifications, unread badge, mark-all-read, inbox link
// - Realtime updates (channel scoped per user_id)
// - Multi-tenant safe: reads go through RLS (auth.uid() + current_tenant_id)
// - i18n PL/EN, respects prefers-reduced-motion, uses semantic tokens only
import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRouter } from "@tanstack/react-router";
// Nazwane importy + DynamicIcon zamiast `import * as lucide-react`: dzwonek
// renderuje się w chrome każdej strony, a namespace-import z dynamicznym
// lookupem wciągał CAŁĄ bibliotekę ikon (~640 KB raw) do bundla wejściowego.
import {
  Bell,
  BellOff,
  Check,
  Circle,
  Crown,
  Inbox,
  Info,
  Mail,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";
import { useAuth } from "@/hooks/useAuth";
import {
  useNotifications,
  useNotificationsRealtime,
  useNotificationPreferences,
  useNotificationPreferencesRealtime,
  useUnreadCount,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  useMarkNotificationUnread,
  type NotificationRow,
} from "@/lib/notifications/useNotifications";
import { groupNotifications } from "@/lib/notifications/grouping";
import { formatDateShort } from "@/lib/i18n/format";

type Lang = "pl" | "en";

function pickTitle(row: NotificationRow, lang: Lang): string {
  if (lang === "en" && row.title_en) return row.title_en;
  return row.title_pl;
}
function pickBody(row: NotificationRow, lang: Lang): string | null {
  if (lang === "en") return row.body_en ?? row.body_pl ?? null;
  return row.body_pl ?? row.body_en ?? null;
}

function relTime(iso: string, lang: Lang): string {
  const rtf = new Intl.RelativeTimeFormat(lang === "en" ? "en-US" : "pl-PL", {
    numeric: "auto",
  });
  const then = new Date(iso).getTime();
  const diff = (then - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diff / 86400), "day");
  return formatDateShort(iso, lang);
}

// Ikona zapasowa per rodzaj (spójna z /profile/notifications), gdy producent
// nie zapisał własnej. Ikony po nazwie z DB (kebab-case) renderuje DynamicIcon
// (kurowany zestaw synchronicznie, resztę dociąga leniwie).
const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  system: Info,
  follow: UserPlus,
  content: Sparkles,
  subscription: Crown,
  comment: MessageCircle,
  security: ShieldAlert,
  connection: UserCheck,
};

// Internal hrefs render a real <a href> for semantics, but plain left-clicks
// are hijacked and routed through router.navigate({ href }). Unlike
// <Link to={href}> - which treats `to` as a pathname verbatim and never splits
// out `?search`, 404-ing "/messages?c=<uuid>" - navigate({ href }) parses the
// query string correctly, so search params survive SPA navigation. External
// hrefs stay plain anchors with a full navigation (same rule as the center).
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

export interface NotificationsBellProps {
  panelWidth?: number;
}

export function NotificationsBell({ panelWidth = 340 }: NotificationsBellProps) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Always call hooks in the same order - even when unauth we render nothing.
  useNotificationsRealtime();
  useNotificationPreferencesRealtime();
  const listQ = useNotifications({ limit: 20 });
  const countQ = useUnreadCount();
  const prefsQ = useNotificationPreferences();
  const markAll = useMarkAllNotificationsRead();
  const markMany = useMarkNotificationsRead();
  const unreadOne = useMarkNotificationUnread();

  if (!user) return null;

  const items = listQ.data ?? [];
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
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("notifications.title", { defaultValue: "Powiadomienia" })}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <Bell className="h-4 w-4" aria-hidden />
          <UnreadBadge count={unread} className="absolute -top-0.5 -right-0.5" />
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
              {t("notifications.title", { defaultValue: "Powiadomienia" })}
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
            {t("notifications.markAllRead", { defaultValue: "Oznacz wszystkie" })}
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {listQ.isLoading ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              {t("common.loading", { defaultValue: "Ładowanie..." })}
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-xs text-muted-foreground text-center">
              <BellOff className="mx-auto mb-2 h-5 w-5 opacity-50" aria-hidden />
              {t("notifications.empty", { defaultValue: "Brak powiadomień" })}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {groups.map((g) => {
                const n = g.latest;
                const KindIcon = KIND_ICONS[n.kind] ?? Circle;
                const groupUnread = g.unreadCount;
                const isUnread = groupUnread > 0;
                const extra = g.items.length - 1;
                const title =
                  g.isConversation && !g.isSingle
                    ? t("notifications.grouped.messagesFrom", {
                        name: pickTitle(n, lang),
                        defaultValue: `Messages from ${pickTitle(n, lang)}`,
                      })
                    : pickTitle(n, lang);
                const inner = (
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    <div
                      className={[
                        "mt-0.5 shrink-0 rounded-full p-1.5",
                        isUnread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      ].join(" ")}
                      aria-hidden
                    >
                      {n.icon ? (
                        <DynamicIcon name={n.icon} className="h-3.5 w-3.5" size={14} />
                      ) : (
                        <KindIcon className="h-3.5 w-3.5" />
                      )}
                    </div>
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
                              defaultValue: `+${extra} more`,
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
                          aria-label={t("notifications.markRead", {
                            defaultValue: "Oznacz jako przeczytane",
                          })}
                          title={t("notifications.markRead", {
                            defaultValue: "Oznacz jako przeczytane",
                          })}
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
                          aria-label={t("notifications.markUnread", {
                            defaultValue: "Oznacz jako nieprzeczytane",
                          })}
                          title={t("notifications.markUnread", {
                            defaultValue: "Oznacz jako nieprzeczytane",
                          })}
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
            {t("notifications.openInbox", { defaultValue: "Otwórz skrzynkę" })}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
