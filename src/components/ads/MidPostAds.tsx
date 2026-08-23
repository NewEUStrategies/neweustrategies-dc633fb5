// Wstrzykuje reklamy typu `mid_post` w środek treści wpisu -
// po N-tym paragrafie zgodnie z konfiguracją placement.config.paragraph.
// Renderuje React do dynamicznie utworzonych kontenerów wewnątrz articleRef
// (poprzez createPortal) - bez modyfikowania samego HTML treści.
//
// Logika WYBORU (kolejność, sufit `MAX_MID_POST_ADS`, przycinanie numeru
// paragrafu) mieszka w `@/lib/ads/injection` - tutaj zostaje wyłącznie praca
// na DOM. Ekstrakcja nie zmieniła zachowania: ciała funkcji przeniesiono
// znak w znak razem z ich wadami.
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAdPlacements, type AdContentContext } from "@/lib/ads/queries";
import { sortAndCapMidPost, targetParagraphIndex } from "@/lib/ads/injection";
import { AdSlotView } from "@/components/AdSlot";
import type { AdPageType, AdPlacementWithSlot } from "@/lib/ads/types";

interface Props {
  articleRef: RefObject<HTMLDivElement | null>;
  pageType: AdPageType;
  pageId: string;
  /** Klucz przebudowy gdy treść / język się zmienia. */
  scanKey?: string | number;
  /** Kontekst treści dla targetingu slotów (slugi kategorii/tagów posta). */
  content?: AdContentContext;
}

interface Mount {
  el: HTMLDivElement;
  placement: AdPlacementWithSlot;
}

const HOST_ATTR = "data-ad-mid-host";

export function MidPostAds({ articleRef, pageType, pageId, scanKey, content }: Props) {
  const { data } = useAdPlacements("mid_post", pageType, pageId, content);
  const [mounts, setMounts] = useState<Mount[]>([]);

  const sorted = useMemo(() => sortAndCapMidPost(data), [data]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root || sorted.length === 0) {
      setMounts([]);
      return;
    }

    // Sprzątanie poprzednich hostów (gdyby były).
    root.querySelectorAll(`[${HOST_ATTR}]`).forEach((n) => n.remove());

    const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>("p")).filter(
      (p) => p.closest(`[${HOST_ATTR}]`) === null,
    );

    const next: Mount[] = [];
    sorted.forEach((placement) => {
      const target = paragraphs[targetParagraphIndex(placement.config, paragraphs.length)];
      if (!target || !target.parentNode) return;
      const host = document.createElement("div");
      host.setAttribute(HOST_ATTR, placement.id);
      host.className = "my-8";
      target.parentNode.insertBefore(host, target.nextSibling);
      next.push({ el: host, placement });
    });
    setMounts(next);

    return () => {
      next.forEach((m) => m.el.remove());
    };
  }, [articleRef, sorted, scanKey]);

  if (mounts.length === 0) return null;

  return <>{mounts.map((m) => createPortal(<AdSlotView placement={m.placement} />, m.el))}</>;
}
