/**
 * Layout-stable placeholder rendered while site_settings (header config) is
 * still loading. Matches the real header's vertical footprint so the page
 * below does not shift once data hydrates.
 */
export function HeaderSkeleton() {
  return (
    <div
      className="bg-background"
      aria-hidden="true"
      data-skeleton="header"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <div className="h-7 w-32 rounded-md bg-muted animate-pulse" />
        <nav className="hidden items-center gap-6 md:flex">
          <div className="h-4 w-14 rounded bg-muted animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted animate-pulse" />
          <div className="h-4 w-12 rounded bg-muted animate-pulse" />
          <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        </nav>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          <div className="h-8 w-20 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  );
}
