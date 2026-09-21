// Molekuła: szyna zminimalizowanych rozmów po lewej stronie paska.
//
// Maksymalnie dwie pigułki, reszta chowa się pod „+N" (kliknięcie otwiera
// skrzynkę czatu).
//
// ── DLACZEGO TO OSOBNY PLIK I DLACZEGO DWA KOMPONENTY ────────────────────
// Poprzednia wersja siedziała w `WorkspaceDock.tsx` i subskrybowała DWA
// zapytania (`useConversations`, `usePeerProfiles`) BEZWARUNKOWO - a potem
// zwracała `null`, gdy szyna była pusta. Czyli w najczęstszym stanie (nikt
// nic nie zminimalizował) pasek płacił za dwa zapytania i przeliczanie mapy
// awatarów, żeby nie wyrenderować nic.
//
// Rozdzielenie na `MinimizedChats` (czyta samą szynę - synchroniczny magazyn,
// bez sieci) i `MinimizedChatsRail` (dociąga awatary) przesuwa ten koszt za
// bramkę: dopóki szyna jest pusta, warstwa danych nie jest w ogóle
// zamontowana, więc nie ma czego subskrybować. Bramka jest w RENDERZE
// rodzica, nie w ciele dziecka - haki nie dają się pominąć warunkiem,
// a komponent owszem.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { conversationDisplay } from "@/lib/chat/display";
import { useConversations, usePeerProfiles } from "@/lib/chat/useConversations";
import {
  MINIMIZED_VISIBLE_LIMIT,
  minimizedChatsStore,
  useMinimizedChats,
  type MinimizedChat,
} from "@/lib/chat/minimizedChats";
import { prefetchChatWindow } from "@/components/chat/chatWindowChunk";
import "@/lib/i18n-dock";

interface RailProps {
  chats: readonly MinimizedChat[];
  onOpenInbox: () => void;
}

/**
 * Warstwa danych szyny: zdjęcie rozmówcy bierzemy NA ŻYWO z listy rozmów
 * (dane zwykle są już w cache React Query), a zapisany URL służy tylko jako
 * zapas przy starcie sesji.
 */
function MinimizedChatsRail({ chats, onOpenInbox }: RailProps) {
  const { t } = useTranslation();
  const conversationsQ = useConversations();
  const views = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);
  const peerIds = useMemo(
    () => [...new Set(views.flatMap((view) => view.peers.map((peer) => peer.user_id)))],
    [views],
  );
  const peersQ = usePeerProfiles(peerIds);
  const liveAvatars = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const view of views) {
      map.set(view.conversation.id, conversationDisplay(view, peersQ.data).avatarUrl);
    }
    return map;
  }, [views, peersQ.data]);

  const visible = chats.slice(0, MINIMIZED_VISIBLE_LIMIT);
  const overflow = chats.length - visible.length;

  const restore = (id: string) => {
    minimizedChatsStore.restore(id);
    onOpenInbox();
  };

  return (
    <div className="pointer-events-auto absolute bottom-0 left-1.5 top-0 flex items-center gap-1.5">
      {visible.map((chat) => (
        <span
          key={chat.id}
          className="wd-pill flex h-6 max-w-[132px] items-center gap-1 rounded-md border border-border bg-muted/60 py-0 pl-0.5 pr-0.5 text-[11px] font-medium leading-none"
        >
          <button
            type="button"
            onClick={() => restore(chat.id)}
            // Przywrócenie rozmowy renderuje OKNO wiadomości, którego paczka
            // jest leniwa - rozgrzewamy ją na zamiar, nie po kliknięciu.
            onPointerEnter={prefetchChatWindow}
            onPointerDown={prefetchChatWindow}
            onFocus={prefetchChatWindow}
            title={t("dock.chat.restore", { name: chat.name })}
            aria-label={t("dock.chat.restore", { name: chat.name })}
            className="flex h-5 min-w-0 items-center gap-1"
          >
            <ChatAvatar
              name={chat.name}
              avatarUrl={liveAvatars.get(chat.id) ?? chat.avatarUrl}
              size="xs"
              className="shrink-0"
            />
            <span className="truncate leading-none">{chat.name}</span>
          </button>
          <button
            type="button"
            onClick={() => minimizedChatsStore.remove(chat.id)}
            title={t("dock.chat.closeConversation")}
            aria-label={t("dock.chat.closeConversation")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={onOpenInbox}
          title={t("dock.chat.minimizedMore", { count: overflow })}
          aria-label={t("dock.chat.minimizedMore", { count: overflow })}
          className="wd-pill flex h-6 items-center rounded-md border border-border bg-muted/60 px-2 text-[11px] font-semibold leading-none text-muted-foreground hover:text-foreground"
        >
          +{overflow}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Bramka szyny. `useMinimizedChats` czyta magazyn synchroniczny
 * (`useSyncExternalStore`), więc jest darmowy - dopiero za tą bramką montuje
 * się warstwa sieciowa.
 */
export function MinimizedChats({ onOpenInbox }: { onOpenInbox: () => void }) {
  const { minimized } = useMinimizedChats();
  if (minimized.length === 0) return null;
  return <MinimizedChatsRail chats={minimized} onOpenInbox={onOpenInbox} />;
}
