// Route-shaped loading skeleton dla uniwersalnego resolvera treści (routes/$.tsx),
// spięty przez `pendingComponent`: zimna nawigacja kliencka do wpisu/strony
// pokazuje artykułowy placeholder (skeleton-shimmer) zamiast pustego ekranu.
// Dekoracyjny (aria-hidden) - nawigację ogłasza RouteProgress, jak w
// ArchiveSkeleton, z którym dzieli konwencje.
export function ContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-10 lg:px-8" aria-hidden="true">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2">
        <div className="skeleton-shimmer h-3 w-16 rounded" />
        <div className="skeleton-shimmer h-3 w-3 rounded-full" />
        <div className="skeleton-shimmer h-3 w-28 rounded" />
      </div>
      {/* Tytuł + meta */}
      <div className="space-y-3">
        <div className="skeleton-shimmer h-9 w-full rounded" />
        <div className="skeleton-shimmer h-9 w-3/4 rounded" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="skeleton-shimmer h-9 w-9 rounded-[7px]" />
        <div className="space-y-1.5">
          <div className="skeleton-shimmer h-3 w-32 rounded" />
          <div className="skeleton-shimmer h-3 w-24 rounded" />
        </div>
      </div>
      {/* Okładka */}
      <div className="skeleton-shimmer mt-6 aspect-[16/9] w-full rounded-lg" />
      {/* Akapity */}
      <div className="mt-8 space-y-3">
        <div className="skeleton-shimmer h-4 w-full rounded" />
        <div className="skeleton-shimmer h-4 w-full rounded" />
        <div className="skeleton-shimmer h-4 w-11/12 rounded" />
        <div className="skeleton-shimmer h-4 w-full rounded" />
        <div className="skeleton-shimmer h-4 w-2/3 rounded" />
      </div>
    </div>
  );
}
