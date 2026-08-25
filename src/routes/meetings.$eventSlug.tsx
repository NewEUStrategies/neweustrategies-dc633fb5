// Trasa uczestnika gieldy spotkan 1-1: `/meetings/<slug-wydarzenia>`.
//
// OSOBNY ADRES, NIE ZAKLADKA NA STRONIE WYDARZENIA. Uczestnik wraca tu wiele
// razy w dniu kongresu, czesto z linku w mailu z zaproszeniem - adres musi byc
// stabilny i mozliwy do zapisania w zakladkach, a strona wydarzenia jest strona
// SPRZEDAZOWA (SSR, dla niezalogowanych, z metadanymi do udostepniania).
//
// `ssr: false` JEST TU KONIECZNE, NIE OSZCZEDNOSCIA. Cala tresc pochodzi z RPC
// wolanych jako zalogowany uzytkownik, a sesja Supabase siedzi w `localStorage`,
// ktorego serwer nie widzi. Renderowanie po stronie serwera dawaloby wiec
// zawsze wersje "nie jestes zalogowany", a po hydracji podmienialoby ja na
// wlasciwa - czyli mignieciem tresci i rozjazdem SSR/hydracji.
//
// `noindex`: prywatny terminarz uczestnika nie ma czego robic w wyszukiwarce.
import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/profile/AuthGate";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { MeetingExchangeBoard } from "@/components/events/meetings/MeetingExchangeBoard";

export const Route = createFileRoute("/meetings/$eventSlug")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Giełda spotkań 1-1 - New European Strategies" },
      {
        name: "description",
        content:
          "Twój terminarz rozmów 1-1 na wydarzeniu: zaproszenia, potwierdzone spotkania i okna dostępności.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Giełda spotkań 1-1 - New European Strategies" },
      {
        property: "og:description",
        content: "Zaproszenia, potwierdzone spotkania i okna dostępności uczestnika wydarzenia.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: MeetingsRouteError,
  notFoundComponent: MeetingsRouteError,
  component: MeetingsRoute,
});

function MeetingsRoute() {
  const { eventSlug } = Route.useParams();
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <AuthGate>
        <MeetingExchangeBoard slug={eventSlug} />
      </AuthGate>
    </main>
  );
}

function MeetingsRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
