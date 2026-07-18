// Rekomendacje - warstwa danych na bazie RPC `list_recommendations`,
// `write_recommendation`, `respond_recommendation`. Reguły biznesowe
// (jedno-do-jednego przez zaakceptowaną znajomość, moderacja po stronie
// odbiorcy, izolacja tenanta) trzymamy w bazie - klient tylko wywołuje RPC.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Recommendation {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  author_headline: string | null;
  relationship: string | null;
  body: string;
  status: "pending" | "visible" | "hidden";
  created_at: string;
}

const keys = {
  list: (recipientId: string) => ["network", "recommendations", recipientId] as const,
};

export function useRecommendations(
  recipientId: string | null | undefined,
): UseQueryResult<ReadonlyArray<Recommendation>> {
  return useQuery({
    queryKey: keys.list(recipientId ?? "none"),
    enabled: Boolean(recipientId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyArray<Recommendation>> => {
      if (!recipientId) return [];
      const { data, error } = await supabase.rpc("list_recommendations", {
        p_recipient: recipientId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ReadonlyArray<Recommendation>;
    },
  });
}

export function useWriteRecommendation(
  recipientId: string,
): UseMutationResult<string, Error, { body: string; relationship: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, relationship }) => {
      const { data, error } = await supabase.rpc("write_recommendation", {
        p_recipient: recipientId,
        p_body: body,
        p_relationship: relationship,
      });
      if (error) throw error;
      return String(data);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.list(recipientId) });
    },
  });
}

/**
 * Odbiorca decyduje o widoczności rekomendacji: approve = pokaż na profilu,
 * hide = ukryj, delete = usuń całkowicie. Autor nigdy nie widzi rejection -
 * pending zostaje pending, ukryta zostaje pending w jego widoku (prywatność).
 */
export function useRespondRecommendation(): UseMutationResult<
  void,
  Error,
  { id: string; action: "approve" | "hide" | "delete"; recipientId: string }
> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, action }) => {
      const { error } = await supabase.rpc("respond_recommendation", {
        p_id: id,
        p_action: action,
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: keys.list(v.recipientId) });
      if (user?.id) void qc.invalidateQueries({ queryKey: keys.list(user.id) });
    },
  });
}
