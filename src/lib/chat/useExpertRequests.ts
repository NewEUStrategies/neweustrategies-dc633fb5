// Hooki systemu „Zapytanie do eksperta" (Plus/Pro → ekspert/VIP). RPC są
// SECURITY DEFINER i tenant-scoped; klient tylko relayuje intencje. RLS-safe.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type ExpertRequestRow = Database["public"]["Tables"]["expert_inmails"]["Row"];
export type ExpertRequestBox = "sent" | "received";
export type ExpertRequestAction = "approve" | "decline" | "answered" | "cancel";

export interface SendExpertRequestInput {
  recipientId: string;
  subject: string;
  reason: string;
  questions: string[];
  expectedAnswers?: string;
  externalLinks: string[];
}

/** Stan miesięcznej puli zapytań zalogowanego użytkownika (serwer = źródło prawdy). */
export interface ExpertRequestQuota {
  quota: number;
  used: number;
  remaining: number;
  unlimited: boolean;
  direct: boolean;
}

export const expertRequestKeys = {
  all: ["expertRequests"] as const,
  my: (uid: string | undefined, box: ExpertRequestBox) =>
    ["expertRequests", "my", uid ?? "anon", box] as const,
  admin: (status: string | null) => ["expertRequests", "admin", status ?? "all"] as const,
  quota: (uid: string | undefined) => ["expertRequests", "quota", uid ?? "anon"] as const,
} as const;

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Miesięczna pula zapytań do ekspertów - zasila CTA i podtytuł dialogu. */
export function useMyExpertRequestQuota(): UseQueryResult<ExpertRequestQuota> {
  const { user } = useAuth();
  return useQuery({
    queryKey: expertRequestKeys.quota(user?.id),
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<ExpertRequestQuota> => {
      const { data, error } = await supabase.rpc("my_expert_request_quota");
      if (error) throw error;
      const rec = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<
        string,
        unknown
      >;
      return {
        quota: toNumber(rec.quota),
        used: toNumber(rec.used),
        remaining: toNumber(rec.remaining),
        unlimited: rec.unlimited === true,
        direct: rec.direct === true,
      };
    },
  });
}

export function useMyExpertRequests(box: ExpertRequestBox): UseQueryResult<ExpertRequestRow[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: expertRequestKeys.my(user?.id, box),
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<ExpertRequestRow[]> => {
      const { data, error } = await supabase.rpc("list_my_expert_requests", { p_box: box });
      if (error) throw error;
      return (data ?? []) as ExpertRequestRow[];
    },
  });
}

export function useAdminExpertRequests(
  status: string | null = null,
): UseQueryResult<ExpertRequestRow[]> {
  return useQuery({
    queryKey: expertRequestKeys.admin(status),
    staleTime: 15_000,
    queryFn: async (): Promise<ExpertRequestRow[]> => {
      const args: { p_status?: string; p_limit?: number; p_offset?: number } = {
        p_limit: 200,
        p_offset: 0,
      };
      if (status) args.p_status = status;
      const { data, error } = await supabase.rpc("admin_list_expert_requests", args);
      if (error) throw error;
      return (data ?? []) as ExpertRequestRow[];
    },
  });
}

export function useSendExpertRequest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: SendExpertRequestInput): Promise<string> => {
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
      const { data, error } = await supabase.rpc("send_expert_request", args);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: expertRequestKeys.my(user?.id, "sent") });
      void qc.invalidateQueries({ queryKey: expertRequestKeys.quota(user?.id) });
    },
  });
}

export function useResolveExpertRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      action: ExpertRequestAction;
      note?: string;
    }) => {
      const args: { p_request_id: string; p_action: string; p_note?: string } = {
        p_request_id: input.requestId,
        p_action: input.action,
      };
      if (input.note && input.note.trim().length > 0) {
        args.p_note = input.note.trim();
      }
      const { data, error } = await supabase.rpc("resolve_expert_request", args);
      if (error) throw error;
      return data as { status: string; conversation_id?: string } | null;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: expertRequestKeys.all });
    },
  });
}
