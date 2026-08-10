import { cn } from "@/lib/utils";

/** Placeholder ładowania - neutralny prostokąt w rytmie pulsu. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
