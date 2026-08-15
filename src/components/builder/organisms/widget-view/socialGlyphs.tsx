// Jedno źródło wyglądu ikony „koperty" (newsletter) dla WSZYSTKICH miejsc:
// widget „Ikony social" (układ rząd i lista) oraz samodzielny widget
// „Newsletter" w wariantach ikonowych - w nagłówku, stopce i na stronach.
// Wcześniej każdy renderował własną kopertę (inny rysunek, inna grubość linii,
// inny kafelek), przez co w headerze stały obok siebie dwie różne ikony.
import type { CSSProperties } from "react";

/** Wspólny rysunek koperty (ta sama geometria co ikony platform). */
export function SocialMailIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

/** Kafelek ikony: kwadrat `size + 6` px, tak jak w widgecie ikon social. */
export function socialGlyphBoxStyle(size: number): CSSProperties {
  const box = size + 6;
  return {
    width: box,
    height: box,
    minWidth: box,
    minHeight: box,
    lineHeight: 0,
    boxSizing: "border-box",
  };
}

/** Klasy kafelka wspólne dla ikon social i newslettera. */
export const SOCIAL_GLYPH_TILE_CLASS =
  "inline-flex items-center justify-center rounded-md shrink-0 text-foreground transition-colors hover:bg-muted/40";
