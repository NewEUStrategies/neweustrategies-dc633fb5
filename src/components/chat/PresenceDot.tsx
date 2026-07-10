// Atom: presence indicator (green = online), Messenger-style ring.
import { cn } from "@/lib/utils";

export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  if (!online) return null;
  return (
    <span
      className={cn(
        "block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background",
        className,
      )}
      aria-hidden
    />
  );
}
