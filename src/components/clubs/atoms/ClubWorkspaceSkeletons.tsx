// Skeletony przestrzeni roboczej.
//
// Ta sama doktryna, co w `ClubSkeletons`: skeleton ma KSZTAŁT treści, którą
// zastępuje, więc dojście danych nie przebudowuje układu. Wszystkie warianty
// czytają ten sam prymityw `Shimmer`, żeby tempo i kolor animacji były jedne
// dla całego modułu - stąd import zamiast drugiej kopii.
import { Shimmer } from "./ClubSkeletons";

export function ClubDocumentsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-lg border border-border/60 bg-card p-3">
          <Shimmer className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Shimmer className="h-4 w-1/2" />
            <Shimmer className="h-3 w-3/4" />
            <div className="flex gap-2 pt-1">
              <Shimmer className="h-3 w-16" />
              <Shimmer className="h-3 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Siatka miesiąca + lista nadchodzących - dokładnie tak, jak wygląda kalendarz. */
export function ClubCalendarSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
      <Shimmer className="aspect-[7/6] w-full rounded-lg sm:aspect-[7/5]" />
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-card p-3">
            <Shimmer className="h-3 w-24" />
            <Shimmer className="mt-2 h-4 w-3/4" />
            <Shimmer className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClubScheduleSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Shimmer className="mt-1 h-3 w-3 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 rounded-lg border border-border/60 bg-card p-3">
            <Shimmer className="h-4 w-1/3" />
            <Shimmer className="h-3 w-2/3" />
            <Shimmer className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cztery kafelki + dwa wykresy - kształt pulpitu pomiaru. */
export function ClubInsightsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Shimmer key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Shimmer className="h-64 rounded-lg" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Shimmer className="h-56 rounded-lg" />
        <Shimmer className="h-56 rounded-lg" />
      </div>
    </div>
  );
}
