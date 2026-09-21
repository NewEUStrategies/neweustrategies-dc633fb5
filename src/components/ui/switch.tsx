import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * Liquid (gooey) switch.
 *
 * Radix Root keeps full accessibility (role="switch", keyboard, forms) while
 * the visual layer is an SVG pair of circles blended with a goo filter,
 * reproducing the liquid toggle behaviour. Colours come from theme tokens:
 * track uses --to-toggle-off / --to-toggle-on (admin Theme Options, fallback
 * --input / --primary) and the thumb uses --to-toggle-thumb (fallback white),
 * so dark/light mode and admin colour settings keep working.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => {
  const filterId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");

  return (
    <SwitchPrimitives.Root
      data-ui-switch=""
      className={cn(
        "ui-switch group peer relative box-border inline-flex h-6 w-10 shrink-0 cursor-pointer items-center overflow-hidden rounded-full outline-none",
        "transition-[background-color,box-shadow,filter] duration-500 ease-out hover:brightness-[1.04]",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "[transform:translateZ(0)] [backface-visibility:hidden]",
        className,
      )}
      {...props}
      ref={ref}
    >
      <svg
        viewBox="0 0 52 32"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ fill: "var(--to-toggle-thumb, #ffffff)" }}
        filter={`url(#${filterId})`}
      >
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
        {/* Unchecked thumb (left) - slides right and shrinks away when checked */}
        <circle
          cx="16"
          cy="16"
          r="10"
          className={cn(
            "transition-transform duration-500 ease-[cubic-bezier(0.34,1.2,0.64,1)] motion-reduce:transition-none",
            "[transform:translate3d(0,0,0)] [backface-visibility:hidden]",
            "group-data-[state=checked]:[transform:translateX(12px)_scale(0)]",
          )}
          style={{ transformOrigin: "16px 16px" }}
        />
        {/* Checked thumb (right) - slides in from the left when checked */}
        <circle
          cx="36"
          cy="16"
          r="10"
          className={cn(
            "transition-transform duration-500 ease-[cubic-bezier(0.34,1.2,0.64,1)] motion-reduce:transition-none",
            "[transform:translate3d(-12px,0,0)_scale(0)] [backface-visibility:hidden]",
            "group-data-[state=checked]:[transform:translate3d(0,0,0)_scale(1)]",
          )}
          style={{ transformOrigin: "36px 16px" }}
        />
        {/* Droplet that falls into the thumb while switching on */}
        <circle
          cx="35"
          cy="-1"
          r="2.5"
          className={cn(
            "transition-[transform,opacity] duration-700 ease-out motion-reduce:transition-none",
            "opacity-0 [transform:translate3d(0,-6px,0)_scale(0)]",
            "group-data-[state=checked]:opacity-100 group-data-[state=checked]:[transform:translate3d(0,10px,0)_scale(1)]",
          )}
          style={{ transformOrigin: "35px 9px" }}
        />
      </svg>
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
