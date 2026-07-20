// Renderer pojedynczego slotu reklamowego.
// Obsługuje 3 typy: html (raw HTML), script (np. AdSense), image (grafika + link).
//
// Core Web Vitals:
//  - CLS: <AdContainer> rezerwuje wymiary slotu od pierwszego paintu (przez
//    reserveStyle), więc kreacja ląduje w już istniejącą przestrzeń.
//  - LCP/INP: payload (obraz / HTML / <script>) montuje się dopiero gdy
//    useDeferredAd otworzy bramki (idle po pierwszym paincie + bliskość
//    viewportu) - reklama nigdy nie konkuruje z elementem LCP.
//
// Respektuje flagę requires_consent - bez zgody marketingowej slot pokazuje
// tylko placeholder (również z zarezerwowaną przestrzenią).
//
// Bezpieczeństwo: kreacje html/script NIE są montowane do DOM strony.
// Renderuje je <SandboxedAdFrame/> (iframe sandbox bez allow-same-origin),
// więc treść slotu - z definicji dowolny HTML/JS wpisany w panelu - nie ma
// dostępu do sesji czytelnika. Zamyka to stored XSS przez sloty reklamowe.

import { memo, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { beaconAdEvent } from "@/lib/analytics/events";
import { useMarketingConsent } from "@/lib/ads/consent";
import { useAdPlacements, type AdContentContext } from "@/lib/ads/queries";
import { useDeferredAd } from "@/lib/ads/useDeferredAd";
import { AdContainer } from "@/components/ads/atoms/AdContainer";
import { SandboxedAdFrame } from "@/components/ads/atoms/SandboxedAdFrame";
import type { AdPageType, AdPlacementWithSlot, AdPosition } from "@/lib/ads/types";

interface SingleProps {
  placement: AdPlacementWithSlot;
  className?: string;
}

export const AdSlotView = memo(function AdSlotView({ placement, className }: SingleProps) {
  const { t } = useTranslation();
  const { granted } = useMarketingConsent();
  const slot = placement.slot;
  const blocked = slot.requires_consent && !granted;

  const { containerRef, shouldRender } = useDeferredAd<HTMLDivElement>({ disabled: blocked });

  // Growth analytics (fire-and-forget). One impression beacon once the creative
  // actually renders - i.e. past the consent gate and the deferred-load gates,
  // so blocked/off-screen slots are never counted. A click beacon on any
  // interaction within the reserved container (image kind); sandboxed html/
  // script creatives report engagement through SandboxedAdFrame's onEngage
  // (clicks inside the isolated frame never bubble to this container).
  const impressionSent = useRef(false);
  useEffect(() => {
    if (blocked || !shouldRender || impressionSent.current) return;
    impressionSent.current = true;
    beaconAdEvent("impression", slot.id, placement.id);
  }, [blocked, shouldRender, slot.id, placement.id]);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || blocked) return;
    const onClick = () => beaconAdEvent("click", slot.id, placement.id);
    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [blocked, shouldRender, slot.id, placement.id]);

  const dimensions = { width: slot.width, height: slot.height };
  const label = t("ads.label", { defaultValue: "Reklama" });

  if (blocked) {
    return (
      <AdContainer
        ref={containerRef}
        dimensions={dimensions}
        position={placement.position}
        kind={slot.kind}
        slotId={slot.id}
        state="blocked"
        label={label}
        className={className}
      >
        {t("ads.consentBlocked", {
          defaultValue: "Treść reklamowa zablokowana - wymaga zgody marketingowej.",
        })}
      </AdContainer>
    );
  }

  let payload: ReactNode = null;
  if (shouldRender) {
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
      payload = slot.image_link ? (
        <a href={slot.image_link} target="_blank" rel="sponsored noopener noreferrer">
          {img}
        </a>
      ) : (
        img
      );
    } else if (slot.kind === "html" && slot.html) {
      payload = (
        <SandboxedAdFrame
          markup={slot.html}
          title={`${label}: ${slot.name}`}
          onEngage={() => beaconAdEvent("click", slot.id, placement.id)}
        />
      );
    } else if (slot.kind === "script" && slot.script) {
      // Wewnątrz sandboxu <script> wykonuje się natywnie - ręczne re-tworzenie
      // elementów skryptu (dawny wariant z innerHTML) nie jest już potrzebne.
      payload = (
        <SandboxedAdFrame
          markup={slot.script}
          title={`${label}: ${slot.name}`}
          onEngage={() => beaconAdEvent("click", slot.id, placement.id)}
        />
      );
    }
  }

  return (
    <AdContainer
      ref={containerRef}
      dimensions={dimensions}
      position={placement.position}
      kind={slot.kind}
      slotId={slot.id}
      state={shouldRender ? "ready" : "loading"}
      label={label}
      className={className}
    >
      {payload}
    </AdContainer>
  );
});

interface ZoneProps {
  position: AdPosition;
  pageType: AdPageType;
  pageId?: string | null;
  className?: string;
  /** Jeśli podane, renderujemy maksymalnie N placementów dla tej pozycji. */
  limit?: number;
  /**
   * Kontekst treści dla targetingu slotów (slugi kategorii/tagów bieżącego
   * posta). Bez niego sloty z targetingiem treściowym nie są emitowane;
   * targeting językowy działa zawsze (język z i18n).
   */
  content?: AdContentContext;
}

/** Wrapper renderujący wszystkie aktywne placementy dla danej pozycji. */
export function AdZone({ position, pageType, pageId, className, limit, content }: ZoneProps) {
  const { data } = useAdPlacements(position, pageType, pageId, content);
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
