// Panel recenzenta naboru prelegentów: `/events/<slug>/review[?id=<zgłoszenie>]`.
//
// `$slug_` wypina trasę z powłoki wydarzenia (bez paska zakładek i okładki -
// recenzent pracuje na liście, nie ogląda wydarzenia), wzorzec
// `events.$slug_.manage.tsx`.
//
// `ssr: false` + `noindex, nofollow`: wszystko należy do zalogowanego
// recenzenta i przychodzi z RPC wołanych w przeglądarce; treść zgłoszeń nie
// może trafić do HTML-a renderowanego na serwerze ani do indeksu.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { ReviewerPanelPage } from "@/components/events/cfp/organisms/ReviewerPanelPage";
import { buildEventPrivateHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

interface ReviewSearch {
  id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readReviewSearch(search: Record<string, unknown>): ReviewSearch {
  return typeof search.id === "string" && UUID.test(search.id) ? { id: search.id } : {};
}

export const Route = createFileRoute("/events/$slug_/review")({
  ssr: false,
  validateSearch: readReviewSearch,
  head: ({ params }) => {
    const url = getRequestUrl() || `/events/${params.slug}/review`;
    return buildEventPrivateHead({ page: "reviewPanel", lang: activeLang(url) });
  },
  errorComponent: ReviewRouteError,
  notFoundComponent: ReviewRouteError,
  component: ReviewRoute,
});

function ReviewRoute() {
  const { slug } = Route.useParams();
  const { id } = Route.useSearch();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <ReviewerPanelPage slug={slug} submissionId={id ?? null} />
    </main>
  );
}

function ReviewRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
