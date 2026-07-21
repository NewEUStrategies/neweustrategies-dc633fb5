import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";

import { cn } from "@/lib/utils";

/**
 * Animated SVG checkbox used across the whole platform.
 *
 * The visual is driven by CSS in src/styles.css (.lov-check class):
 *  - default: rounded square outline in muted stroke
 *  - hover: soft ring + primary stroke
 *  - checked: animated path/polyline draw using primary color
 *
 * The Radix Root remains fully interactive/accessible; we hide its native
 * chrome and render our own SVG. Works in dark + light through design tokens.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "lov-check group relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center bg-transparent p-0 outline-none",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-[4px]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
      className="lov-check__svg"
    >
      <path d="M1,9 L1,3.5 C1,2 2,1 3.5,1 L14.5,1 C16,1 17,2 17,3.5 L17,14.5 C17,16 16,17 14.5,17 L3.5,17 C2,17 1,16 1,14.5 L1,9 Z" />
      <polyline points="1,9 7,14 15,4" />
      <line x1="4.5" y1="9" x2="13.5" y2="9" className="lov-check__dash" />
    </svg>

    {/* Radix Indicator kept for a11y semantics; visuals live on the SVG above. */}
    <CheckboxPrimitive.Indicator className="sr-only">✓</CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
