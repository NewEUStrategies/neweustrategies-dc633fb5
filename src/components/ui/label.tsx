"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Wspólna geometria etykiety (`--form-label-height`) siedzi w klasach, nie w
// bezwarstwowej regule CSS: dzięki temu `cn()` pozwala wywołującemu podmienić
// `block` na `flex`/`inline-flex`, a token interlinii na `leading-none`.
const labelVariants = cva(
  "block min-h-(--form-label-height) text-sm font-medium leading-(--form-label-height) peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    data-slot="form-label"
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
