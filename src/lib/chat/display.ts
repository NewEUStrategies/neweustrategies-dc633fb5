// Shared conversation display resolution for every chat surface (list rows,
// bell droplist, dock chips, forward targets, window headers, toasts).
// Direct threads show the single peer's profile; group threads ("kręgi") show
// the group title. Centralized here so no surface re-implements the
// `peers[0]` heuristic - which is wrong the moment kind === 'group'.
import type { ConversationView, PeerProfile } from "./types";

export interface ConversationDisplay {
  /** True for group conversations ("kręgi"). */
  isGroup: boolean;
  /** Row/header label: the peer's display name (direct) or the group title. */
  name: string;
  /** Avatar image: the peer's avatar for direct threads, none for groups. */
  avatarUrl: string | null;
  /** Direct threads only: the peer's id (presence dot, block action). */
  peerId: string | null;
  /** Direct threads only: public profile slug for deep-linking to /author/$slug. */
  slug: string | null;
}

export function isGroupView(view: ConversationView): boolean {
  return view.conversation.kind === "group";
}

export function conversationDisplay(
  view: ConversationView,
  profiles: ReadonlyMap<string, PeerProfile> | undefined,
  fallbackGroupName = "…",
  /** This conversation's nickname map (user id -> nickname); nickname wins. */
  nicknames?: ReadonlyMap<string, string>,
): ConversationDisplay {
  if (isGroupView(view)) {
    return {
      isGroup: true,
      name: view.conversation.title?.trim() || fallbackGroupName,
      avatarUrl: null,
      peerId: null,
      slug: null,
    };
  }
  const peerId = view.peers[0]?.user_id ?? null;
  const profile = peerId ? profiles?.get(peerId) : undefined;
  const nickname = peerId ? nicknames?.get(peerId) : undefined;
  return {
    isGroup: false,
    name: nickname ?? profile?.display_name ?? "...",
    avatarUrl: profile?.avatar_url ?? null,
    peerId,
    slug: profile?.slug ?? null,
  };
}

/**
 * Read/delivery state of "the other side" of a conversation, generalized to
 * groups with WhatsApp semantics: an own message counts as read/delivered
 * only when EVERY other member read/received it. A missing timestamp on any
 * member (including RLS-hidden rows - receipts off) yields null, capping the
 * tick at "sent" exactly like 1:1 hidden receipts do. For direct threads the
 * single peer row makes this identical to reading `peers[0]` directly.
 */
export function aggregatePeerReadState(view: ConversationView): {
  lastReadAt: string | null;
  lastDeliveredAt: string | null;
} {
  let lastReadAt: string | null = null;
  let lastDeliveredAt: string | null = null;
  for (let i = 0; i < view.peers.length; i++) {
    const peer = view.peers[i];
    if (!peer) continue;
    if (i === 0) {
      lastReadAt = peer.last_read_at;
      lastDeliveredAt = peer.last_delivered_at;
      continue;
    }
    lastReadAt = minTimestamp(lastReadAt, peer.last_read_at);
    lastDeliveredAt = minTimestamp(lastDeliveredAt, peer.last_delivered_at);
  }
  return { lastReadAt, lastDeliveredAt };
}

/** Earlier of two timestamps; null (unknown/never) dominates. */
function minTimestamp(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}
