import { useId, type ReactNode } from "react";

export function IllustrationSection({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-border bg-card/50 p-5"
    >
      <header className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        <div className="text-xs text-muted-foreground">{description}</div>
      </header>
      {children}
    </section>
  );
}
