// Poparcia umiejętności (endorsements) - warstwa danych na bazie RPC-ów
// `skill_endorsement_counts`, `endorse_skill`, `unendorse_skill`. RPC-y
// egzekwują izolację tenanta i regułę „nie popieraj sam siebie / musisz mieć
// zaakceptowaną znajomość z odbiorcą". UI po prostu wywołuje RPC i ufa RLS.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface SkillEndorsement {
  skill_id: string;
  cnt: number;
  by_me: boolean;
}

const keys = {
  counts: (uid: string | undefined, recipientId: string) =>
    ["network", "endorsements", uid ?? "anon", recipientId] as const,
};

export function useSkillEndorsements(
  recipientId: string | null | undefined,
): UseQueryResult<ReadonlyArray<SkillEndorsement>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.counts(user?.id, recipientId ?? "none"),
    enabled: Boolean(recipientId),
    staleTime: 60_000,
    queryFn: async (): Promise<ReadonlyArray<SkillEndorsement>> => {
      if (!recipientId) return [];
      const { data, error } = await supabase.rpc("skill_endorsement_counts", {
        p_user: recipientId,
      });
      if (error) throw error;
      return (data ?? []) as ReadonlyArray<SkillEndorsement>;
    },
  });
}

export function useToggleEndorsement(
  recipientId: string,
): UseMutationResult<void, Error, { skillId: string; endorsed: boolean }> {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ skillId, endorsed }) => {
      if (endorsed) {
        const { error } = await supabase.rpc("unendorse_skill", { p_skill_id: skillId });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("endorse_skill", { p_skill_id: skillId });
        if (error) throw error;
      }
    },
    onMutate: async ({ skillId, endorsed }) => {
      const key = keys.counts(user?.id, recipientId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ReadonlyArray<SkillEndorsement>>(key) ?? [];
      const next = (() => {
        const found = prev.find((r) => r.skill_id === skillId);
        if (found) {
          return prev.map((r) =>
            r.skill_id === skillId
              ? { ...r, by_me: !endorsed, cnt: Math.max(0, r.cnt + (endorsed ? -1 : 1)) }
              : r,
          );
        }
        if (endorsed) return prev;
        return [...prev, { skill_id: skillId, cnt: 1, by_me: true }];
      })();
      qc.setQueryData(key, next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.counts(user?.id, recipientId), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.counts(user?.id, recipientId) });
    },
  });
}
