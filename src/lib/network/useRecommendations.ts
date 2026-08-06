// Rekomendacje - warstwa danych na bazie RPC `list_recommendations`,
// `write_recommendation`, `respond_recommendation`. Reguły biznesowe
// (jedno-do-jednego przez zaakceptowaną znajomość, moderacja po stronie
// odbiorcy, izolacja tenanta) trzymamy w bazie - klient tylko wywołuje RPC.
//
// KONTRAKT (jedno źródło prawdy: migracja 20260725090000). Trzy słowniki muszą
// być identyczne po obu stronach, bo baza nie ma jak ich wynegocjować:
//   * status:       pending | published | declined | hidden
//   * akcja:        publish | hide | decline | delete
//   * relationship: RECOMMENDATION_RELATIONSHIPS (domknięty CHECK kolumny)
// Wcześniej klient używał `visible` (nigdy nie pasowało do `published`) oraz
// `approve`/`delete` (baza je ignorowała, a mutacja kończyła się sukcesem - stąd
// toast „Opublikowano" przy zerowej zmianie stanu). Nowe RPC odrzuca nieznany
// czasownik wyjątkiem, więc taka rozbieżność nie może już przejść w ciszy.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Status moderacji rekomendacji (CHECK profile_recommendations.status). */
export type RecommendationStatus = "pending" | "published" | "declined" | "hidden";

/** Czasowniki akceptowane przez `respond_recommendation`. */
export type RecommendationAction = "publish" | "hide" | "decline" | "delete";

/**
 * Domknięty słownik relacji autor -> odbiorca. Kolejność jest kolejnością
 * prezentacji w formularzu (od najczęstszej), etykiety PL/EN w i18n-network
 * pod `network.recommendations.relationshipOptions.*`.
 */
export const RECOMMENDATION_RELATIONSHIPS = [
  "colleague",
  "manager",
  "report",
  "client",
  "mentor",
  "partner",
  "other",
] as const;

export type RecommendationRelationship = (typeof RECOMMENDATION_RELATIONSHIPS)[number];

export function isRecommendationRelationship(v: string): v is RecommendationRelationship {
  return (RECOMMENDATION_RELATIONSHIPS as readonly string[]).includes(v);
}

/** Granice tresci egzekwowane też przez bazę (CHECK + walidacja w RPC). */
export const RECOMMENDATION_BODY_MIN = 40;
export const RECOMMENDATION_BODY_MAX = 1200;

export interface Recommendation {
  id: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  author_headline: string | null;
  relationship: RecommendationRelationship | null;
  body: string;
  status: RecommendationStatus;
  created_at: string;
}

const STATUSES: readonly RecommendationStatus[] = ["pending", "published", "declined", "hidden"];

function toStatus(raw: string | null): RecommendationStatus {
  return STATUSES.includes(raw as RecommendationStatus) ? (raw as RecommendationStatus) : "pending";
}

/**
 * Wiersz RPC -> model widoku. Mapujemy jawnie (bez rzutowania całego wiersza),
 * żeby rozjazd nazw kolumn wyszedł na typach, a nie w runtime.
 */
type ListRow = {
  id: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  author_headline: string | null;
  relationship: string | null;
  body: string | null;
  status: string | null;
  created_at: string;
};

function toRecommendation(row: ListRow): Recommendation {
  const relationship = row.relationship ?? "";
  return {
    id: row.id,
    author_id: row.author_id,
    author_name: row.author_name ?? "",
    author_avatar: row.author_avatar,
    author_headline: row.author_headline,
    relationship: isRecommendationRelationship(relationship) ? relationship : null,
    body: row.body ?? "",
    status: toStatus(row.status),
    created_at: row.created_at,
  };
}

/**
 * Klucz niesie TAKŻE id oglądającego, nie tylko odbiorcy rekomendacji. To nie
 * jest ozdoba: ta sama lista wygląda inaczej zależnie od tego, KTO pyta - baza
 * pokazuje autorowi jego `hidden`/`declined` jako `pending` (prywatność
 * moderacji), a odbiorcy prawdziwe statusy. Klucz bez oglądającego oznaczał
 * jeden wpis w cache na dwie różne odpowiedzi, więc zmiana konta bez twardego
 * przeładowania serwowała cudzy obraz moderacji. Reguła jak w networkKeys.
 */
const keys = {
  list: (viewerId: string | undefined, recipientId: string) =>
    ["network", "recommendations", viewerId ?? "anon", recipientId] as const,
};

export function useRecommendations(
  recipientId: string | null | undefined,
): UseQueryResult<ReadonlyArray<Recommendation>> {
  const { user } = useAuth();
  return useQuery({
    queryKey: keys.list(user?.id, recipientId ?? "none"),
    enabled: Boolean(recipientId),
    staleTime: 30_000,
    queryFn: async (): Promise<ReadonlyArray<Recommendation>> => {
      if (!recipientId) return [];
      const { data, error } = await supabase.rpc("list_recommendations", {
        p_recipient: recipientId,
      });
      if (error) throw error;
      return (data ?? []).map((row) => toRecommendation(row as ListRow));
    },
  });
}

export function useWriteRecommendation(
  recipientId: string,
): UseMutationResult<string, Error, { body: string; relationship: RecommendationRelationship }> {
  const qc = useQueryClient();
  const { user } = useAuth();
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
      void qc.invalidateQueries({ queryKey: keys.list(user?.id, recipientId) });
    },
  });
}

/**
 * Odbiorca decyduje o widoczności rekomendacji: publish = pokaż na profilu,
 * hide = ukryj, decline = odrzuć, delete = usuń całkowicie. Autor nigdy nie
 * widzi odmowy - `list_recommendations` prezentuje mu hidden/declined jako
 * pending (prywatność moderacji egzekwowana w bazie, nie w UI).
 */
export function useRespondRecommendation(): UseMutationResult<
  void,
  Error,
  { id: string; action: RecommendationAction; recipientId: string }
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
      // Odbiorca zmienia widoczność cudzej rekomendacji: odświeżamy listę
      // profilu, którego dotyczy decyzja, ORAZ własną listę oglądającego.
      void qc.invalidateQueries({ queryKey: keys.list(user?.id, v.recipientId) });
      if (user?.id) void qc.invalidateQueries({ queryKey: keys.list(user.id, user.id) });
    },
  });
}
