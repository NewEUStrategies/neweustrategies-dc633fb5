// Renderer pojedynczego slotu reklamowego.
// Obsługuje 3 typy: html (raw HTML), script (np. AdSense), image (grafika + link).
// Respektuje flagę requires_consent - bez zgody marketingowej slot nie ładuje się.

import { memo, useEffect, useRef } from "react";
import { useMarketingConsent } from "@/lib/ads/consent";
import type { AdPlacementWithSlot } from "@/lib/ads/types";
import { useAdPlacements } from "@/lib/ads/queries";
import type { AdPageType, AdPosition } from "@/lib/ads/types";

interface SingleProps {
  placement: AdPlacementWithSlot;
  className?: string;
}

export const AdSlotView = memo(function AdSlotView({ placement, className }: SingleProps) {
  const { granted } = useMarketingConsent();
  const slot = placement.slot;
  const scriptHostRef = useRef<HTMLDivElement | null>(null);

  // Lazy-execute skryptu (np. <script src="..."> z AdSense). innerHTML nie wykona <script>,
  // więc parsujemy i re-tworzymy elementy.
  useEffect(() => {
    if (slot.kind !== "script" || !scriptHostRef.current || !slot.script) return;
    if (slot.requires_consent && !granted) return;
    const host = scriptHostRef.current;
    host.innerHTML = "";
    const tpl = document.createElement("template");
    tpl.innerHTML = slot.script.trim();
    Array.from(tpl.content.childNodes).forEach((node) => {
      if (node.nodeName === "SCRIPT") {
        const orig = node as HTMLScriptElement;
        const s = document.createElement("script");
        Array.from(orig.attributes).forEach((a) => s.setAttribute(a.name, a.value));
        s.text = orig.text;
        host.appendChild(s);
      } else {
        host.appendChild(node.cloneNode(true));
      }
    });
  }, [slot, granted]);

  if (slot.requires_consent && !granted) {
    return (
      <div
        className={`text-center text-xs text-muted-foreground p-3 border border-dashed border-border rounded-md bg-muted/30 ${className ?? ""}`}
        role="complementary"
        aria-label="Miejsce reklamowe"
      >
        Treść reklamowa zablokowana - wymaga zgody marketingowej.
      </div>
    );
  }

  const wrapStyle: React.CSSProperties = {
    width: slot.width ?? undefined,
    height: slot.height ?? undefined,
  };

  if (slot.kind === "image" && slot.image_url) {
    const img = (
      <img
        src={slot.image_url}
        alt={slot.image_alt ?? slot.name}
        width={slot.width ?? undefined}
        height={slot.height ?? undefined}
        loading="lazy"
        decoding="async"
        style={{ maxWidth: "100%", height: "auto" }}
      />
    );
    return (
      <div className={`ad-slot ad-slot--image mx-auto ${className ?? ""}`} style={wrapStyle} data-ad-slot={slot.id}>
        {slot.image_link ? (
          <a href={slot.image_link} target="_blank" rel="sponsored noopener noreferrer">
            {img}
          </a>
        ) : (
          img
        )}
      </div>
    );
  }

  if (slot.kind === "html" && slot.html) {
    return (
      <div
        className={`ad-slot ad-slot--html mx-auto ${className ?? ""}`}
        style={wrapStyle}
        data-ad-slot={slot.id}
        dangerouslySetInnerHTML={{ __html: slot.html }}
      />
    );
  }

  if (slot.kind === "script") {
    return (
      <div
        className={`ad-slot ad-slot--script mx-auto ${className ?? ""}`}
        style={wrapStyle}
        data-ad-slot={slot.id}
        ref={scriptHostRef}
      />
    );
  }

  return null;
});

interface ZoneProps {
  position: AdPosition;
  pageType: AdPageType;
  pageId?: string | null;
  className?: string;
  /** Jeśli podane, renderujemy maksymalnie N placementów dla tej pozycji. */
  limit?: number;
}

/** Wrapper renderujący wszystkie aktywne placementy dla danej pozycji. */
export function AdZone({ position, pageType, pageId, className, limit }: ZoneProps) {
  const { data } = useAdPlacements(position, pageType, pageId);
  if (!data || data.length === 0) return null;
  const list = typeof limit === "number" ? data.slice(0, limit) : data;
  return (
    <>
      {list.map((p) => (
        <AdSlotView key={p.id} placement={p} className={className} />
      ))}
    </>
  );
}
