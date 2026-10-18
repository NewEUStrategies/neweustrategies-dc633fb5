import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Platform switch.
 *
 * Radix Root keeps full accessibility (role="switch", keyboard, forms). The
 * visual layer is a plain track + Radix Thumb: the previous SVG "goo" layer
 * scaled its 52x32 viewBox into the 38x22 platform box and rendered a tiny,
 * off-centre dot in the checked state. Geometry is fixed by `[data-ui-switch]`
 * (38x22, 2px padding) so the thumb (18px) travels exactly 16px.
 * Colours come from theme tokens: --to-toggle-off / --to-toggle-on (admin Theme
 * Options, fallback --input / --primary) and --to-toggle-thumb (fallback
 * --background), so light/dark and admin colour settings keep working.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    data-ui-switch=""
    className={cn(
      "ui-switch group peer relative box-border inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full outline-none",
      "bg-[var(--to-toggle-off,var(--input))] data-[state=checked]:bg-[var(--to-toggle-on,var(--primary))]",
      "transition-[background-color,box-shadow] duration-200 ease-out",
      "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      data-ui-switch-thumb=""
      className={cn(
        "pointer-events-none block h-[18px] w-[18px] rounded-full shadow-sm",
        "bg-[var(--to-toggle-thumb,var(--background))]",
        "translate-x-0 transition-transform duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)] data-[state=checked]:translate-x-4",
        "motion-reduce:transition-none",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
