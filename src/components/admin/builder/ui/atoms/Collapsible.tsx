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
      className={`border rounded-md overflow-hidden transition-all ${
        open ? "border-border bg-card shadow-sm" : "border-border/80 bg-card"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-2.5 h-9 text-[10.5px] font-semibold uppercase tracking-normal transition-colors ${
          open
            ? "text-brand bg-brand/5 hover:bg-brand/10"
            : "text-foreground hover:text-brand hover:bg-muted/40"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate text-left before:h-1.5 before:w-1.5 before:shrink-0 before:rounded-full before:bg-current before:opacity-60">{title}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-2.5 space-y-2.5 border-t border-border bg-background/60">{children}</div>
      )}
    </div>
  );
}
