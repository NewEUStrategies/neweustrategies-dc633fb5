// Atom: responsive control grid used inside every editor section.
// 1 column on mobile, 3 columns from `md` up - matches the admin layout grid.
import type { ReactNode } from "react";

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{children}</div>;
}
