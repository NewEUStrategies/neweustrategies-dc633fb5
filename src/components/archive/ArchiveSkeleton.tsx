// Route-shaped loading skeleton for archive / listing pages. Wired via
// `pendingComponent` on category / tag / author / blog / search so a cold
// navigation shows a grid-shaped placeholder (skeleton-shimmer) instead of a
// blank page or a bare spinner. Decorative only (aria-hidden); RouteProgress
// announces the navigation to assistive tech.
function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="skeleton-shimmer aspect-[16/9] w-full" />
      <div className="space-y-3 p-4">
        <div className="skeleton-shimmer h-3 w-24 rounded" />
        <div className="skeleton-shimmer h-5 w-full rounded" />
        <div className="skeleton-shimmer h-5 w-2/3 rounded" />
      </div>
    </div>
  );
}

export function ArchiveSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 lg:px-8" aria-hidden="true">
      <div className="mb-8 space-y-2">
        <div className="skeleton-shimmer h-3 w-20 rounded" />
        <div className="skeleton-shimmer h-9 w-64 rounded" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
