// Legacy /post/<slug> URLs. Resolves the post's new canonical URL
// (parent page path + post slug) and redirects permanently (301) so crawlers
// transfer link equity to the canonical address instead of caching a 307.
// The missing-post fallbacks stay temporary (302): the post may reappear
// (trash restore, republish), so /blog must not be cached as its permanent
// destination. The 301 itself is share-cacheable (see PERMANENT_REDIRECT).
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";
import { resolveLegacyPostPath } from "@/lib/routing/legacyPostPath";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { errorCopy } from "@/lib/errorCopy";

// Tymczasowe 302 (wpis może wrócić z kosza) nigdy nie trafia do cache.
const NO_STORE = contentCacheControl({ preview: true });
/**
 * Trwałe 301 na adres kanoniczny JEST cache'owalne (audyt CWV 2026-09-20, F13):
 * `/post/<slug>` to główny adres generowany przez własne listingi i karty, więc
 * każde wejście z listy płaciło dwa dokumenty - przekierowanie renderowane
 * `no-store` i dopiero potem treść. Krótka świeżość w przeglądarce (5 min)
 * i godzina na brzegu: zmiana rodzica wpisu jest zdarzeniem redakcyjnym, a
 * stare 301 prowadzi na adres, który sam przekierowuje dalej (poprawnie, tylko
 * o jeden skok dłużej) - nigdy na 404.
 */
const PERMANENT_REDIRECT = cacheControlHeader({
  cacheable: true,
  browserMaxAge: 300,
  sharedMaxAge: 3_600,
  staleWhileRevalidate: 86_400,
});

export const Route = createFileRoute("/post/$slug")({
  loader: async ({ params }) => {
    const splat = await resolveLegacyPostPath(params.slug);
    if (!splat) {
      setCacheControlHeader(NO_STORE);
      throw redirect({ to: "/blog", statusCode: 302 });
    }
    setCacheControlHeader(PERMANENT_REDIRECT);
    throw redirect({
      to: "/$",
      params: { _splat: splat },
      statusCode: 301,
    });
  },
  component: () => null,
  notFoundComponent: PublicNotFound,
  errorComponent: LegacyPostError,
});

function LegacyPostError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const copy = errorCopy();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
      <h1 className="font-display text-2xl">{copy.errorTitle}</h1>
      <p className="text-sm text-muted-foreground mt-2">{copy.errorBody}</p>
      <button
        onClick={() => {
          router.invalidate();
          reset();
        }}
        className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm"
      >
        {copy.tryAgain}
      </button>
    </div>
  );
}
