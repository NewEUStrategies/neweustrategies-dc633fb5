export function RouteLoadingSkeleton() {
  // Delayed fade-in (opacity 0 -> 1 after 140ms) sprawia, że krótkie
  // przejścia (<200ms, gdy trasa jest już preloadowana) nie migają
  // szkieletem - użytkownik widzi tylko płynny cross-fade View Transitions,
  // a shimmer pojawia się dopiero przy naprawdę wolnych ładowaniach.
  return (
    <div
      className="min-h-[55vh] w-full px-4 py-8 lg:px-8 animate-[route-skeleton-in_260ms_ease-out_140ms_both]"
      aria-busy="true"
    >
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div className="skeleton-shimmer h-5 w-40 rounded" />
        <div className="skeleton-shimmer h-10 w-2/3 max-w-2xl rounded" />
        <div className="grid gap-5 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <div className="skeleton-shimmer aspect-[16/7] rounded-xl" />
            <div className="skeleton-shimmer h-4 w-full rounded" />
            <div className="skeleton-shimmer h-4 w-5/6 rounded" />
          </div>
          <div className="space-y-3">
            <div className="skeleton-shimmer h-24 rounded-xl" />
            <div className="skeleton-shimmer h-24 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
