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

/** Strict (created_at, id) order - true when `a` is chronologically older. */
function isOlder(a: ChatMessage, b: ChatMessage): boolean {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at;
  return a.id < b.id;
}

/**
 * Upsert a message into the cached pages (newest first).
 *  - Replaces the row with the same id (and drops a matching `replaceId`
 *    optimistic twin so the realtime-echo-before-HTTP-response race can never
 *    leave a duplicate).
 *  - When the id is absent: inserts only if `insertIfMissing` - UPDATE-shaped
 *    events for paginated-out rows must not teleport old messages to the top.
 *    The insert lands at the chronologically correct slot of the newest page
 *    (not blindly on top), so a delayed or out-of-order realtime INSERT can
 *    never display above genuinely newer messages.
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
      if (first) {
        // Newest-first rows: insert before the first strictly-older row.
        const rows = [...first.rows];
        let at = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row && isOlder(row, message)) {
            at = i;
            break;
          }
        }
        rows.splice(at, 0, message);
        pages[0] = { ...first, rows };
      }
    }
  }
  return { ...data, pages };
}

/**
 * Rebuild the send payload of a FAILED optimistic row so it can be retried
 * as a fresh send (attachments were uploaded before the original attempt, so
 * the storage path is reusable as-is). Null for rows that cannot be retried.
 */
export interface RetrySendInput {
  conversationId: string;
  kind: "text" | "image" | "file" | "audio";
  body?: string;
  attachment?: { path: string; name: string; mime: string; size: number; duration?: number };
  replyToId?: string | null;
  forwarded?: boolean;
}

export function retrySendInput(message: ChatMessage): RetrySendInput | null {
  if (!message.failed || message.deleted_at) return null;
  const kind = message.kind as RetrySendInput["kind"];
  if (kind === "text") {
    if (!message.body?.trim()) return null;
    return {
      conversationId: message.conversation_id,
      kind,
      body: message.body,
      replyToId: message.reply_to_id,
      forwarded: message.forwarded ?? false,
    };
  }
  if (!message.attachment_path) return null;
  return {
    conversationId: message.conversation_id,
    kind,
    body: message.body ?? undefined,
    attachment: {
      path: message.attachment_path,
      name: message.attachment_name ?? "",
      mime: message.attachment_mime ?? "",
      size: message.attachment_size ?? 0,
      duration: message.attachment_duration ?? undefined,
    },
    replyToId: message.reply_to_id,
    forwarded: message.forwarded ?? false,
  };
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
