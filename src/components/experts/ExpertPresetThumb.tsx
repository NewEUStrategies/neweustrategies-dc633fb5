// Piktogram presetu strony eksperta - schemat blokowy hero, żeby wybierający
// (admin w /admin/expert-layouts i ekspert w inline-edytorze na /author/$slug)
// widział strukturę wariantu bez ładowania podglądu. Bez ikon zewnętrznych,
// wyłącznie div-y na tokenach motywu - identyczny w light i dark.
import type { ExpertLayoutPresetId } from "@/lib/expertLayouts";

export function ExpertPresetThumb({
  id,
  className = "h-20",
}: {
  id: ExpertLayoutPresetId;
  /** Wysokość/warianty rozmiaru - domyślnie h-20 (siatka w adminie). */
  className?: string;
}) {
  const base = `relative ${className} w-full rounded border border-border bg-muted/50 p-2 flex gap-1.5 overflow-hidden`;
  switch (id) {
    case "classic":
      return (
        <div className={base}>
          <div className="h-full w-6 rounded-[2px] bg-brand/70" />
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-2 w-3/4 rounded bg-foreground/40" />
            <div className="h-1.5 w-1/2 rounded bg-foreground/25" />
            <div className="h-1 w-full rounded bg-foreground/15 mt-auto" />
          </div>
        </div>
      );
    case "centered":
      return (
        <div className={`${base} flex-col items-center justify-center`}>
          <div className="h-5 w-5 rounded-full bg-brand/70" />
          <div className="h-1.5 w-1/2 rounded bg-foreground/40" />
          <div className="h-1 w-2/5 rounded bg-foreground/25" />
        </div>
      );
    case "magazine":
      return (
        <div className={`${base} flex-col`}>
          <div className="h-6 w-full rounded bg-brand/60" />
          <div className="flex gap-1 mt-auto">
            <div className="h-4 w-4 rounded bg-foreground/40" />
            <div className="flex-1 flex flex-col justify-center gap-1">
              <div className="h-1.5 w-3/4 rounded bg-foreground/40" />
              <div className="h-1 w-1/2 rounded bg-foreground/25" />
            </div>
          </div>
        </div>
      );
    case "sidebar-left":
      return (
        <div className={base}>
          <div className="h-full w-1/3 rounded bg-brand/50" />
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-1.5 w-3/4 rounded bg-foreground/40" />
            <div className="h-1 w-full rounded bg-foreground/20" />
            <div className="h-1 w-4/5 rounded bg-foreground/20" />
          </div>
        </div>
      );
    case "sidebar-right":
      return (
        <div className={base}>
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-1.5 w-3/4 rounded bg-foreground/40" />
            <div className="h-1 w-full rounded bg-foreground/20" />
            <div className="h-1 w-4/5 rounded bg-foreground/20" />
          </div>
          <div className="h-full w-1/3 rounded bg-brand/50" />
        </div>
      );
    case "minimal":
      return (
        <div className={`${base} flex-col justify-center`}>
          <div className="h-2 w-1/2 rounded bg-foreground/50" />
          <div className="h-px w-8 bg-brand/70 my-1" />
          <div className="h-1 w-1/3 rounded bg-foreground/25" />
        </div>
      );
    case "card-stack":
      return (
        <div className={`${base} flex-col`}>
          <div className="h-4 w-full rounded bg-background border border-border shadow-sm" />
          <div className="h-3 w-full rounded bg-background border border-border shadow-sm mt-1" />
          <div className="h-3 w-full rounded bg-background border border-border shadow-sm mt-1" />
        </div>
      );
    case "editorial":
      return (
        <div className={`${base} flex-col justify-end`}>
          <div className="absolute inset-1.5 rounded bg-gradient-to-t from-brand/70 to-transparent" />
          <div className="relative h-1.5 w-3/4 rounded bg-white/80" />
          <div className="relative h-1 w-1/2 rounded bg-white/60 mt-0.5" />
        </div>
      );
    default:
      return <div className={base} />;
  }
}
