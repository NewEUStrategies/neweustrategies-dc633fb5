// Wstawki reklamowe "co N kart" współdzielone przez wszystkie listy wpisów:
// blog, stronę główną w trybie najnowszych wpisów, archiwa taksonomii
// i wyniki wyszukiwania. Konfigurację częstotliwości niesie placement
// (ad_placements.config.every); renderer zwraca elementy do wstawienia
// PO karcie o danym indeksie (0-based), więc lista wywołuje go w pętli map.
//
// Decyzja "czy przy tej karcie leci reklama" mieszka w
// `@/lib/ads/injection#placementsAfterCard` - przeniesiona znak w znak,
// żeby dała się przetestować bez montowania listy wpisów.
import type { ReactNode } from "react";
import { AdSlotView } from "@/components/AdSlot";
import { placementsAfterCard } from "@/lib/ads/injection";
import { useAdPlacements } from "@/lib/ads/queries";
import type { AdPageType } from "@/lib/ads/types";

export type InFeedRenderer = (cardIndex: number) => ReactNode;

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
