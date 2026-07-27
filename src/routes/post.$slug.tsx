// Legacy /post/<slug> URLs. Resolves the post's new canonical URL
// (parent page path + post slug) and redirects permanently (301) so crawlers
// transfer link equity to the canonical address instead of caching a 307.
// The missing-post fallbacks stay temporary (302): the post may reappear
// (trash restore, republish), so /blog must not be cached as its permanent
// destination.
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { edgeTtlCache } from "@/lib/ssrCache";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { errorCopy } from "@/lib/errorCopy";

// Redirect responses must never be CDN-cached as if they were content.
const NO_STORE = contentCacheControl({ preview: true });

/**
 * Rezolucja kanonicznej ścieżki wpisu dla starego formatu linku. Dwa
 * sekwencyjne round-tripy (wpis -> pełna ścieżka rodzica) biegły dotąd na
 * KAŻDE trafienie /post/<slug> - a to ruch zdominowany przez boty i stare
 * indeksy, ten sam slug w kółko. Per-isolate TTL (per tenant host) amortyzuje
 * go do jednej rezolucji na 5 minut; wynik null (wpis zniknął) też jest
 * cache'owany, żeby zdjęte wpisy nie młóciły bazy.
 */
async function resolveLegacyPostPath(slug: string): Promise<string | null> {
  return edgeTtlCache(`public:post-redirect:${slug}`, 5 * 60_000, async () => {
    const { data, error } = await supabase
      .from("posts")
      .select("slug, parent_page_id")
      .eq("slug", slug)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data?.parent_page_id) return null;
    const { data: pathRow } = await supabase.rpc("page_full_path", {
      _page_id: data.parent_page_id,
    });
    const path = typeof pathRow === "string" ? pathRow : null;
    if (!path) return null;
    return `${path}/${data.slug}`;
  });
}

export const Route = createFileRoute("/post/$slug")({
  loader: async ({ params }) => {
    const splat = await resolveLegacyPostPath(params.slug);
    setCacheControlHeader(NO_STORE);
    if (!splat) throw redirect({ to: "/blog", statusCode: 302 });
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
