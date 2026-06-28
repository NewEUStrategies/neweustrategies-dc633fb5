import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FieldLabelProps {
  htmlFor?: string;
  children: React.ReactNode;
  tip?: string | null;
  hint?: string | null;
  className?: string;
}

/**
 * Atomic form-label with an inline i18n tooltip and an optional inline hint
 * (e.g. "(nick konta)"). Tooltip-trigger uses a button so it's keyboard-
 * accessible and screen-readable.
 */
export function FieldLabel({ htmlFor, children, tip, hint, className }: FieldLabelProps) {
  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      <Label htmlFor={htmlFor} className="m-0">
        {children}
      </Label>
      {hint ? (
        <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {tip ? (
        <Tooltip delayDuration={150}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={typeof tip === "string" ? tip : "Info"}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-balance">
            {tip}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export default FieldLabel;
