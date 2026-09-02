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
  // Grupa `([0-9a-f-]{36})` nie jest opcjonalna, więc dopasowanie ZAWSZE ma
  // `match[1]` - dawne `?? null` było gałęzią nieosiągalną (i dziurą w pokryciu).
  const match = CONVERSATION_HREF.exec(href);
  return match === null ? null : match[1]!;
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
  // Mapa trzyma SAM OBIEKT grupy, nie jego indeks: indeks wymagał odczytu
  // `groups[i]` i strażnika `if (!g)`, którego żadne wejście nie mogło wywołać.
  const groupByConv = new Map<string, NotificationGroup>();

  for (const row of items) {
    const convId = conversationIdFromHref(row.href);
    const canGroup = options.groupByConversation && row.kind === "message" && convId;

    if (canGroup) {
      const existing = groupByConv.get(convId);
      if (existing !== undefined) {
        existing.items.push(row);
        if (!row.read_at) existing.unreadCount += 1;
        existing.isSingle = false;
        continue;
      }
      const group: NotificationGroup = {
        key: `conv:${convId}`,
        latest: row,
        items: [row],
        unreadCount: row.read_at ? 0 : 1,
        isSingle: true,
        isConversation: true,
        conversationId: convId,
      };
      groupByConv.set(convId, group);
      groups.push(group);
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
