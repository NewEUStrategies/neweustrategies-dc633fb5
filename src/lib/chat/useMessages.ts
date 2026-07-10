// Messages data layer for a single conversation: infinite history, optimistic
// send, unsend (soft delete), reactions and the per-conversation realtime
// channel (new/edited messages + reactions + read receipts + typing broadcast).
import { useEffect, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chatKeys } from "./keys";
import type { ChatMessage, MessageRow, ReactionRow } from "./types";

const PAGE_SIZE = 40;

type MessagesData = InfiniteData<ChatMessage[], string | null>;

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
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ChatMessage[]> => {
      let q = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? (lastPage[lastPage.length - 1]?.created_at ?? null) : null,
  });
}

/** Upsert a message into the cached pages (dedupe by id, newest first). */
function upsertMessageInCache(
  data: MessagesData | undefined,
  message: ChatMessage,
  replaceId?: string,
): MessagesData | undefined {
  if (!data) return data;
  const pages = data.pages.map((page) => [...page]);
  let found = false;
  for (const page of pages) {
    for (let i = 0; i < page.length; i++) {
      const current = page[i];
      if (current && (current.id === message.id || (replaceId && current.id === replaceId))) {
        page[i] = { ...current, ...message, pending: false };
        found = true;
      }
    }
  }
  if (!found) {
    if (pages.length === 0) pages.push([message]);
    else pages[0] = [message, ...pages[0]];
  }
  return { ...data, pages };
}

function removeMessageFromCache(
  data: MessagesData | undefined,
  messageId: string,
): MessagesData | undefined {
  if (!data) return data;
  return { ...data, pages: data.pages.map((page) => page.filter((m) => m.id !== messageId)) };
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
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: input.conversationId,
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
      if (!user) return { tempId: "", conversationId: input.conversationId };
      const key = chatKeys.messages(user.id, input.conversationId);
      await qc.cancelQueries({ queryKey: key });
      const tempId = `pending-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversation_id: input.conversationId,
        tenant_id: tenantId ?? "",
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
      qc.setQueryData<MessagesData>(key, (old) =>
        old ? upsertMessageInCache(old, optimistic) : { pages: [[optimistic]], pageParams: [null] },
      );
      return { tempId, conversationId: input.conversationId };
    },
    onSuccess: (row, _input, ctx) => {
      if (!user || !ctx) return;
      const key = chatKeys.messages(user.id, ctx.conversationId);
      qc.setQueryData<MessagesData>(key, (old) => upsertMessageInCache(old, row, ctx.tempId));
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user.id) });
    },
    onError: (_err, _input, ctx) => {
      if (!user || !ctx?.tempId) return;
      const key = chatKeys.messages(user.id, ctx.conversationId);
      qc.setQueryData<MessagesData>(key, (old) => {
        if (!old) return old;
        const pages = old.pages.map((page) =>
          page.map((m) => (m.id === ctx.tempId ? { ...m, pending: false, failed: true } : m)),
        );
        return { ...old, pages };
      });
    },
  });
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
      qc.setQueryData<MessagesData>(key, (old) => upsertMessageInCache(old, row));
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
      qc.setQueryData<MessagesData>(key, (old) => upsertMessageInCache(old, row));
      void qc.invalidateQueries({ queryKey: chatKeys.conversations(user.id) });
    },
  });
}

/** Remove a failed optimistic message from the cache (retry is a fresh send). */
export function useDiscardFailedMessage(conversationId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return (messageId: string) => {
    if (!user) return;
    const key = chatKeys.messages(user.id, conversationId);
    qc.setQueryData<MessagesData>(key, (old) => removeMessageFromCache(old, messageId));
  };
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

/** Messenger semantics: tap the same emoji to remove, another to switch. */
export function useToggleReaction(conversationId: string) {
  const qc = useQueryClient();
  const { user, tenantId } = useAuth();
  return useMutation({
    mutationFn: async (input: { messageId: string; emoji: string; current?: string | null }) => {
      if (!user) throw new Error("chat: auth required");
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
        tenant_id: tenantId ?? "",
        user_id: user.id,
        emoji: input.emoji,
      });
      if (error) throw error;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.reactions(user?.id, conversationId) });
    },
  });
}

export interface TypingEvent {
  userId: string;
}

/**
 * One realtime channel per open conversation:
 *  - messages INSERT/UPDATE  -> merge straight into the cache (no refetch lag)
 *  - reactions changes       -> refresh the reactions map
 *  - participants UPDATE     -> refresh read receipts ("seen")
 *  - broadcast "typing"      -> ephemeral typing indicator (no DB writes)
 * Returns a stable `sendTyping` emitter for the composer.
 */
export function useConversationChannel(
  conversationId: string,
  enabled: boolean,
  onTyping: (event: TypingEvent) => void,
): { sendTyping: () => void } {
  const qc = useQueryClient();
  const { user } = useAuth();
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  const sendRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled || !user) return;
    const uid = user.id;
    const channelName = `chat-conv:${conversationId}:${Math.random().toString(36).slice(2, 10)}`;
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
          void qc.invalidateQueries({ queryKey: chatKeys.conversations(uid) });
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
          qc.setQueryData<MessagesData>(key, (old) => (old ? upsertMessageInCache(old, row) : old));
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
        () => {
          void qc.invalidateQueries({ queryKey: chatKeys.reactions(uid, conversationId) });
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
      .on("broadcast", { event: "typing" }, (payload) => {
        const data = payload.payload as TypingEvent | undefined;
        if (data?.userId && data.userId !== uid) onTypingRef.current(data);
      })
      .subscribe();

    sendRef.current = () => {
      void channel.send({ type: "broadcast", event: "typing", payload: { userId: uid } });
    };

    return () => {
      sendRef.current = () => {};
      void supabase.removeChannel(channel);
    };
  }, [conversationId, enabled, user, qc]);

  return { sendTyping: () => sendRef.current() };
}
