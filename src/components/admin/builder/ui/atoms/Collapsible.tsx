// Atom: collapsible section box used in property panels.
// Two variants - "details" (native, open by default) for SectionProperties and
// "button" (controlled, closed by default) for WidgetProperties.
import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleDetails({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details
      className="group border border-border rounded-md bg-muted/20 open:bg-card transition"
      open
    >
      <summary className="cursor-pointer list-none flex items-center justify-between text-xs font-medium px-3 py-2 select-none">
        <span>{title}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 py-3 space-y-3 border-t border-border">{children}</div>
    </details>
  );
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`border border-border rounded-md overflow-hidden transition-colors ${
        open ? "bg-card" : "bg-muted/20"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-2.5 h-8 text-[10.5px] font-semibold uppercase tracking-wider transition-colors ${
          open
            ? "text-foreground bg-muted/40 hover:bg-muted/60"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
        }`}
      >
        <span className="truncate text-left">{title}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-2 space-y-2 border-t border-border">{children}</div>
      )}
    </div>
  );
}
