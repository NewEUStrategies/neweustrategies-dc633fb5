// Client-side growth-analytics beacons for ad + popup events. Fire-and-forget
// over navigator.sendBeacon (reuses the observability transport); never throws,
// never blocks the page. Ingested by /api/public/ad-event and
// /api/public/popup-event (both return 204, mirroring the vitals beacon).
import { sendBeaconPayload } from "@/lib/observability/report";

export function beaconAdEvent(
  kind: "impression" | "click",
  slotId: string,
  placementId?: string | null,
): void {
  if (typeof location === "undefined") return;
  sendBeaconPayload("/api/public/ad-event", {
    kind,
    slot_id: slotId,
    placement_id: placementId ?? null,
    path: location.pathname,
  });
}

export function beaconPopupEvent(kind: "view" | "conversion", popupId: string): void {
  sendBeaconPayload("/api/public/popup-event", { kind, popup_id: popupId });
}
