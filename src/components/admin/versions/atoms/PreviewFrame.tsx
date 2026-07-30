// Atom: ramka podglądu - izoluje treść wersji od układu panelu i pozwala
// przewijać długie dokumenty bez rozpychania strony.
import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function PreviewFrame({
  children,
  height = 620,
  label,
}: {
  children: ReactNode;
  height?: number;
  label?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      {label ? (
        <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      ) : null}
      <ScrollArea style={{ height }}>
        <div className="p-1">{children}</div>
      </ScrollArea>
    </div>
  );
}
