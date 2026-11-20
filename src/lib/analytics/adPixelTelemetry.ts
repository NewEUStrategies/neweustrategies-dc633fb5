// Klienckie lustro pikseli reklamowych - patrz `adPixels.ts`. Zero sieci poza
// `track()`; bez zgody marketingowej nic nie jest zapisywane.
import { hasCategoryConsent } from "@/lib/ads/consent";
import { track } from "./track";
import {
  AD_PIXEL_CONVERSION_EVENT,
  AD_PIXEL_VISIT_EVENT,
  encodePlatforms,
  type AdPlatform,
} from "./adPixels";

let active: AdPlatform[] = [];

/** Ustawia platformy, których skrypty właśnie ruszyły po zgodzie marketingowej. */
export function setActiveAdPlatforms(platforms: readonly AdPlatform[]): void {
  active = [...new Set(platforms)];
}

export function activeAdPlatforms(): readonly AdPlatform[] {
  return active;
}

/** Wizyta po zgodzie - raz na załadowanie pikseli. */
export function recordAdPixelVisit(): void {
  if (active.length === 0 || !hasCategoryConsent("marketing")) return;
  track({ type: "interaction", name: AD_PIXEL_VISIT_EVENT, meta: { platforms: encodePlatforms(active) } });
}

/** Konwersja przypisana do aktywnych pikseli (np. `form_submit`, `registration`). */
export function recordAdPixelConversion(kind: string): void {
  if (active.length === 0 || !hasCategoryConsent("marketing")) return;
  track({
    type: "interaction",
    name: AD_PIXEL_CONVERSION_EVENT,
    meta: { platforms: encodePlatforms(active), conversion: kind.slice(0, 60) },
  });
}
