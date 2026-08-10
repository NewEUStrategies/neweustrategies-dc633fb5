// Molekuła: krok ścieżki dołączenia. Numer jest treścią, nie ozdobą -
// dlatego siedzi w znaczniku, a nie w tle (czytniki ekranu też go widzą).
import { cn } from "@/lib/utils";

export function JoinStepCard({
  step,
  title,
  body,
  className,
}: {
  step: number;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "relative rounded-[6px] border border-border/70 bg-card/60 p-5 transition-colors duration-300 hover:border-primary/40",
        className,
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-sm font-bold text-primary">
        {step}
      </span>
      <h3 className="mt-3 text-base font-semibold leading-snug text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}
