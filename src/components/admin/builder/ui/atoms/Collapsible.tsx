// Atom: collapsible section box used in property panels.
// Two variants - "details" (native, open by default) for SectionProperties and
// "button" (controlled, closed by default) for WidgetProperties.
import { useState } from "react";

export function CollapsibleDetails({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border border-border rounded bg-muted/20 open:bg-card transition" open>
      <summary className="cursor-pointer text-xs font-medium px-3 py-2 select-none">{title}</summary>
      <div className="px-3 py-3 space-y-3 border-t border-border">{children}</div>
    </details>
  );
}

export function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-md bg-background">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <span>{title}</span>
        <span className="text-xs">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-2 pb-2 pt-1 space-y-2">{children}</div>}
    </div>
  );
}
