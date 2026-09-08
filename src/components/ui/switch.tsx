import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    data-ui-switch=""
    className={cn(
      "ui-switch group peer relative box-border inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center overflow-hidden rounded-full border border-border/60 px-[3px] outline-none",
      "bg-muted transition-[background-color,border-color,box-shadow] duration-300 ease-out",
      "data-[state=checked]:border-primary/70 data-[state=checked]:bg-primary",
      "hover:brightness-[1.03] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none box-border block h-[14px] w-[14px] rounded-full bg-white shadow-sm ring-0",
        "transition-transform duration-200 ease-out",
        "data-[state=checked]:translate-x-[16px] data-[state=unchecked]:translate-x-0",
      )}
    />

  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
