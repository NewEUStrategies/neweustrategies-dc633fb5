// Moduł "Wprowadzenia" (LinkedIn-style bridge introductions) - warstwa danych.
//
// Łańcuch: requester -> bridge -> target. Wszystkie RPC są SECURITY DEFINER
// i egzekwują:
//   - tenant_id (izolacja organizacji),
//   - relacje requester<->bridge oraz bridge<->target muszą być zaakceptowane,
//   - target musi zezwalać na komunikację (allowConnections),
//   - jeden aktywny request na trójkę (deduplikacja w bazie).
// RPC dostępne w projekcie:
//   - request_introduction(p_bridge, p_target, p_message) -> uuid,
//   - respond_introduction(p_id, p_action) -> void,
//   - my_introduction_requests(p_role) -> lista wierszy z widoczną
//     tożsamością każdej ze stron (baza sama dobiera zakres pól).
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];
export type IntroductionRow = Fns["my_introduction_requests"]["Returns"][number];

/** Rola z perspektywy zalogowanego użytkownika. */
export type IntroductionRole = "requester" | "bridge" | "target" | "all";

/** Status wiersza introduction_requests. */
export type IntroductionStatus = "pending" | "accepted" | "declined" | "withdrawn";

export const INTRO_MESSAGE_MIN = 20;
export const INTRO_MESSAGE_MAX = 600;

const keys = {
  list: (userId: string, role: IntroductionRole) =>
    ["network", "introductions", userId, role] as const,
};

/** Lista wprowadzeń dla zalogowanego użytkownika w wybranej roli. */
export function useMyIntroductions(
  role: IntroductionRole = "all",
): UseQueryResult<ReadonlyArray<IntroductionRow>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.list(user?.id ?? "none", role),
    enabled: Boolean(user?.id),
    staleTime: 15_000,
    queryFn: async (): Promise<ReadonlyArray<IntroductionRow>> => {
      const { data, error } = await supabase.rpc("my_introduction_requests", {
        p_role: role,
      });
      if (error) throw error;
      return (data ?? []) as ReadonlyArray<IntroductionRow>;
    },
  });
}

export interface RequestIntroductionInput {
  bridgeId: string;
  targetId: string;
  message: string;
}

/** Wyślij prośbę o wprowadzenie (requester -> bridge -> target). */
export function useRequestIntroduction(): UseMutationResult<
  string,
  Error,
  RequestIntroductionInput
> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      bridgeId,
      targetId,
      message,
    }: RequestIntroductionInput): Promise<string> => {
      const trimmed = message.trim();
      if (trimmed.length < INTRO_MESSAGE_MIN || trimmed.length > INTRO_MESSAGE_MAX) {
        throw new Error("Message length out of range");
      }
      const { data, error } = await supabase.rpc("request_introduction", {
        p_bridge: bridgeId,
        p_target: targetId,
        p_message: trimmed,
      });
      if (error) throw error;
      return String(data);
    },
    onSuccess: () => {
      if (user?.id) {
        void qc.invalidateQueries({
          queryKey: ["network", "introductions", user.id],
        });
      }
    },
  });
}

export interface RespondIntroductionInput {
  id: string;
  action: "accept" | "decline" | "withdraw";
}

/** Odpowiedź na prośbę (bridge: accept/decline, requester: withdraw). */
export function useRespondIntroduction(): UseMutationResult<void, Error, RespondIntroductionInput> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, action }: RespondIntroductionInput): Promise<void> => {
      const { error } = await supabase.rpc("respond_introduction", {
        p_id: id,
        p_action: action,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (user?.id) {
        void qc.invalidateQueries({
          queryKey: ["network", "introductions", user.id],
        });
      }
    },
  });
}
