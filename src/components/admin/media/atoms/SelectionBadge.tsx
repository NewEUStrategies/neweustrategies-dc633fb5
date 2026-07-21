import { Check } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

interface SelectionBadgeProps {
  className?: string;
}

/** Atom: the round check badge overlaid on a selected grid tile. */
export function SelectionBadge({ className }: SelectionBadgeProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1 left-1 w-4 h-4 rounded-full bg-brand text-primary-foreground flex items-center justify-center",
        className,
      )}
    >
      <Check className="w-3 h-3" />
    </span>
  );
}
