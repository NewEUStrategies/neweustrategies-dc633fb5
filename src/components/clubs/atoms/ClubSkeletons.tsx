// Skeletony modułu klubów.
//
// Wcześniej stan ładowania był jednym szarym prostokątem (`h-64 bg-muted/50`),
// więc układ po dojściu danych PODSKAKIWAŁ: inna wysokość, inna liczba
// elementów, inne kolumny. Skeleton ma mieć kształt treści, którą zastępuje -
// wtedy strona wygląda na wczytywaną, a nie na przebudowywaną.
//
// Wszystkie warianty czytają ten sam prymityw `Shimmer`, żeby tempo i kolor
// animacji były jedne dla całego modułu.
import type { ClubLayout } from "@/lib/clubs/types";

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40 bg-[length:200%_100%] ${className ?? ""}`}
    />
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
      <Shimmer className="aspect-[16/9] rounded-none" />
      <div className="space-y-2 p-3">
        <Shimmer className="h-4 w-3/4" />
        <Shimmer className="h-3 w-full" />
        <Shimmer className="h-3 w-2/3" />
        <div className="flex gap-3 pt-1.5">
          <Shimmer className="h-3 w-14" />
          <Shimmer className="h-3 w-14" />
          <Shimmer className="h-3 w-14" />
        </div>
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg border border-border/60 bg-card p-3">
      <Shimmer className="h-16 w-20 shrink-0 sm:w-28" />
      <div className="min-w-0 flex-1 space-y-2">
        <Shimmer className="h-4 w-1/2" />
        <Shimmer className="h-3 w-3/4" />
        <Shimmer className="h-3 w-1/3" />
      </div>
    </div>
  );
}

/** Siatka katalogu w kształcie wybranego układu huba. */
export function ClubDirectorySkeleton({
  layout = "cards",
  count = 6,
}: {
  layout?: ClubLayout;
  count?: number;
}) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (layout === "list") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {items.map((i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (layout === "magazine") {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid overflow-hidden rounded-xl border border-border/60 bg-card md:grid-cols-2">
          <Shimmer className="aspect-[16/9] rounded-none md:h-full" />
          <div className="space-y-2 p-4">
            <Shimmer className="h-5 w-2/3" />
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-5/6" />
          </div>
        </div>
        {items.slice(1).map((i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (layout === "editorial") {
    return (
      <div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-busy="true"
      >
        {items.map((i) => (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-border/60 bg-card"
          >
            <Shimmer className="aspect-[16/9] rounded-none" />
            <div className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <Shimmer className="h-5 w-2/3" />
                <Shimmer className="h-5 w-16" />
              </div>
              <Shimmer className="h-3 w-full" />
              <Shimmer className="h-3 w-5/6" />
              <div className="flex gap-3 pt-2">
                <Shimmer className="h-3 w-14" />
                <Shimmer className="h-3 w-14" />
                <Shimmer className="h-3 w-14" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
      {items.map((i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Nagłówek klubu: baner, tytuł, akcje i pasek liczników. */
export function ClubHeaderSkeleton() {
  return (
    <header className="mb-5" aria-busy="true">
      <Shimmer className="mb-3 aspect-[5/1] w-full rounded-lg sm:aspect-[6/1]" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Shimmer className="h-7 w-2/3 max-w-md" />
          <Shimmer className="h-4 w-full max-w-xl" />
        </div>
        <div className="flex shrink-0 gap-2">
          <Shimmer className="h-8 w-24" />
          <Shimmer className="h-8 w-20" />
          <Shimmer className="h-8 w-28" />
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-3 w-24" />
      </div>
    </header>
  );
}

/** Lista wątków w klubie. */
export function ClubThreadListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2">
            <Shimmer className="h-4 w-16" />
            <Shimmer className="h-4 w-20" />
          </div>
          <Shimmer className="mt-2 h-5 w-3/5" />
          <div className="mt-2 flex gap-3">
            <Shimmer className="h-3 w-12" />
            <Shimmer className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Cała strona klubu podczas pierwszego pobrania. */
export function ClubDetailSkeleton() {
  return (
    <>
      <ClubHeaderSkeleton />
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
        <Shimmer className="h-10 w-full" />
        <Shimmer className="h-10 w-full" />
        <Shimmer className="h-10 w-24" />
      </div>
      <ClubThreadListSkeleton />
    </>
  );
}
