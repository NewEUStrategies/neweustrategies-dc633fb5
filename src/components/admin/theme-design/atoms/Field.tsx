// Atom: labeled wrapper for a single control inside a FieldGrid cell.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
