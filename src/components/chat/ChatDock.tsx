// Organism: floating chat dock (Messenger-style). Hosts open conversation
// windows bottom-right, a minimized-chips rail, and the global realtime
// subscriptions. Mounted once in SiteChrome; renders nothing for guests,
// on /messages (the full inbox owns the surface) and during SSR/hydration.
import "@/lib/i18n-chat";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useHasMounted } from "@/hooks/useHasMounted";
import { onOpenChatWindow } from "@/lib/chat/chatDockBus";
import { useOnlineUsers } from "@/lib/chat/presence";
import {
  useChatListRealtime,
  useConversations,
  usePeerProfiles,
} from "@/lib/chat/useConversations";
import { ChatAvatar } from "./ChatAvatar";

// Lazy: the full message UI (list, bubbles, composer, attachments) loads only
// when a window is actually opened - the dock itself needs just the badge/
// chips layer on page load.
const ChatWindow = lazy(() => import("./ChatWindow").then((m) => ({ default: m.ChatWindow })));

function maxOpenWindows(): number {
  if (typeof window === "undefined") return 1;
  if (window.innerWidth >= 1280) return 3;
  if (window.innerWidth >= 900) return 2;
  return 1;
}

export function ChatDock() {
  const mounted = useHasMounted();
  const { user } = useAuth();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [minimizedIds, setMinimizedIds] = useState<string[]>([]);

  useChatListRealtime();
  const online = useOnlineUsers();
  const conversationsQ = useConversations();
  const views = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);

  const minimizedViews = useMemo(
    () => minimizedIds.map((id) => views.find((v) => v.conversation.id === id)).filter(Boolean),
    [minimizedIds, views],
  );
  const minimizedPeerIds = useMemo(
    () => [...new Set(minimizedViews.flatMap((v) => (v ? v.peers.map((p) => p.user_id) : [])))],
    [minimizedViews],
  );
  const peersQ = usePeerProfiles(minimizedPeerIds);

  useEffect(
    () =>
      onOpenChatWindow(({ conversationId }) => {
        setMinimizedIds((ids) => ids.filter((id) => id !== conversationId));
        setOpenIds((ids) => {
          if (ids.includes(conversationId)) return ids;
          const next = [...ids, conversationId];
          const overflow = next.length - maxOpenWindows();
          if (overflow > 0) {
            const evicted = next.splice(0, overflow);
            setMinimizedIds((minimized) => [
              ...evicted.filter((id) => !minimized.includes(id)),
              ...minimized,
            ]);
          }
          return next;
        });
      }),
    [],
  );

  const isMessagesRoute = pathname === "/messages" || pathname.startsWith("/messages/");
  if (!mounted || !user || isMessagesRoute) return null;

  const close = (id: string) => setOpenIds((ids) => ids.filter((x) => x !== id));
  const minimize = (id: string) => {
    close(id);
    setMinimizedIds((ids) => (ids.includes(id) ? ids : [id, ...ids]));
  };
  const restore = (id: string) => {
    setMinimizedIds((ids) => ids.filter((x) => x !== id));
    setOpenIds((ids) => {
      if (ids.includes(id)) return ids;
      const next = [...ids, id];
      while (next.length > maxOpenWindows()) {
        const evicted = next.shift();
        if (evicted) setMinimizedIds((m) => (m.includes(evicted) ? m : [evicted, ...m]));
      }
      return next;
    });
  };

  return (
    <div
      className="pointer-events-none fixed bottom-0 right-0 z-50 flex items-end gap-3 px-2 sm:right-4 sm:px-0"
      aria-live="off"
    >
      {/* Minimized chips rail */}
      {minimizedViews.length > 0 && (
        <div className="pointer-events-auto mb-3 flex flex-col-reverse gap-2">
          {minimizedViews.map((view) => {
            if (!view) return null;
            const id = view.conversation.id;
            const peerId = view.peers[0]?.user_id ?? "";
            const profile = peersQ.data?.get(peerId);
            const unread = view.me.unread_count;
            return (
              <div key={id} className="group/chip relative">
                <button
                  type="button"
                  onClick={() => restore(id)}
                  className="block rounded-[6px] shadow-lg ring-1 ring-border/60 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${t("chat.open")}: ${profile?.display_name ?? ""}`}
                  title={profile?.display_name ?? t("chat.open")}
                >
                  <ChatAvatar
                    name={profile?.display_name ?? "?"}
                    avatarUrl={profile?.avatar_url}
                    online={online.has(peerId)}
                    size="lg"
                  />
                  {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[6px] bg-[var(--brand)] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setMinimizedIds((ids) => ids.filter((x) => x !== id))}
                  className="absolute -top-1 -left-1 hidden h-5 w-5 items-center justify-center rounded-full bg-background text-muted-foreground shadow ring-1 ring-border/60 transition-colors hover:text-foreground group-hover/chip:flex"
                  aria-label={t("chat.close")}
                  title={t("chat.close")}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Open windows */}
      <Suspense fallback={null}>
        {openIds.map((id) => (
          <ChatWindow
            key={id}
            conversationId={id}
            variant="dock"
            onClose={() => close(id)}
            onMinimize={() => minimize(id)}
            className="w-full sm:w-[320px]"
          />
        ))}
      </Suspense>
    </div>
  );
}
