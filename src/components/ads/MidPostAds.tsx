// Wstrzykuje reklamy typu `mid_post` w środek treści wpisu -
// po N-tym paragrafie zgodnie z konfiguracją placement.config.paragraph.
// Renderuje React do dynamicznie utworzonych kontenerów wewnątrz articleRef
// (poprzez createPortal) - bez modyfikowania samego HTML treści.
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAdPlacements } from "@/lib/ads/queries";
import { AdSlotView } from "@/components/AdSlot";
import type { AdPageType, AdPlacementWithSlot } from "@/lib/ads/types";

interface Props {
  articleRef: RefObject<HTMLDivElement | null>;
  pageType: AdPageType;
  pageId: string;
  /** Klucz przebudowy gdy treść / język się zmienia. */
  scanKey?: string | number;
}

interface Mount {
  el: HTMLDivElement;
  placement: AdPlacementWithSlot;
}

const HOST_ATTR = "data-ad-mid-host";

export function MidPostAds({ articleRef, pageType, pageId, scanKey }: Props) {
  const { data } = useAdPlacements("mid_post", pageType, pageId);
  const [mounts, setMounts] = useState<Mount[]>([]);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      const ap = Number((a.config as { paragraph?: number }).paragraph ?? 4);
      const bp = Number((b.config as { paragraph?: number }).paragraph ?? 4);
      return ap - bp;
    });
  }, [data]);

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
      const after = Math.max(
        1,
        Number((placement.config as { paragraph?: number }).paragraph ?? 4),
      );
      const target = paragraphs[Math.min(after - 1, paragraphs.length - 1)];
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
