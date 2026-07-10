// Header notification bell - molecule.
// - Popover with recent notifications, unread badge, mark-all-read, inbox link
// - Realtime updates (channel scoped per user_id)
// - Multi-tenant safe: reads go through RLS (auth.uid() + current_tenant_id)
// - i18n PL/EN, respects prefers-reduced-motion, uses semantic tokens only
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import * as LucideIcons from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import {
  useNotifications,
  useNotificationsRealtime,
  useNotificationPreferences,
  useUnreadCount,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  type NotificationRow,
} from "@/lib/notifications/useNotifications";
import { groupNotifications, type NotificationGroup } from "@/lib/notifications/grouping";

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
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : "pl-PL");
}

function resolveIcon(name: string | null | undefined) {
  if (!name) return null;
  const IconRegistry = LucideIcons as unknown as Record<
    string,
    React.ComponentType<{ className?: string }>
  >;
  const Ico = IconRegistry[name];
  return Ico ?? null;
}

export interface NotificationsBellProps {
  panelWidth?: number;
}

export function NotificationsBell({ panelWidth = 340 }: NotificationsBellProps) {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === "en" ? "en" : "pl";
  const [open, setOpen] = useState(false);

  // Always call hooks in the same order - even when unauth we render nothing.
  useNotificationsRealtime();
  const listQ = useNotifications({ limit: 20 });
  const countQ = useUnreadCount();
  const prefsQ = useNotificationPreferences();
  const markAll = useMarkAllNotificationsRead();
  const markOne = useMarkNotificationRead();
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
          <LucideIcons.Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold leading-none inline-flex items-center justify-center shadow-sm ring-2 ring-background motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200"
              aria-label={t("notifications.unread", {
                count: unread,
                defaultValue: `${unread} nieprzeczytanych`,
              })}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
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
          <div className="text-xs font-semibold uppercase tracking-wide">
            {t("notifications.title", { defaultValue: "Powiadomienia" })}
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
              <LucideIcons.BellOff className="mx-auto mb-2 h-5 w-5 opacity-50" aria-hidden />
              {t("notifications.empty", { defaultValue: "Brak powiadomień" })}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((n) => {
                const IconCmp = resolveIcon(n.icon) ?? LucideIcons.Circle;
                const isUnread = !n.read_at;
                const inner = (
                  <div className="flex items-start gap-2.5 px-3 py-2.5">
                    <div
                      className={[
                        "mt-0.5 shrink-0 rounded-full p-1.5",
                        isUnread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      ].join(" ")}
                      aria-hidden
                    >
                      <IconCmp className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={[
                            "text-xs truncate",
                            isUnread ? "font-semibold" : "font-medium text-muted-foreground",
                          ].join(" ")}
                        >
                          {pickTitle(n, lang)}
                        </span>
                        {isUnread && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                            aria-hidden
                          />
                        )}
                      </div>
                      {pickBody(n, lang) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                          {pickBody(n, lang)}
                        </p>
                      )}
                      <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                        {relTime(n.created_at, lang)}
                      </div>
                    </div>
                  </div>
                );
                const onClick = () => {
                  if (isUnread) markOne.mutate(n.id);
                  setOpen(false);
                };
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <a
                        href={n.href}
                        onClick={onClick}
                        className="block hover:bg-muted/50 transition-colors"
                      >
                        {inner}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={onClick}
                        className="w-full text-left hover:bg-muted/50 transition-colors"
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
            to="/profile/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium hover:bg-muted/60 transition-colors"
          >
            <LucideIcons.Inbox className="h-3.5 w-3.5" aria-hidden />
            {t("notifications.openInbox", { defaultValue: "Otwórz skrzynkę" })}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
