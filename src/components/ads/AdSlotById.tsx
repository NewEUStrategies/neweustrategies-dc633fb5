// Komponent pomocniczy: ładuje pojedynczy slot reklamowy po ID i renderuje go
// poprzez AdSlotView wraz z syntetycznym placementem (brak konfiguracji per-pozycja).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdSlotView } from "@/components/AdSlot";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

interface Props {
  slotId: string;
  className?: string;
}

export function AdSlotById({ slotId, className }: Props) {
  const { data } = useQuery({
    queryKey: ["ad_slot", slotId],
    enabled: !!slotId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AdSlot | null> => {
      const { data, error } = await supabase
        .from("ad_slots")
        .select("*")
        .eq("id", slotId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return (data as AdSlot | null) ?? null;
    },
  });

  if (!slotId) {
    return (
      <div
        className={`text-xs text-muted-foreground p-3 border border-dashed border-border rounded-md text-center ${className ?? ""}`}
      >
        Wybierz slot reklamowy w ustawieniach widgetu.
      </div>
    );
  }
  if (!data) return null;

  const placement: AdPlacementWithSlot = {
    id: `inline-${data.id}`,
    tenant_id: data.tenant_id,
    slot_id: data.id,
    position: "top_of_post",
    page_type: "all",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: data.created_at,
    updated_at: data.updated_at,
    slot: data,
  };
  return <AdSlotView placement={placement} className={className} />;
}
