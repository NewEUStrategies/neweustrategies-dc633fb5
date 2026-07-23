// Hooki dla systemu inMail (Plus → Ekspert). RPC są SECURITY DEFINER i
// tenant-scoped; klient tylko relayuje intencje. Wszystko RLS-safe.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type InMailRow = Database["public"]["Tables"]["expert_inmails"]["Row"];
export type InMailBox = "sent" | "received";
export type InMailAction = "approve" | "decline" | "answered" | "cancel";

export interface SendInMailInput {
  recipientId: string;
  subject: string;
  reason: string;
  questions: string[];
  expectedAnswers?: string;
  externalLinks: string[];
}

export const inmailKeys = {
  all: ["inmails"] as const,
  my: (uid: string | undefined, box: InMailBox) => ["inmails", "my", uid ?? "anon", box] as const,
  admin: (status: string | null) => ["inmails", "admin", status ?? "all"] as const,
  features: (uid: string | undefined) => ["inmails", "features", uid ?? "anon"] as const,
} as const;

/**
 * Zbiór flag efektywnej warstwy zalogowanego użytkownika (grants + subskrypcje).
 * Cache 5 min - warstwy zmieniają się rzadko, a bramka po stronie serwera
 * jest źródłem prawdy; klient tylko wybiera UX.
 */
export function useMyTierFeatures(): UseQueryResult<Record<string, boolean>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: inmailKeys.features(user?.id),
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await supabase.rpc("my_effective_tier_features");
      if (error) throw error;
      const out: Record<string, boolean> = {};
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          out[k] = v === true;
        }
      }
      return out;
    },
  });
}

export function useMyInmails(box: InMailBox): UseQueryResult<InMailRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: inmailKeys.my(user?.id, box),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<InMailRow[]> => {
      const { data, error } = await supabase.rpc("list_my_inmails", { p_box: box });
      if (error) throw error;
      return (data ?? []) as InMailRow[];
    },
  });
}

export function useAdminInmails(status: string | null = null): UseQueryResult<InMailRow[]> {
  return useQuery({
    queryKey: inmailKeys.admin(status),
    staleTime: 15_000,
    queryFn: async (): Promise<InMailRow[]> => {
      const args: { p_status?: string; p_limit?: number; p_offset?: number } = {
        p_limit: 200,
        p_offset: 0,
      };
      if (status) args.p_status = status;
      const { data, error } = await supabase.rpc("admin_list_inmails", args);
      if (error) throw error;
      return (data ?? []) as InMailRow[];
    },
  });
}

export function useSendInmail() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: SendInMailInput): Promise<string> => {
      const args: {
        p_recipient_id: string;
        p_subject: string;
        p_reason: string;
        p_questions?: string[];
        p_expected_answers?: string;
        p_external_links?: string[];
      } = {
        p_recipient_id: input.recipientId,
        p_subject: input.subject,
        p_reason: input.reason,
        p_questions: input.questions,
        p_external_links: input.externalLinks,
      };
      if (input.expectedAnswers && input.expectedAnswers.trim().length > 0) {
        args.p_expected_answers = input.expectedAnswers.trim();
      }
      const { data, error } = await supabase.rpc("send_expert_inmail", args);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inmailKeys.my(user?.id, "sent") });
    },
  });
}

export function useResolveInmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inmailId: string; action: InMailAction; note?: string }) => {
      const args: { p_inmail_id: string; p_action: string; p_note?: string } = {
        p_inmail_id: input.inmailId,
        p_action: input.action,
      };
      if (input.note && input.note.trim().length > 0) {
        args.p_note = input.note.trim();
      }
      const { data, error } = await supabase.rpc("resolve_expert_inmail", args);
      if (error) throw error;
      return data as { status: string; conversation_id?: string } | null;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inmailKeys.all });
    },
  });
}
