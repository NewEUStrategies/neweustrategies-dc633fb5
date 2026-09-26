// Publiczna trasa zakupu pakietu grupowego: `/events/<slug>/packages`.
//
// OSOBNA TRASA, JAK ZAPIS. Kupno puli miejsc to sesja wypełniania (dane
// płatnika, kod rabatowy, rozdanie zaproszeń), a strona wydarzenia jest stroną
// sprzedażową renderowaną serwerowo.
//
// `ssr: false`: oferta zależy od sesji (stawka zawężona do grupy odbiorców
// liczy się per użytkownik), której serwer nie widzi.
//
// `noindex`: indeksujemy stronę wydarzenia, nie ekran zakupu.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { EventPackagesPurchase } from "@/components/events/packages/EventPackagesPurchase";
import { AdAttributionCapture } from "@/components/events/public/atoms/AdAttributionCapture";

export const Route = createFileRoute("/events/$slug_/packages")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pakiety grupowe - New European Strategies" },
      {
        name: "description",
        content: "Kup pulę miejsc na wydarzenie dla zespołu lub delegacji i rozdaj je imiennie.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Pakiety grupowe - New European Strategies" },
      {
        property: "og:description",
        content: "Zamów pakiet miejsc na wydarzenie i zaproś uczestników.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: PackagesRouteError,
  notFoundComponent: PackagesRouteError,
  component: PackagesRoute,
});

function PackagesRoute() {
  const { slug } = Route.useParams();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      {/* Wejscie z reklamy prosto na pakiety tez niesie kampanie i liczy sie jako wizyta. */}
      <AdAttributionCapture eventSlug={slug} />
      <EventPackagesPurchase slug={slug} />
    </main>
  );
}

function PackagesRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
