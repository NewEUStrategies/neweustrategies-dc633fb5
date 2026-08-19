// Atom: sekcja panelu z nagłówkiem, ikoną i opisem.
//
// Kontrakt dostępności: `<section>` z `<h2>` w nagłówku - cztery sekcje panelu
// tworzą wtedy spis treści, po którym czytnik skacze. `padded={false}` zdejmuje
// wyłącznie wewnętrzny odstęp (siatka kart warstw ma własny), nigdy strukturę.
import type { ComponentType, ReactNode } from "react";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  padded = true,
}: {
  icon: IconType;
  title: string;
  description?: string;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border/60 bg-muted/20 px-5 py-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[6px] border border-border/60 bg-background text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </header>
      <div className={padded ? "space-y-5 p-5" : ""}>{children}</div>
    </section>
  );
}
