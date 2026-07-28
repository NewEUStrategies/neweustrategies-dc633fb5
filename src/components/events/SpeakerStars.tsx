// Rzad gwiazdek oceny prelegenta (0-5, zaokraglane do pelnych gwiazdek).
// Kolor pochodzi z akcentu widgetu (--speakers-accent) z fallbackiem --brand.
import { Star } from "@/lib/lucide-shim";

export function SpeakerStars({ rating }: { rating: number }) {
  const rounded = Math.round(Math.min(5, Math.max(0, rating)));
  return (
    <span aria-hidden className="inline-flex items-center gap-[1px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          className={
            "h-3 w-3 " +
            (i < rounded
              ? "fill-[color:var(--speakers-accent,var(--brand))] text-[color:var(--speakers-accent,var(--brand))]"
              : "text-muted-foreground/40")
          }
        />
      ))}
    </span>
  );
}
