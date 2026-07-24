"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/**
 * Radix requires a Provider above every tooltip root and THROWS when it is
 * missing ("`Tooltip` must be used within `TooltipProvider`"). One unwrapped
 * tooltip therefore escalates into a full-page crash through the global error
 * boundary - exactly what a chat reaction chip did on the message preview.
 *
 * So the primitive heals itself: provider presence lives in our own context and
 * `Tooltip` mounts a scoped provider when nobody above it did. An explicit
 * `TooltipProvider` still wins and keeps its shared hover-delay grouping
 * (`skipDelayDuration`), so composed surfaces behave exactly as before.
 */
const TooltipProviderPresence = React.createContext(false);

type TooltipProviderProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>;

const TooltipProvider = ({ children, ...props }: TooltipProviderProps) => (
  <TooltipProviderPresence.Provider value={true}>
    <TooltipPrimitive.Provider {...props}>{children}</TooltipPrimitive.Provider>
  </TooltipProviderPresence.Provider>
);
TooltipProvider.displayName = TooltipPrimitive.Provider.displayName;

type TooltipProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

const Tooltip = ({ children, ...props }: TooltipProps) => {
  const hasProvider = React.useContext(TooltipProviderPresence);
  const root = <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>;
  if (hasProvider) return root;
  // Standalone fallback: scoped to this tooltip only, honouring its own delay.
  return <TooltipProvider delayDuration={props.delayDuration}>{root}</TooltipProvider>;
};
Tooltip.displayName = TooltipPrimitive.Root.displayName;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-[260px] overflow-hidden rounded-md border border-border bg-popover px-3 py-2 text-[11px] leading-snug text-popover-foreground shadow-sm animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-tooltip-content-transform-origin)",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
