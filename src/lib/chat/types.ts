// Chat domain types - thin aliases over the generated Supabase types so the
// feature code never re-declares DB shapes by hand.
import type { Database } from "@/integrations/supabase/types";

export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
export type ParticipantRow = Database["public"]["Tables"]["conversation_participants"]["Row"];
// search_vector to serwerowa kolumna FTS (trigger) - klient nigdy jej nie
// konstruuje (optymistyczne wiersze, demo bot), więc w domenowym typie jest
// opcjonalna; select("*") i tak ją zwraca jako nadmiarowe pole.
export type MessageRow = Omit<Database["public"]["Tables"]["messages"]["Row"], "search_vector"> & {
  search_vector?: unknown;
};
export type ReactionRow = Database["public"]["Tables"]["message_reactions"]["Row"];

export type PeerProfile = Database["public"]["Functions"]["get_chat_peers"]["Returns"][number];

/**
 * Wiersz KATALOGU OSÓB (`search_people`). Od 20260807144000 projekcja niesie
 * także warstwę intencji (`open_to`, `seeking_*`), kompletność profilu
 * i `match_score` (blend trigram + semantyka), więc karta katalogu ma czym
 * uzasadnić trafienie - nie tylko kto to jest, ale dlaczego się pokazał.
 */
export type PersonHit = Database["public"]["Functions"]["search_people"]["Returns"][number];

/**
 * Wiersz WYSZUKIWARKI ODBIORCÓW CZATU (`search_chat_contacts`). Węższy zbiór
 * kolumn niż katalog i węższy zbiór osób (tylko zaakceptowana sieć), dlatego
 * osobny typ: pickery czatu nie mają po co znać intencji ani kompletności,
 * a wspólny alias zmuszałby je do udawania, że je dostają.
 */
export type ChatContactHit =
  Database["public"]["Functions"]["search_chat_contacts"]["Returns"][number];

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
