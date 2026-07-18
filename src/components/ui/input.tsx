import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Unified platform input.
 *
 * Consumes the semantic `.input` class defined in `src/styles.css` so its
 * border, radius, ring, hover, focus, invalid and disabled states are
 * byte-for-byte identical to `<FloatingInput/>` (which uses the same tokens
 * inside `.input-group > .input`). This guarantees dark/light parity across
 * the whole platform - public site, admin, popups - without per-instance
 * Tailwind soup.
 *
 * Callers can still pass `className` to add layout/spacing utilities;
 * behavioural styles (border/ring/etc.) always come from `.input`.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn("input pointer-coarse:min-h-11", className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
