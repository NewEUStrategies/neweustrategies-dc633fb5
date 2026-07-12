// Pure read/delivery receipt math (WhatsApp tick semantics), extracted so it
// is unit-testable and shared by the bubble and the conversation list row.
//
//   pending   - optimistic row, not on the server yet (clock icon)
//   sent      - persisted server-side (single grey tick)
//   delivered - the peer's client acknowledged newer-or-equal activity via
//               mark_conversations_delivered() (double grey tick)
//   read      - the peer's last_read_at covers this message (double brand tick)
//
// Privacy: peer read/delivery state arrives via the peer's participant row,
// which RLS hides entirely when EITHER side disabled read receipts - the
// inputs are then null and everything caps at "sent", matching the DB truth.
import type { ChatMessage } from "./types";

export type ReceiptState = "pending" | "sent" | "delivered" | "read";

function covers(peerIso: string | null | undefined, createdAtIso: string): boolean {
  return !!peerIso && new Date(peerIso).getTime() >= new Date(createdAtIso).getTime();
}

export function computeReceipt(
  message: Pick<ChatMessage, "created_at" | "pending" | "failed">,
  peerLastReadAt: string | null | undefined,
  peerLastDeliveredAt: string | null | undefined,
): ReceiptState {
  if (message.pending || message.failed) return "pending";
  if (covers(peerLastReadAt, message.created_at)) return "read";
  if (covers(peerLastDeliveredAt, message.created_at)) return "delivered";
  return "sent";
}

/** Client-side mirror of the RLS expiry filter (live vanish between refetches). */
export function isExpired(
  message: Pick<ChatMessage, "expires_at">,
  nowMs: number = Date.now(),
): boolean {
  return !!message.expires_at && new Date(message.expires_at).getTime() <= nowMs;
}

/** Whitelisted disappearing-message windows (mirrors the DB CHECK). */
export const MESSAGE_TTL_OPTIONS = [86400, 604800, 7776000] as const;
export type MessageTtlSeconds = (typeof MESSAGE_TTL_OPTIONS)[number];

export function isValidMessageTtl(value: number | null): value is MessageTtlSeconds | null {
  return value === null || MESSAGE_TTL_OPTIONS.includes(value as MessageTtlSeconds);
}
