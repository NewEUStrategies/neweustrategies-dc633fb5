// Kluby - hooki REAKCJI, STANOWISK I SUBSKRYPCJI WATKU.
//
// Wydzielone z `useClubs.ts` - patrz naglowek `useClubCatalog.ts`. Tu zyje
// jedyna w module mutacja OPTYMISTYCZNA (`useToggleClubReaction`): pasek
// reakcji odpowiada natychmiast, a przy odmowie bazy cofa sie do stanu
// sprzed kliku.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchClubReactionActors,
  fetchClubReactions,
  fetchClubStanceSummary,
  fetchMyThreadSubscription,
  reactToClubTarget,
  setClubStance,
  setClubThreadSubscription,
  unreactFromClubTarget,
} from "./api";
import { clubKeys } from "./queryKeys";
import { CLUB_STALE_MS, invalidateKeys, reactionKeys, threadStanceKeys } from "./clubInvalidations";
import { applyReactionToggle } from "./types";
import type {
  ClubReactionKind,
  ClubReactionActor,
  ClubReactionTally,
  ClubReactionTarget,
  ClubStance,
  ClubStanceSummaryRow,
  ClubSubscriptionState,
} from "./types";

// ---------------------------------------------------------------------------
// Etap A4: reakcje, stanowiska, subskrypcje
// ---------------------------------------------------------------------------

/** Reakcje dla CALEJ widocznej partii jednym zapytaniem - nigdy N+1. */
export function useClubReactions(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
}): UseQueryResult<Map<string, ClubReactionTally[]>, Error> {
  const { targetType, targetIds } = params;
  return useQuery({
    queryKey: clubKeys.reactions(targetType, targetIds),
    queryFn: () => fetchClubReactions({ targetType, targetIds }),
    staleTime: 10_000,
    enabled: targetIds.length > 0,
  });
}

/**
 * Twarze osób, które zareagowały. Osobne zapytanie od liczników, bo licznik
 * odświeżamy optymistycznie po każdym kliknięciu, a lista twarzy jest cięższa
 * i wystarczy jej odświeżenie po potwierdzeniu serwera.
 */
export function useClubReactionActors(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
  limit?: number;
  enabled?: boolean;
}): UseQueryResult<Map<string, ClubReactionActor[]>, Error> {
  const { targetType, targetIds, limit, enabled } = params;
  return useQuery({
    queryKey: clubKeys.reactionActors(targetType, targetIds),
    queryFn: () => fetchClubReactionActors({ targetType, targetIds, limit }),
    staleTime: 30_000,
    enabled: targetIds.length > 0 && enabled !== false,
  });
}

export interface ToggleReactionVars {
  targetId: string;
  kind: ClubReactionKind;
  /** Czy uzytkownik JUZ postawil te reakcje - decyduje o kierunku operacji. */
  active: boolean;
}

/**
 * Przelaczenie reakcji. Optymistyczna aktualizacja odwzorowuje regule triggera
 * (applyReactionToggle), wiec pasek nigdy nie pokazuje stanu, ktorego baza nie
 * dopusci - np. agree i disagree naraz od tej samej osoby.
 */
export function useToggleClubReaction(params: {
  targetType: ClubReactionTarget;
  targetIds: string[];
}): UseMutationResult<boolean, Error, ToggleReactionVars> {
  const { targetType, targetIds } = params;
  const qc = useQueryClient();
  const key = clubKeys.reactions(targetType, targetIds);

  return useMutation({
    mutationFn: (vars) =>
      vars.active
        ? unreactFromClubTarget({ targetType, targetId: vars.targetId, kind: vars.kind })
        : reactToClubTarget({ targetType, targetId: vars.targetId, kind: vars.kind }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Map<string, ClubReactionTally[]>>(key);
      if (previous) {
        const next = new Map(previous);
        next.set(vars.targetId, applyReactionToggle(previous.get(vars.targetId) ?? [], vars.kind));
        qc.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      // Cofamy optymistyczna zmiane: pasek pokazujacy reakcje, ktorej baza nie
      // przyjela, jest gorszy niz chwilowe migniecie.
      const previous = (context as { previous?: Map<string, ClubReactionTally[]> } | undefined)
        ?.previous;
      if (previous) qc.setQueryData(key, previous);
    },
    onSettled: () => invalidateKeys(qc, reactionKeys(targetType, targetIds)),
  });
}

export function useClubStanceSummary(
  threadId: string | undefined,
): UseQueryResult<ClubStanceSummaryRow[], Error> {
  return useQuery({
    queryKey: clubKeys.stances(threadId ?? ""),
    queryFn: () => fetchClubStanceSummary(threadId ?? ""),
    staleTime: 10_000,
    enabled: Boolean(threadId),
  });
}

export function useSetClubStance(
  threadId: string,
): UseMutationResult<boolean, Error, { stance: ClubStance; rationale?: string | null }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => setClubStance({ threadId, ...vars }),
    onSuccess: () => invalidateKeys(qc, threadStanceKeys(threadId)),
  });
}

export function useMyThreadSubscription(
  threadId: string | undefined,
): UseQueryResult<ClubSubscriptionState | null, Error> {
  return useQuery({
    queryKey: clubKeys.subscription(threadId ?? ""),
    queryFn: () => fetchMyThreadSubscription(threadId ?? ""),
    staleTime: CLUB_STALE_MS,
    enabled: Boolean(threadId),
  });
}

export function useSetThreadSubscription(
  threadId: string,
): UseMutationResult<boolean, Error, ClubSubscriptionState> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (state) => setClubThreadSubscription({ threadId, state }),
    onSuccess: (_ok, state) => {
      qc.setQueryData(clubKeys.subscription(threadId), state);
    },
  });
}
