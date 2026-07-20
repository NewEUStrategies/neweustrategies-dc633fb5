// Wstawki reklamowe "co N kart" współdzielone przez wszystkie listy wpisów:
// blog, stronę główną w trybie najnowszych wpisów, archiwa taksonomii
// i wyniki wyszukiwania. Konfigurację częstotliwości niesie placement
// (ad_placements.config.every); renderer zwraca elementy do wstawienia
// PO karcie o danym indeksie (0-based), więc lista wywołuje go w pętli map.
import type { ReactNode } from "react";
import { AdSlotView } from "@/components/AdSlot";
import { useAdPlacements } from "@/lib/ads/queries";
import type { AdPageType, AdPlacementWithSlot } from "@/lib/ads/types";

export type InFeedRenderer = (cardIndex: number) => ReactNode;

function placementsAfterCard(
  placements: readonly AdPlacementWithSlot[],
  cardIndex: number,
): AdPlacementWithSlot[] {
  return placements.filter((p) => {
    const every = Math.max(1, Number((p.config as { every?: number }).every ?? 5));
    return (cardIndex + 1) % every === 0;
  });
}

/**
 * Zwraca renderer wstawek in-feed dla danego typu strony. Wynik renderera to
 * gotowe <AdSlotView/> (bez wrappera) - kontener/klasy siatki dobiera lista,
 * bo layout kart różni się między siatką, listą i masonry.
 */
export function useInFeedAds(pageType: AdPageType, pageId?: string | null): InFeedRenderer {
  const { data } = useAdPlacements("in_feed", pageType, pageId);
  const placements = data ?? [];
  return (cardIndex: number) => {
    const hits = placementsAfterCard(placements, cardIndex);
    if (hits.length === 0) return null;
    return (
      <>
        {hits.map((p) => (
          <AdSlotView key={`${p.id}:${cardIndex}`} placement={p} />
        ))}
      </>
    );
  };
}
