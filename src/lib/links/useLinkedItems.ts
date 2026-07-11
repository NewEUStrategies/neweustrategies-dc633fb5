// Graf powiązań między modułami - warstwa danych. Jeden hook zamiast joinów
// pisanych osobno w każdym module: RPC get_linked_items zwraca obie strony
// relacji (incoming/outgoing) z etykietami rozwiązanymi w bazie (bez N+1).
import { useEffect } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subscribeToTable } from "@/lib/realtime/tableChannelHub";
import { linkedItemsKeys } from "./keys";

export type LinkedItemType =
  | "post"
  | "page"
  | "comment"
  | "crm_lead"
  | "crm_note"
  | "profile"
  | "message"
  | "newsletter_subscriber";

export type LinkDirection = "incoming" | "outgoing";

export interface LinkedItem {
  referenceId: string;
  direction: LinkDirection;
  itemType: string;
  itemId: string;
  relation: string;
  label: string | null;
  createdAt: string;
}

/** Adres panelu admina dla powiązanej encji (null = brak nawigacji). */
export function linkedItemHref(item: LinkedItem): string | null {
  switch (item.itemType) {
    case "crm_lead":
      return `/admin/crm?lead=${item.itemId}`;
    case "newsletter_subscriber":
      return "/admin/newsletter/subscribers";
    default:
      return null;
  }
}

export function useLinkedItems(
  itemType: LinkedItemType,
  itemId: string | null | undefined,
): UseQueryResult<LinkedItem[]> {
  const { user } = useAuth();
  return useQuery({
    queryKey: linkedItemsKeys.item(itemType, itemId ?? "none"),
    enabled: !!user && !!itemId,
    staleTime: 30_000,
    queryFn: async (): Promise<LinkedItem[]> => {
      const { data, error } = await supabase.rpc("get_linked_items", {
        p_item_type: itemType,
        p_item_id: itemId ?? "",
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        referenceId: row.reference_id,
        direction: row.direction === "incoming" ? "incoming" : "outgoing",
        itemType: row.item_type,
        itemId: row.item_id,
        relation: row.relation,
        label: row.label,
        createdAt: row.created_at,
      }));
    },
  });
}

/** Realtime grafu: zmiana cross_references odświeża panele "Powiązane". */
export function useLinkedItemsRealtime(): void {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    return subscribeToTable({ table: "cross_references" }, () => {
      void qc.invalidateQueries({ queryKey: linkedItemsKeys.all });
    });
  }, [uid, qc]);
}
