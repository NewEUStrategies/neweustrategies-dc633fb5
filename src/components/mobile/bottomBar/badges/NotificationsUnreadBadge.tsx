// Atom: licznik nieprzeczytanych powiadomień (opcjonalne źródło badge'a).
import { useUnreadCount } from "@/lib/notifications/useNotifications";
import { UnreadBadge } from "@/components/atoms/UnreadBadge";

export function NotificationsUnreadBadge({ className }: { className?: string }) {
  const { data } = useUnreadCount();
  return (
    <UnreadBadge
      count={data ?? 0}
      size="sm"
      variant="alert"
      labelKey="mobileBottomBar.unreadNotifications"
      className={className}
    />
  );
}

export default NotificationsUnreadBadge;
