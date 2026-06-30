// Atom: the reserved box every ad slot renders into.
//
// Single responsibility: hold the slot's layout space from the very first paint
// (zero CLS) and expose a stable, labelled, accessible shell. The actual
// creative is passed as `children` and is only handed in once the deferred
// loader (`useDeferredAd`) opens its gates - so this component is agnostic to
// whether the payload is an image, raw HTML or a third-party script.

import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { reserveStyle, type AdDimensions } from "@/lib/ads/dimensions";
import type { AdPosition, AdSlotKind } from "@/lib/ads/types";

export type AdContainerState = "loading" | "blocked" | "ready";

export interface AdContainerProps {
  /** Intrinsic creative dimensions used to reserve the layout box (zero CLS). */
  dimensions: AdDimensions;
  /** Accessible label for the complementary region (already localized). */
  label: string;
  position?: AdPosition;
  kind?: AdSlotKind;
  slotId?: string;
  /** Drives styling + `data-ad-state` for the reserved / blocked / ready phases. */
  state?: AdContainerState;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export const AdContainer = forwardRef<HTMLDivElement, AdContainerProps>(function AdContainer(
  { dimensions, label, position, kind, slotId, state = "loading", className, style, children },
  ref,
) {
  const blocked = state === "blocked";
  return (
    <div
      ref={ref}
      role="complementary"
      aria-label={label}
      aria-busy={state === "loading"}
      data-ad-slot={slotId}
      data-ad-position={position}
      data-ad-kind={kind}
      data-ad-state={state}
      className={cn(
        "ad-slot mx-auto flex items-center justify-center",
        // A whisper-faint surface while space is reserved but empty; kept calm
        // so an above-the-fold slot does not read as a flashing skeleton.
        state === "loading" && "bg-muted/10",
        blocked &&
          "rounded-md border border-dashed border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground",
        className,
      )}
      style={{ ...reserveStyle(dimensions, position), ...style }}
    >
      {children}
    </div>
  );
});
