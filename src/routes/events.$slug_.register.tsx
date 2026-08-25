// Publiczna trasa zapisu na wydarzenie: `/events/<slug>/register`.
//
// OSOBNA TRASA, A NIE PANEL NA STRONIE WYDARZENIA. Strona wydarzenia jest
// stroną sprzedażową renderowaną serwerowo (metadane do udostępniania, SEO),
// a formularz to długa sesja wypełniania: bilet, pytania organizatora i zgody.
// Wciągnięcie go w tamten widok kazałoby uczestnikowi tracić wpisane dane przy
// każdym powrocie do treści wydarzenia.
//
// `$slug_` (podkreślnik) daje adres dziecka BEZ zamiany `events.$slug.tsx` w
// layout - strona wydarzenia zostaje zwykłym liściem z własnym SSR.
//
// `ssr: false`: formularz zależy od sesji Supabase z `localStorage` (dane
// zalogowanego wstępnie wypełniamy) i od świeżej dostępności biletów. Serwer
// nie widzi ani jednego, ani drugiego, więc renderowanie serwerowe dawałoby
// mignięcie treści i rozjazd hydracji.
//
// `noindex`: indeksujemy stronę wydarzenia, nie sam formularz - inaczej
// wyszukiwarka pokazywałaby pusty formularz zamiast opisu wydarzenia.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { PublicRegistrationForm } from "@/components/events/registration/PublicRegistrationForm";

export const Route = createFileRoute("/events/$slug_/register")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Zapis na wydarzenie - New European Strategies" },
      {
        name: "description",
        content:
          "Formularz zapisu na wydarzenie: wybór biletu, pytania organizatora i wymagane zgody.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Zapis na wydarzenie - New European Strategies" },
      {
        property: "og:description",
        content: "Wypełnij formularz zgłoszenia i potwierdź udział w wydarzeniu.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: RegisterRouteError,
  notFoundComponent: RegisterRouteError,
  component: RegisterRoute,
});

function RegisterRoute() {
  const { slug } = Route.useParams();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PublicRegistrationForm slug={slug} />
    </main>
  );
}

function RegisterRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
