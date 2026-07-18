import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Unified platform textarea. Shares the `.input` visual/behavior tokens with
 * `<Input/>` and `<FloatingInput/>` so focus rings, borders and dark/light
 * parity are identical everywhere in the app.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn("input", className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
