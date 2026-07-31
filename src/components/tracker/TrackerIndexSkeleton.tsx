// Route-shaped loading skeleton indeksu trackera. Wpięty przez
// `pendingComponent` na /tracker, żeby zimna nawigacja klienta (loader SSR
// czeka na dane) pokazywała placeholder w kształcie strony - nagłówek z
// kafelkiem ikony, rząd filtrów i siatkę kart sm:grid-cols-2 - zamiast pustego
// ekranu. Dekoracyjny (aria-hidden); RouteProgress ogłasza nawigację
// technologiom asystującym. Wymiary 1:1 z TrackerIndex (max-w-5xl, gap-4).
function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <div className="skeleton-shimmer h-5 w-24 rounded-full" />
        <div className="skeleton-shimmer h-3 w-16 rounded" />
      </div>
      <div className="skeleton-shimmer h-5 w-full rounded" />
      <div className="skeleton-shimmer h-5 w-2/3 rounded" />
      <div className="skeleton-shimmer h-2.5 w-full rounded-full" />
      <div className="skeleton-shimmer h-3 w-28 rounded" />
    </div>
  );
}

export function TrackerIndexSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="container mx-auto max-w-5xl space-y-8 px-4 py-10" aria-hidden="true">
      <div className="flex items-start gap-3">
        <div className="skeleton-shimmer h-11 w-11 shrink-0 rounded-xl" />
        <div className="space-y-2">
          <div className="skeleton-shimmer h-8 w-72 max-w-full rounded" />
          <div className="skeleton-shimmer h-4 w-96 max-w-full rounded" />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="skeleton-shimmer h-9 w-52 rounded-md" />
        <div className="skeleton-shimmer h-9 w-52 rounded-md" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
