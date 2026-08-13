// Molekuła: kafel benefitu (układ poziomy: ikona + tytuł + treść).
// Celowo inny niż karty zasad (JoinFeatureCard), żeby sekcja "Co oferujemy"
// czytała się jako lista konkretów, a nie druga siatka manifestów.
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function CareerBenefitTile({
  icon: Icon,
  title,
  body,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "group flex h-full gap-3.5 rounded-[6px] border border-border/70 bg-card p-4",
        "transition-[transform,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/45",
        className,
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </article>
  );
}
