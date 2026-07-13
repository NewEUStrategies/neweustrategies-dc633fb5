// Group conversation ("kręgi") mutations - thin wrappers over the SECURITY
// DEFINER RPCs from 20260713094000_group_conversations.sql. All enforcement
// (tenant scoping, block pairs, allow_messages_from privacy, 49-member cap,
// owner-only management, owner hand-off on leave) happens server-side; the
// client only relays intent and refreshes the conversations cache.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chatKeys } from "./keys";

function useInvalidateConversations() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return () => void qc.invalidateQueries({ queryKey: chatKeys.conversations(user?.id) });
}

/** Create a circle; resolves to the new conversation id. */
export function useCreateGroup() {
  const invalidate = useInvalidateConversations();
  return useMutation({
    mutationFn: async (args: { title: string; memberIds: string[] }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_group_conversation", {
        p_title: args.title,
        p_member_ids: args.memberIds,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Owner-only: invite more members (server filters ineligible candidates). */
export function useAddGroupMembers() {
  const invalidate = useInvalidateConversations();
  return useMutation({
    mutationFn: async (args: { conversationId: string; memberIds: string[] }): Promise<number> => {
      const { data, error } = await supabase.rpc("add_group_members", {
        p_conversation_id: args.conversationId,
        p_member_ids: args.memberIds,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: invalidate,
  });
}

/** Leave the circle (last member out deletes it; owner hands off first). */
export function useLeaveGroup() {
  const invalidate = useInvalidateConversations();
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase.rpc("leave_group_conversation", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Owner-only: rename the circle (2-80 chars, server-validated). */
export function useRenameGroup() {
  const invalidate = useInvalidateConversations();
  return useMutation({
    mutationFn: async (args: { conversationId: string; title: string }) => {
      const { error } = await supabase.rpc("rename_group_conversation", {
        p_conversation_id: args.conversationId,
        p_title: args.title,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
