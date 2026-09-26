// Formularz zgłoszenia wystąpienia: `/events/<slug>/cfp-submit[?id=<szkic>]`.
//
// `$slug_` (podkreślnik) wypina trasę z powłoki wydarzenia - formularz nie
// potrzebuje paska zakładek ani okładki, a powłoka jest stroną SSR z metadanymi
// do udostępniania (wzorzec `events.$slug_.manage.tsx`).
//
// `ssr: false`: cała treść należy do zalogowanego wołającego (jego szkic, jego
// dane) i przychodzi z RPC wołanych w przeglądarce. Serwer nie miałby czego
// wyrenderować przed odpowiedzią bazy.
//
// `noindex, nofollow`: to formularz konta, nie treść do wyszukiwarki.
//
// `?id=` SPRAWDZAMY W KSZTAŁCIE UUID. Adres z literówką dojeżdża jako „nowe
// zgłoszenie", a nie jako identyfikator, który zaraz odbije baza.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { CfpSubmitPage } from "@/components/events/cfp/organisms/CfpSubmitPage";
import { buildEventPrivateHead } from "@/lib/events/eventTabHead";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";

interface CfpSubmitSearch {
  id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readCfpSubmitSearch(search: Record<string, unknown>): CfpSubmitSearch {
  return typeof search.id === "string" && UUID.test(search.id) ? { id: search.id } : {};
}

export const Route = createFileRoute("/events/$slug_/cfp-submit")({
  ssr: false,
  validateSearch: readCfpSubmitSearch,
  head: ({ params }) => {
    const url = getRequestUrl() || `/events/${params.slug}/cfp-submit`;
    return buildEventPrivateHead({ page: "cfpSubmit", lang: activeLang(url) });
  },
  errorComponent: CfpSubmitRouteError,
  notFoundComponent: CfpSubmitRouteError,
  component: CfpSubmitRoute,
});

function CfpSubmitRoute() {
  const { slug } = Route.useParams();
  const { id } = Route.useSearch();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <CfpSubmitPage slug={slug} submissionId={id ?? null} />
    </main>
  );
}

function CfpSubmitRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
