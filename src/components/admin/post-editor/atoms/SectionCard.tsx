// Atom: framed content card with a muted, bordered header (title + optional
// icon + optional description) and a body. Shared by the Takeaways and Audio
// detail sections so their chrome stays pixel-identical.
import type { ElementType, ReactNode } from "react";

export function SectionCard({
  title,
  icon: Icon,
  description,
  bodyClassName = "p-4",
  children,
}: {
  title: ReactNode;
  icon?: ElementType;
  description?: ReactNode;
  /** Body wrapper classes (default "p-4"; pass a grid for multi-column bodies). */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <header className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold inline-flex items-center gap-2">
          {Icon ? <Icon className="w-4 h-4 text-brand" /> : null}
          {title}
        </h3>
        {description ? (
          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        ) : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
