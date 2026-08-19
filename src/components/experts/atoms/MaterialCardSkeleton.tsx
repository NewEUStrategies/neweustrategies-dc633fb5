// Atom: szkielet karty materiału na czas pierwszego ładowania strony wyników
// (gdy loader trasy nie zasiał cache'u). Ukryty przed czytnikiem ekranu -
// to migotanie, a nie treść.
export function MaterialCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[8px] border border-border/60" aria-hidden>
      <div className="aspect-[16/9] animate-pulse bg-muted/50" />
      <div className="space-y-2 p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-full animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted/50" />
      </div>
    </div>
  );
}
