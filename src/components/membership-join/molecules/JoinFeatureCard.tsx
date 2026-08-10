// Molekuła: karta korzyści / grupy odbiorców. Jedna karta obsługuje oba
// zastosowania (filary członkostwa i segmenty odbiorców), bo różnią się
// wyłącznie treścią - wygląd i zachowanie hoveru muszą być identyczne.
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function JoinFeatureCard({
  icon: Icon,
  title,
  body,
  index,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Numer porządkowy - używany tylko do opóźnienia wejścia karty. */
  index?: number;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "group relative isolate overflow-hidden rounded-[6px] border border-border/70 bg-card p-5",
        "transition-[transform,border-color,box-shadow] duration-300 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-[0_18px_40px_-28px_color-mix(in_oklab,var(--primary)_60%,transparent)]",
        className,
      )}
      style={index === undefined ? undefined : { animationDelay: `${index * 60}ms` }}
    >
      {/* Poświata zamiast cienia - zgodnie z językiem wizualnym klubów. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold leading-snug text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </article>
  );
}
