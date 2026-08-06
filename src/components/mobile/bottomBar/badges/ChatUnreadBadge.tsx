// Atom: licznik nieprzeczytanych wiadomości dla pozycji "Czaty".
//
// Osobny moduł, bo jest ładowany LENIWIE (patrz LiveTabBadge): dzięki temu
// warstwa czatu nie wchodzi do chunka wejściowego SiteChrome, którym płaci
// każda strona i każdy gość.
import { useChatUnreadTotal } from "@/lib/chat/useConversations";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";

export function ChatUnreadBadge({ className }: { className?: string }) {
  const total = useChatUnreadTotal();
  return (
    <UnreadBadge
      count={total}
      size="sm"
      variant="alert"
      labelKey="mobileBottomBar.unreadChat"
      className={className}
    />
  );
}

export default ChatUnreadBadge;
