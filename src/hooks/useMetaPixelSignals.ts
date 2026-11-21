// Hooki stron dla piksela Meta: odsłona treści i zakończona płatność.
// Cała bramka zgody i kolejka startowa siedzą w `trackMetaEvent`.
import { useEffect, useRef } from "react";
import { afterPrerendering } from "@/lib/prerender";
import { trackMetaEvent } from "@/lib/analytics/metaPixelEvents";
import { consumeMetaCheckout, type MetaCheckoutKind } from "@/lib/analytics/metaCheckoutMarker";
import { trackAdsPurchase } from "@/lib/analytics/adsPurchase";

/**
 * ViewContent raz na wyświetloną treść (artykuł, wydarzenie). Strona
 * prerenderowana spekulacyjnie liczy się dopiero po aktywacji.
 */
export function useMetaViewContent(contentId: string | null | undefined, category: string): void {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!contentId || sent.current === contentId) return;
    return afterPrerendering(() => {
      if (sent.current === contentId) return;
      sent.current = contentId;
      trackMetaEvent("ViewContent", { content_ids: [contentId], content_category: category });
    });
  }, [contentId, category]);
}

/**
 * Strona powrotu z płatności: zużywa znacznik kasy i wysyła Purchase,
 * Subscribe albo Donate z identyfikatorem zapisanym w kasie (ten sam
 * `eventID` przy ewentualnej przyszłej wysyłce serwerowej).
 */
export function useMetaCheckoutCompletion(kind: MetaCheckoutKind, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const marker = consumeMetaCheckout(kind);
    if (!marker) return;
    trackMetaEvent(
      marker.event,
      {
        value: marker.value,
        currency: marker.currency,
        content_ids: [marker.contentId],
        content_category: marker.category,
        content_type: "product",
        num_items: 1,
        ...(marker.predictedLtv !== undefined ? { predicted_ltv: marker.predictedLtv } : {}),
      },
      marker.eventId,
    );
    // Google Ads: ten sam potwierdzony zakup (bez okresu próbnego bez opłaty).
    if (marker.event !== "StartTrial") {
      trackAdsPurchase({
        transactionId: marker.eventId,
        value: marker.value,
        currency: marker.currency,
      });
    }
  }, [kind, enabled]);
}
