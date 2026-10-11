import type { ReactNode } from "react";

/** Shared unframed event heading geometry. */
export function EventSectionHeading({ icon, eyebrow, children }: { icon: ReactNode; eyebrow?: ReactNode; children: ReactNode }) {
  return <div className="flex flex-col items-center px-4 pb-6 pt-4 text-center sm:px-6">
    <span className="mb-3 grid size-8 shrink-0 place-items-center">{icon}</span>
    {eyebrow ? <p className="mb-2 max-w-full text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">{eyebrow}</p> : null}
    {children}
  </div>;
}
