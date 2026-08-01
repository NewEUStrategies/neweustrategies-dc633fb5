// Route-shaped loading skeleton dla /events (pendingComponent trasy; atomic
// design: molecule). Odwzorowuje siatkę listy - nagłówek strony, tytuł sekcji
// i karty md:grid-cols-2 z okładką aspect-video - żeby wolna nawigacja
// pokazywała kształt treści zamiast pustej strony albo gołego spinnera.
// Dekoracyjny (aria-hidden); nawigację ogłasza RouteProgress.
function EventCardSkeleton() {
  return (
    <li className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="skeleton-shimmer aspect-video w-full" />
      <div className="space-y-3 p-5">
        <div className="skeleton-shimmer h-3 w-32 rounded" />
        <div className="skeleton-shimmer h-5 w-full rounded" />
        <div className="skeleton-shimmer h-4 w-2/3 rounded" />
      </div>
    </li>
  );
}

export function EventsListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-12 md:py-16" aria-hidden="true">
      <header className="mb-10 space-y-3">
        <div className="skeleton-shimmer h-9 w-64 max-w-full rounded" />
        <div className="skeleton-shimmer h-4 w-96 max-w-full rounded" />
      </header>
      <div className="skeleton-shimmer mb-6 h-7 w-44 rounded" />
      <ul className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <EventCardSkeleton key={i} />
        ))}
      </ul>
    </div>
  );
}
