// Chat domain types - thin aliases over the generated Supabase types so the
// feature code never re-declares DB shapes by hand.
import type { Database } from "@/integrations/supabase/types";

export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
export type ParticipantRow = Database["public"]["Tables"]["conversation_participants"]["Row"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
export type ReactionRow = Database["public"]["Tables"]["message_reactions"]["Row"];

export type PeerProfile = Database["public"]["Functions"]["get_chat_peers"]["Returns"][number];
// `verified` dołożone ręcznie do czasu regeneracji typów (migracja
// 20260713160000 dodaje kolumnę wyniku search_people).
export type PersonHit = Database["public"]["Functions"]["search_people"]["Returns"][number] & {
  verified?: boolean;
};

export type MessageKind = "text" | "image" | "file";

/** Conversation as consumed by the UI: my membership row + the peers' rows. */
export interface ConversationView {
  conversation: ConversationRow;
  /** The caller's own participant row (unread counter, own last_read_at). */
  me: ParticipantRow;
  /** Every other member (for direct conversations exactly one). */
  peers: ParticipantRow[];
}

/** Optimistic (not yet acknowledged) outgoing message marker. */
export interface PendingMeta {
  pending?: boolean;
  failed?: boolean;
}

export type ChatMessage = MessageRow & PendingMeta;

/** Reactions grouped for one message: emoji -> user ids. */
export type MessageReactions = ReadonlyMap<string, ReadonlyArray<ReactionRow>>;
