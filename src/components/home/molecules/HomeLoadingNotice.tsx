import { Skeleton } from "@/components/ui/skeleton";
import { errorCopy } from "@/lib/errorCopy";

/**
 * Query-free SSR fallback. Composition of UI atoms, with no router/data logic.
 *
 * KOMUNIKAT NIE JEST NAGŁÓWKIEM. Do 2026-10 tytuł stał w `<h2>`, a jedyny `h1`
 * strony głównej jest `sr-only` - przy dokumencie zdegradowanym „Loading the
 * homepage" był więc jedynym WIDOCZNYM nagłówkiem strony i Google wziął go za
 * tytuł wyniku na nazwę marki (zamiast `<title>` „New European Strategies").
 * Stan przejściowy ogłasza `role="status"`, a `data-nosnippet` zabrania
 * wyszukiwarce cytowania go we fragmencie wyniku.
 */
export function HomeLoadingNotice({ onRetry }: { onRetry?: () => void }) {
  const copy = errorCopy();
  return (
    <section
      data-home-loading
      data-nosnippet
      className="mx-auto w-full max-w-[1200px] px-4 py-10 lg:px-8"
    >
      <div role="status" className="max-w-xl">
        <p className="text-xl font-semibold text-foreground">{copy.homeLoading.title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{copy.homeLoading.body}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {copy.tryAgain}
        </button>
      )}
      <div aria-hidden="true" className="mt-6 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-64 motion-reduce:animate-none md:col-span-2 md:h-80" />
        <div className="space-y-4">
          <Skeleton className="h-36 motion-reduce:animate-none" />
          <Skeleton className="h-24 motion-reduce:animate-none" />
          <Skeleton className="h-12 motion-reduce:animate-none" />
        </div>
      </div>
    </section>
  );
}
