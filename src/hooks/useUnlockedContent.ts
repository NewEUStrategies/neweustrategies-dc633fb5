import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { fetchGatedBody } from "@/lib/queries/public";
import type { BodyParts } from "@/lib/access/gating";

/**
 * Client-side unlock for gated bodies.
 *
 * The anonymous SSR resolver ships a null body for premium content (so the
 * server never leaks it). Once a session exists on the client, this hook
 * re-requests the body through the same SECURITY DEFINER RPC, which returns it
 * only for entitled users. Keyed by user id so login/logout transitions refetch
 * and one user's unlocked body is never served to another.
 *
 * @param enabled pass the caller's "needs unlock" signal (gated mode + a body
 *   that did not arrive from SSR). The query stays idle otherwise.
 */
export function useUnlockedContent(
  entityType: "post" | "page",
  entityId: string | null,
  enabled: boolean,
): BodyParts | null {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  const { data } = useQuery({
    queryKey: ["unlocked-body", entityType, entityId, uid] as const,
    enabled: enabled && !!entityId && !!uid,
    queryFn: () => fetchGatedBody(entityType, entityId as string),
    staleTime: 5 * 60_000,
  });

  return data ?? null;
}
