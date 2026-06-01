import { Link } from "@tanstack/react-router";
import { Pencil } from "@/lib/lucide-shim";

export function ChromeFrame({
  label, editTo, children,
}: { label: string; editTo: string; children: React.ReactNode }) {
  return (
    <div className="group relative" onClick={(e) => e.stopPropagation()}>
      <div className="pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 ring-2 ring-transparent group-hover:ring-brand/50 transition" />
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition">
        <Link to={editTo as never}
          className="inline-flex items-center gap-1.5 bg-background/95 border border-border shadow-sm rounded px-2.5 py-1 text-[11px] font-medium hover:bg-brand hover:text-brand-foreground hover:border-brand">
          <Pencil className="w-3 h-3" /> Edytuj {label.toLowerCase()}
        </Link>
      </div>
      <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition">
        <span className="inline-flex items-center bg-background/90 border border-border rounded px-2 py-0.5 text-[10px] text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
