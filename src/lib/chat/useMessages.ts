// Messages data layer for a single conversation: infinite history, optimistic
// send, editing, unsend (soft delete), reactions and the per-conversation
// realtime channel (messages + reactions + read receipts + typing broadcast).
//
// Pagination note: each page carries its own `nextCursor`, computed once at
// fetch time. Realtime/optimistic cache patches mutate only `rows`, so they
// can never corrupt hasNextPage (a length-based getNextPageParam would flip to
// "no more pages" the moment a patch changed a page's length).
import { useCallback, useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chatKeys } from "./keys";
import type { ChatMessage, MessageRow, ReactionRow } from "./types";
import {
  singlePageData,
  upsertMessageInCache,
  removeMessageFromCache,
  type MessagesCursor,
  type MessagesPage,
  type MessagesData,
} from "./messageCache";

// Re-exported so existing consumers (ChatWindow, /messages) keep their import
// path; the implementations now live in the pure, unit-tested messageCache.
export type { MessagesCursor, MessagesPage } from "./messageCache";
export { canEditMessage, EDIT_WINDOW_MS } from "./messageCache";

const PAGE_SIZE = 40;

/** Newest-first pages; the UI flattens and reverses for display. */
export function useMessages(
  conversationId: string,
  enabled: boolean,
): UseInfiniteQueryResult<MessagesData> {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: chatKeys.messages(user?.id, conversationId),
    enabled: enabled && !!user,
    staleTime: 30_000,
    initialPageParam: null as MessagesCursor | null,
    queryFn: async ({ pageParam }): Promise<MessagesPage> => {
      let q = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) {
        // Strictly older timestamp OR same timestamp with a smaller id.
        q = q.or(
          `created_at.lt.${pageParam.createdAt},and(created_at.eq.${pageParam.createdAt},id.lt.${pageParam.id})`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = data ?? [];
      const last = rows[rows.length - 1];
      return {
        rows,
        nextCursor:
          rows.length === PAGE_SIZE && last ? { createdAt: last.created_at, id: last.id } : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export interface SendMessageInput {
  conversationId: string;
  kind: "text" | "image" | "file";
  body?: string;
  attachment?: { path: string; name: string; mime: string; size: number };
  replyToId?: string | null;
}

export function useSendMessage() {
  const qc = useQueryClient();
  const { user, tenantId } = useAuth();

  return useMutation({
    mutationFn: async (input: SendMessageInput): Promise<MessageRow> => {
      if (!user) throw new Error("chat: auth required");
      if (!tenantId) throw new Error("chat: tenant not resolved");
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: input.conversationId,
          tenant_id: tenantId,
          sender_id: user.id,
          kind: input.kind,
          body: input.body ?? null,
          attachment_path: input.attachment?.path ?? null,
          attachment_name: input.attachment?.name ?? null,
          attachment_mime: input.attachment?.mime ?? null,
          attachment_size: input.attachment?.size ?? null,
          reply_to_id: input.replyToId ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      if (!user || !tenantId) return { tempId: "", conversationId: input.conversationId };
      const key = chatKeys.messages(user.id, input.conversationId);
      // No cached history yet (first send raced the initial fetch): leave the
      // in-flight fetch alone - cancelling it and seeding a one-message cache
      // would blank the whole thread until the next refetch. onSuccess/realtime
      // will surface the message once the history lands.
      if (!qc.getQueryData<MessagesData>(key)) {
        return { tempId: "", conversationId: input.conversationId };
      }
      await qc.cancelQueries({ queryKey: key });
      const tempId = `pending-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversation_id: input.conversationId,
        tenant_id: tenantId,
        sender_id: user.id,
        kind: input.kind,
        body: input.body ?? null,
        attachment_path: input.attachment?.path ?? null,
        attachment_name: input.attachment?.name ?? null,
        attachment_mime: input.attachment?.mime ?? null,
        attachment_size: input.attachment?.size ?? null,
        reply_to_id: input.replyToId ?? null,
        edited_at: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        pending: true,
      };
      qc.setQueryData<MessagesData>(key, (old) => upsertMessageInCache(old, optimistic));
      return { tempId, conversationId: input.conversationId };
    },
    onSuccess: (row, _input, ctx) => {
      if (!user || !ctx) return;
      const key = chatKeys.messages(user.id, ctx.conversationId);
      const existing = qc.getQueryData<MessagesData>(key);
      if (existing) {
        qc.setQueryData<MessagesData>(key, (old) =>
          upsertMessageInCache(old, row, { replaceId: ctx.tempId || undefined }),
        );
      } else {
        qc.setQueryData<MessagesData>(key, singlePageData(row));
      }
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user.id) });
    },
    onError: (_err, _input, ctx) => {
      if (!user || !ctx?.tempId) return;
      const key = chatKeys.messages(user.id, ctx.conversationId);
      qc.setQueryData<MessagesData>(key, (old) => {
        if (!old) return old;
        const pages = old.pages.map((page) => ({
          ...page,
          rows: page.rows.map((m) =>
            m.id === ctx.tempId ? { ...m, pending: false, failed: true } : m,
          ),
        }));
        return { ...old, pages };
      });
    },
  });
}

/** Edit an own text message (server trigger re-checks the 5-minute window). */
export function useEditMessage(conversationId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { messageId: string; body: string }): Promise<MessageRow> => {
      const { data, error } = await supabase
        .from("messages")
        .update({ body: input.body })
        .eq("id", input.messageId)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      if (!user) return;
      const key = chatKeys.messages(user.id, conversationId);
      qc.setQueryData<MessagesData>(key, (old) =>
        upsertMessageInCache(old, row, { insertIfMissing: false }),
      );
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user.id) });
    },
  });
}

/** Unsend: wipes content, keeps a tombstone ("message deleted") in place. */
export function useDeleteMessage(conversationId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (messageId: string): Promise<MessageRow> => {
      const { data, error } = await supabase
        .from("messages")
        .update({
          deleted_at: new Date().toISOString(),
          body: null,
          attachment_path: null,
          attachment_name: null,
          attachment_mime: null,
          attachment_size: null,
        })
        .eq("id", messageId)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      if (!user) return;
      const key = chatKeys.messages(user.id, conversationId);
      qc.setQueryData<MessagesData>(key, (old) =>
        upsertMessageInCache(old, row, { insertIfMissing: false }),
      );
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user.id) });
    },
  });
}

/** Remove a failed optimistic message from the cache (retry is a fresh send). */
export function useDiscardFailedMessage(conversationId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  // Stable identity - consumed by memoized bubbles via ChatWindow callbacks.
  return useCallback(
    (messageId: string) => {
      if (!uid) return;
      const key = chatKeys.messages(uid, conversationId);
      qc.setQueryData<MessagesData>(key, (old) => removeMessageFromCache(old, messageId));
    },
    [uid, conversationId, qc],
  );
}

/** All reactions of a conversation, grouped by message id. */
export function useReactions(
  conversationId: string,
  enabled: boolean,
): UseQueryResult<ReadonlyMap<string, ReactionRow[]>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.reactions(user?.id, conversationId),
    enabled: enabled && !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyMap<string, ReactionRow[]>> => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(2000);
      if (error) throw error;
      const grouped = new Map<string, ReactionRow[]>();
      for (const row of data ?? []) {
        const list = grouped.get(row.message_id);
        if (list) list.push(row);
        else grouped.set(row.message_id, [row]);
      }
      return grouped;
    },
  });
}

type ReactionsData = ReadonlyMap<string, ReactionRow[]>;

/**
 * Structural-sharing update of the reactions map: only the touched message's
 * array gets a new identity, so memoized bubbles of other messages skip
 * re-rendering entirely.
 */
function patchReactions(
  old: ReactionsData | undefined,
  messageId: string,
  update: (list: ReactionRow[]) => ReactionRow[],
): ReactionsData | undefined {
  if (!old) return old;
  const next = new Map(old);
  const updated = update(old.get(messageId) ?? []);
  if (updated.length === 0) next.delete(messageId);
  else next.set(messageId, updated);
  return next;
}

/** Messenger semantics: tap the same emoji to remove, another to switch. */
export function useToggleReaction(conversationId: string) {
  const qc = useQueryClient();
  const { user, tenantId } = useAuth();
  return useMutation({
    mutationFn: async (input: { messageId: string; emoji: string; current?: string | null }) => {
      if (!user) throw new Error("chat: auth required");
      if (!tenantId) throw new Error("chat: tenant not resolved");
      if (input.current === input.emoji) {
        // Same emoji again -> remove the reaction.
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", input.messageId)
          .eq("user_id", user.id);
        if (error) throw error;
        return;
      }
      if (input.current) {
        // Switch: update only the emoji column (column-level grant).
        const { error } = await supabase
          .from("message_reactions")
          .update({ emoji: input.emoji })
          .eq("message_id", input.messageId)
          .eq("user_id", user.id);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("message_reactions").insert({
        message_id: input.messageId,
        conversation_id: conversationId,
        tenant_id: tenantId,
        user_id: user.id,
        emoji: input.emoji,
      });
      if (error) throw error;
    },
    // Optimistic: the tap lands instantly; the realtime echo (or the error
    // rollback below) reconciles the authoritative state.
    onMutate: async (input) => {
      if (!user || !tenantId) return;
      const key = chatKeys.reactions(user.id, conversationId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ReactionsData>(key);
      qc.setQueryData<ReactionsData>(key, (old) =>
        patchReactions(old, input.messageId, (list) => {
          const without = list.filter((r) => r.user_id !== user.id);
          if (input.current === input.emoji) return without;
          const optimistic: ReactionRow = {
            id: `optimistic-${input.messageId}-${user.id}`,
            message_id: input.messageId,
            conversation_id: conversationId,
            tenant_id: tenantId,
            user_id: user.id,
            emoji: input.emoji,
            created_at: new Date().toISOString(),
          };
          return [...without, optimistic];
        }),
      );
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (!user || !ctx) return;
      qc.setQueryData(chatKeys.reactions(user.id, conversationId), ctx.previous);
    },
  });
}

export interface TypingEvent {
  userId: string;
  /**
   * false = explicit "stopped typing" (broadcast on message send so the peer's
   * indicator clears immediately). Absent means typing - clients that predate
   * this field broadcast only { userId }, so the receiver must treat a missing
   * value as typing:true.
   */
  typing?: boolean;
}

// --- Shared typing-broadcast channels -------------------------------------
// Typing is peer-to-peer: BOTH participants must join the SAME realtime topic
// to exchange "typing" broadcasts, so the topic is STABLE - derived only from
// the conversation id. (The previous per-mount random suffix put every client
// on a private topic, so a peer's typing event never arrived and the indicator
// was dead code.)
//
// supabase dedupes channels by topic and throws if `.on()` runs after a channel
// has subscribed, so we cannot create a fresh stable-topic channel on each
// mount. Instead a single channel per conversation is ref-counted at module
// scope (same shape as chat presence): concurrent surfaces - StrictMode's
// double mount, a docked window plus the /messages page - share one
// subscription, and it is torn down only when the last subscriber releases it.
interface TypingChannelEntry {
  readonly channel: RealtimeChannel;
  readonly listeners: Set<(event: TypingEvent) => void>;
  refCount: number;
}

const typingChannels = new Map<string, TypingChannelEntry>();

function acquireTypingChannel(
  conversationId: string,
  listener: (event: TypingEvent) => void,
): void {
  let entry = typingChannels.get(conversationId);
  if (!entry) {
    const listeners = new Set<(event: TypingEvent) => void>();
    // self:false - never echo our own ping back to us (the listener also
    // guards on userId, but this saves a needless round trip).
    const channel = supabase
      .channel(`chat-conv:${conversationId}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, (payload) => {
        const data = (payload as { payload?: TypingEvent }).payload;
        if (!data?.userId) return;
        // Snapshot: a listener that releases mid-dispatch must not skip peers.
        for (const fn of [...listeners]) fn(data);
      });
    entry = { channel, listeners, refCount: 0 };
    typingChannels.set(conversationId, entry);
    channel.subscribe();
  }
  entry.listeners.add(listener);
  entry.refCount += 1;
}

function releaseTypingChannel(
  conversationId: string,
  listener: (event: TypingEvent) => void,
): void {
  const entry = typingChannels.get(conversationId);
  if (!entry) return;
  entry.listeners.delete(listener);
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    typingChannels.delete(conversationId);
    void supabase.removeChannel(entry.channel);
  }
}

/**
 * Broadcast a "typing" ping (or an explicit typing:false stop) on the
 * conversation's shared stable-topic channel.
 */
function sendTypingBroadcast(conversationId: string, userId: string, typing: boolean): void {
  const entry = typingChannels.get(conversationId);
  if (!entry) return;
  void entry.channel.send({ type: "broadcast", event: "typing", payload: { userId, typing } });
}

/**
 * Per-open-conversation realtime wiring, split across two channels:
 *  - messages INSERT/UPDATE  -> merge straight into the cache (no refetch lag)
 *  - reactions changes       -> patch the reactions map from the payload
 *  - participants UPDATE     -> refresh read receipts ("seen")
 *  - broadcast "typing"      -> ephemeral typing indicator (no DB writes)
 *
 * The postgres-changes stream is server -> client only and needs no shared
 * topic, so it lives on its own per-mount channel; a unique name keeps
 * concurrent surfaces from colliding on a single channel instance. Effect deps
 * use the stable uid string (not the user object), so auth token refreshes do
 * not tear the channel down; after a RE-subscribe the caches are invalidated
 * once to recover events dropped while the socket was down.
 *
 * Typing lives on a separate STABLE-topic channel shared with the peer (see
 * acquireTypingChannel). Returns a stable `sendTyping` emitter for the
 * composer; `sendTyping(false)` broadcasts an explicit stop (used on send).
 */
export function useConversationChannel(
  conversationId: string,
  enabled: boolean,
  onTyping: (event: TypingEvent) => void,
): { sendTyping: (typing?: boolean) => void } {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  const sendRef = useRef<(typing: boolean) => void>(() => {});

  useEffect(() => {
    if (!enabled || !uid) return;
    let everSubscribed = false;
    // Unique per mount: postgres_changes are server-push only, so this channel
    // is never shared with the peer and must not collide with another surface.
    const channelName = `chat-conv-db:${conversationId}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageRow;
          if (!row?.id) return;
          const key = chatKeys.messages(uid, conversationId);
          qc.setQueryData<MessagesData>(key, (old) => (old ? upsertMessageInCache(old, row) : old));
          // No conversations invalidation here: the shared per-user list
          // channel already fires for the same message (participants bump).
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageRow;
          if (!row?.id) return;
          const key = chatKeys.messages(uid, conversationId);
          // Patch-only: an edit/unsend of a message that is paginated out of
          // the cache must not be teleported to the top of the thread.
          qc.setQueryData<MessagesData>(key, (old) =>
            old ? upsertMessageInCache(old, row, { insertIfMissing: false }) : old,
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // Patch the cached map from the event payload - no refetch of the
          // whole reaction set per event. With RLS enabled Supabase strips
          // DELETE payloads down to the primary key, so removals are located
          // by scanning the (small, per-conversation) map for that id.
          const key = chatKeys.reactions(uid, conversationId);
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<ReactionRow>;
            if (!old?.id) {
              void qc.invalidateQueries({ queryKey: key });
              return;
            }
            qc.setQueryData<ReactionsData>(key, (data) => {
              if (!data) return data;
              for (const [messageId, list] of data) {
                if (list.some((r) => r.id === old.id)) {
                  return patchReactions(data, messageId, (rows) =>
                    rows.filter((r) => r.id !== old.id),
                  );
                }
              }
              return data;
            });
            return;
          }
          const row = payload.new as ReactionRow;
          if (!row?.message_id) return;
          qc.setQueryData<ReactionsData>(key, (data) =>
            patchReactions(data, row.message_id, (list) => [
              ...list.filter((r) => r.user_id !== row.user_id),
              row,
            ]),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participants",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: chatKeys.conversations(uid) });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (everSubscribed) {
            // Recovered from a disconnect: events may have been dropped while
            // the channel was down - resync both caches once.
            void qc.invalidateQueries({ queryKey: chatKeys.messages(uid, conversationId) });
            void qc.invalidateQueries({ queryKey: chatKeys.reactions(uid, conversationId) });
            void qc.invalidateQueries({ queryKey: chatKeys.conversations(uid) });
          }
          everSubscribed = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, enabled, uid, qc]);

  // Typing: shared STABLE-topic channel so the peer actually receives our pings
  // (and we receive theirs). Ref-counted at module scope; this effect just adds
  // and removes its listener + wires the emitter.
  useEffect(() => {
    if (!enabled || !uid) {
      sendRef.current = () => {};
      return;
    }
    const listener = (event: TypingEvent) => {
      if (event.userId !== uid) onTypingRef.current(event);
    };
    acquireTypingChannel(conversationId, listener);
    sendRef.current = (typing) => sendTypingBroadcast(conversationId, uid, typing);
    return () => {
      sendRef.current = () => {};
      releaseTypingChannel(conversationId, listener);
    };
  }, [conversationId, enabled, uid]);

  // Stable identity so the (memoized) composer never re-renders because of it.
  const sendTyping = useCallback((typing: boolean = true) => sendRef.current(typing), []);
  return { sendTyping };
}

/** Attachment history for the media/files side panel. Newest first. */
export interface ChatAttachmentRow {
  readonly id: string;
  readonly created_at: string;
  readonly kind: "image" | "file";
  readonly sender_id: string;
  readonly attachment_path: string;
  readonly attachment_name: string | null;
  readonly attachment_mime: string | null;
  readonly attachment_size: number | null;
}

export function useConversationAttachments(
  conversationId: string,
  enabled: boolean,
): UseQueryResult<ChatAttachmentRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: chatKeys.attachments(user?.id, conversationId),
    enabled: enabled && !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<ChatAttachmentRow[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, created_at, kind, sender_id, attachment_path, attachment_name, attachment_mime, attachment_size",
        )
        .eq("conversation_id", conversationId)
        .not("attachment_path", "is", null)
        .is("deleted_at", null)
        .in("kind", ["image", "file"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ChatAttachmentRow[];
    },
  });
}
