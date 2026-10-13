// Publiczna trasa przyjecia zaproszenia na miejsce z pakietu:
// `/events/invite/<token>`.
//
// `events_` (podkreslnik) ODCINA POWLOKE ZAKLADEK wydarzenia. Bez niego
// segment „invite" wpadalby w `events.$slug` jako slug i delegat widzialby
// „nie znaleziono wydarzenia" - dokladnie tak dzialo sie, zanim ta trasa
// powstala, mimo ze `packageInviteUrl()` sklada wlasnie ten adres.
//
// `ssr: false`: adres NIESIE POSWIADCZENIE i cala tresc zalezy od publicznego
// RPC wolanego z przegladarki. Renderowanie serwerowe wyslaloby token na
// serwer renderujacy i tak nie mialoby czego pokazac przed odpowiedzia bazy.
//
// `noindex, nofollow` + `no-referrer`: token jest jednorazowym kluczem do
// oplaconego miejsca, wiec nie ma go w indeksie ani w naglowku odsylajacym.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { PackageInviteAccept } from "@/components/events/registration/PackageInviteAccept";
import { readPackageInviteToken } from "@/lib/events/packageInviteApi";

export const Route = createFileRoute("/events_/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Zaproszenie na wydarzenie - New European Strategies" },
      {
        name: "description",
        content: "Potwierdz udzial w wydarzeniu na miejscu oplaconym przez organizacje.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  errorComponent: InviteRouteError,
  notFoundComponent: InviteRouteError,
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  // `key`: inny link = nowy komponent. Podglad zaproszenia nie trzyma tokenu
  // w kluczu cache (to poswiadczenie), wiec stan nie moze przejsc miedzy
  // dwoma odnosnikami otwartymi w tej samej karcie.
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <PackageInviteAccept key={token} token={readPackageInviteToken(token)} />
    </main>
  );
}

function InviteRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
