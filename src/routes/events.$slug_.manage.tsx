// Publiczna trasa samoobsługi zgłoszenia: `/events/<slug>/manage?token=…`.
//
// OSOBNA TRASA, NIE PANEL NA STRONIE WYDARZENIA. Odnośnik przychodzi mailem
// i musi mieć adres, który da się zapisać w zakładkach oraz otworzyć na innym
// urządzeniu niż to, na którym powstało zgłoszenie. Strona wydarzenia jest
// stroną sprzedażową (SSR, metadane do udostępniania) i doklejenie do niej
// klucza z maila wpuściłoby poświadczenie do adresu indeksowanego przez
// wyszukiwarki.
//
// `$slug_` (podkreślnik) daje adres dziecka BEZ zamiany `events.$slug.tsx`
// w layout - strona wydarzenia zostaje zwykłym liściem z własnym SSR.
//
// `ssr: false`: cała treść zależy od klucza z adresu i od publicznych RPC
// wołanych z przeglądarki. Renderowanie serwerowe wysłałoby ten klucz na
// serwer renderujący i tak nie miałoby czego pokazać przed odpowiedzią bazy.
//
// `noindex, nofollow`: adres NIESIE POŚWIADCZENIE. Nie ma go w indeksie,
// nie ma go w linkach wychodzących i nie ma go w mapie strony.
import { createFileRoute } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { RegistrationManagePanel } from "@/components/events/registration/RegistrationManagePanel";
import { readManageToken } from "@/lib/events/manageToken";

interface ManageSearch {
  /** Klucz `manage_token`; `undefined`, gdy adres przyszedł bez niego. */
  token?: string;
}

export const Route = createFileRoute("/events/$slug_/manage")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ManageSearch => {
    // Kształt klucza sprawdzamy TU, a nie w komponencie: adres z literówką ma
    // dojechać do strony jako „brak klucza", a nie jako klucz, który zaraz
    // wywoła odmowę z bazy.
    const token = readManageToken(search.token);
    return token === null ? {} : { token };
  },
  head: () => ({
    meta: [
      { title: "Twoje zgłoszenie - New European Strategies" },
      {
        name: "description",
        content: "Podgląd i odwołanie własnego zgłoszenia na wydarzenie.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  errorComponent: ManageRouteError,
  notFoundComponent: ManageRouteError,
  component: ManageRoute,
});

function ManageRoute() {
  const { slug } = Route.useParams();
  const { token } = Route.useSearch();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <RegistrationManagePanel slug={slug} token={token ?? null} />
    </main>
  );
}

function ManageRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
