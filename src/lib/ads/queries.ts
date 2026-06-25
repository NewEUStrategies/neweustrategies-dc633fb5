// Publiczne zapytania o aktywne reklamy do wyświetlenia czytelnikom.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AdPageType, AdPlacementWithSlot, AdPosition } from "./types";

interface FetchArgs {
  position: AdPosition;
  pageType: AdPageType;
  pageId?: string | null;
}

async function fetchPlacements({ position, pageType, pageId }: FetchArgs): Promise<AdPlacementWithSlot[]> {
  const { data, error } = await supabase
    .from("ad_placements")
    .select("*, slot:ad_slots!inner(*)")
    .eq("position", position)
    .in("page_type", ["all", pageType])
    .eq("active", true)
    .eq("slot.status", "active")
    .order("sort_order");

  if (error) throw error;
  // Filtrujemy page_id po stronie klienta - jeśli placement ma page_id ≠ null, musi pasować.
  return ((data as AdPlacementWithSlot[]) ?? []).filter(
    (p) => p.page_id == null || p.page_id === pageId,
  );
}

export function useAdPlacements(position: AdPosition, pageType: AdPageType, pageId?: string | null) {
  return useQuery({
    queryKey: ["ad_placements", position, pageType, pageId ?? null],
    queryFn: () => fetchPlacements({ position, pageType, pageId }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
