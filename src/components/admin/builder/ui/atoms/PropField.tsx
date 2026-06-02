// Atom: labeled wrapper for a single property control.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface Props {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
  inline?: boolean;
}

export function PropField({ label, hint, children, inline }: Props) {
  return (
    <div className={inline ? "flex items-center justify-between gap-2" : "space-y-1"}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className={inline ? "" : ""}>{children}</div>
      {hint && <p className="text-[9px] leading-snug text-muted-foreground/60">{hint}</p>}
    </div>
  );
}
