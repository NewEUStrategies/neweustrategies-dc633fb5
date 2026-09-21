// Atom: wspólny pusty stan paneli doku.
import type { ReactNode } from "react";

export function DockEmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
