// Pure, side-effect-free cache logic for the messages feature, extracted from
// useMessages.ts so it can be unit-tested without importing the Supabase client
// (which throws at module load when env is absent). useMessages re-exports the
// public symbols, so no external import path changes.
import type { InfiniteData } from "@tanstack/react-query";
import type { ChatMessage } from "./types";

/**
 * Compound pagination cursor. A plain `created_at < cursor` skips rows that
 * share the boundary timestamp (bulk inserts, coarse clocks), so the id acts
 * as the tiebreaker under the same (created_at desc, id desc) ordering.
 */
export interface MessagesCursor {
  createdAt: string;
  id: string;
}

export interface MessagesPage {
  /** Newest-first rows of this page. */
  rows: ChatMessage[];
  /** Cursor for the next (older) page; null = end of history. */
  nextCursor: MessagesCursor | null;
}

export type MessagesData = InfiniteData<MessagesPage, MessagesCursor | null>;

export function singlePageData(message: ChatMessage): MessagesData {
  return { pages: [{ rows: [message], nextCursor: null }], pageParams: [null] };
}

/**
 * Upsert a message into the cached pages (newest first).
 *  - Replaces the row with the same id (and drops a matching `replaceId`
 *    optimistic twin so the realtime-echo-before-HTTP-response race can never
 *    leave a duplicate).
 *  - When the id is absent: prepends only if `insertIfMissing` - UPDATE-shaped
 *    events for paginated-out rows must not teleport old messages to the top.
 */
export function upsertMessageInCache(
  data: MessagesData | undefined,
  message: ChatMessage,
  options: { replaceId?: string; insertIfMissing?: boolean } = {},
): MessagesData | undefined {
  if (!data) return data;
  const { replaceId, insertIfMissing = true } = options;
  let idExists = false;
  for (const page of data.pages) {
    if (page.rows.some((m) => m.id === message.id)) {
      idExists = true;
      break;
    }
  }
  let found = false;
  const pages = data.pages.map((page) => {
    const rows: ChatMessage[] = [];
    for (const current of page.rows) {
      if (current.id === message.id) {
        rows.push({ ...current, ...message, pending: false });
        found = true;
      } else if (replaceId && current.id === replaceId) {
        // The server row is (or just became) present elsewhere - drop the
        // optimistic twin instead of rewriting it into a duplicate.
        if (idExists) continue;
        rows.push({ ...current, ...message, pending: false });
        found = true;
      } else {
        rows.push(current);
      }
    }
    return { ...page, rows };
  });
  if (!found) {
    if (!insertIfMissing) return data;
    if (pages.length === 0) pages.push({ rows: [message], nextCursor: null });
    else {
      const first = pages[0];
      if (first) pages[0] = { ...first, rows: [message, ...first.rows] };
    }
  }
  return { ...data, pages };
}

export function removeMessageFromCache(
  data: MessagesData | undefined,
  messageId: string,
): MessagesData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      rows: page.rows.filter((m) => m.id !== messageId),
    })),
  };
}

/** Edit window (mirrors the DB trigger): own text messages, 5 minutes. */
export const EDIT_WINDOW_MS = 5 * 60 * 1000;

export function canEditMessage(message: ChatMessage, myUserId: string): boolean {
  return (
    message.sender_id === myUserId &&
    message.kind === "text" &&
    !message.deleted_at &&
    !message.pending &&
    !message.failed &&
    Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS
  );
}
