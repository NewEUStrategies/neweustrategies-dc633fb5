// Atom: collapsible card section used across the editor sidebar/document panes.
// A titled, optionally-iconed header toggles a body open/closed. Purely
// presentational - callers own the content.
import { useState } from "react";
import type { ElementType, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function SidebarSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: ElementType;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 p-4 text-left hover:bg-muted/30 transition-colors"
      >
        <h3 className="text-sm font-semibold inline-flex items-center gap-2">
          {Icon ? <Icon className="w-4 h-4" /> : null} {title}
        </h3>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}
