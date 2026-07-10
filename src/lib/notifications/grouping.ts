// Grouping helpers for the notification center. Message-kind notifications
// coming from the chat trigger share href="/messages?c=<conversation_id>".
// We collapse them into a single group per conversation, keeping the newest
// entry on top with an unread-count badge and the latest preview.
import type { NotificationRow } from "./useNotifications";

export interface NotificationGroup {
  /** Stable key: conversation id for message groups, notification id otherwise. */
  key: string;
  /** Representative row (newest in the group). */
  latest: NotificationRow;
  /** All rows the group represents, newest first. */
  items: NotificationRow[];
  /** How many rows in the group are unread. */
  unreadCount: number;
  /** True when the group represents a single row (no collapse). */
  isSingle: boolean;
  /** True for kind='message' collapsed groups. */
  isConversation: boolean;
  /** Conversation id when derivable from href. */
  conversationId: string | null;
}

const CONVERSATION_HREF = /^\/messages\?c=([0-9a-f-]{36})$/i;

function conversationIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = CONVERSATION_HREF.exec(href);
  return match ? (match[1] ?? null) : null;
}

/**
 * Group message notifications by conversation. Other kinds pass through as
 * single-item groups so the UI can render one uniform list.
 */
export function groupNotifications(
  items: NotificationRow[],
  options: { groupByConversation: boolean },
): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const indexByConv = new Map<string, number>();

  for (const row of items) {
    const convId = conversationIdFromHref(row.href);
    const canGroup = options.groupByConversation && row.kind === "message" && convId;

    if (canGroup) {
      const existing = indexByConv.get(convId);
      if (existing !== undefined) {
        const g = groups[existing];
        if (!g) continue;
        g.items.push(row);
        if (!row.read_at) g.unreadCount += 1;
        g.isSingle = false;
        continue;
      }
      indexByConv.set(convId, groups.length);
      groups.push({
        key: `conv:${convId}`,
        latest: row,
        items: [row],
        unreadCount: row.read_at ? 0 : 1,
        isSingle: true,
        isConversation: true,
        conversationId: convId,
      });
      continue;
    }

    groups.push({
      key: `n:${row.id}`,
      latest: row,
      items: [row],
      unreadCount: row.read_at ? 0 : 1,
      isSingle: true,
      isConversation: false,
      conversationId: convId,
    });
  }

  return groups;
}
