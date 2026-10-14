// Publiczna trasa samoobsługi zgłoszenia: `/events/<slug>/manage#token=…`.
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
// KLUCZ WE FRAGMENCIE (REG-17). Fragmentu przeglądarka nie wysyła na serwer,
// więc klucz nie trafia do logów dostępu ani do nagłówka `Referer`. Trzy
// źródła klucza, w tej kolejności:
//   1. `#token=` - odnośnik z maila, przycisk „kopiuj", zakładka;
//   2. `?token=` - STARY odnośnik z maili wysłanych przed zmianą. Klucz z niego
//      działa (do końca wydarzenia), ale adres jest od razu przepisywany na
//      fragment przez `navigate` z `replace`, jak `?t=` w skanerze - zapytanie
//      z kluczem nie zostaje w historii ani w zakładce. Zapytanie z kluczem
//      o złym kształcie też znika z adresu (bez fragmentu);
//   3. klucz odłożony w `sessionStorage` przed wyjściem do kasy - adres
//      powrotu od dostawcy płatności nie niesie klucza. Po odczycie wraca do
//      fragmentu, żeby zakładka po płatności dalej działała.
//
// `ssr: false`: cała treść zależy od klucza z adresu i od publicznych RPC
// wołanych z przeglądarki - a fragmentu serwer renderujący i tak nie widzi.
//
// `noindex, nofollow`: adres NIESIE POŚWIADCZENIE. Nie ma go w indeksie,
// nie ma go w linkach wychodzących i nie ma go w mapie strony.
import { useEffect, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";

import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { RegistrationManagePanel } from "@/components/events/registration/RegistrationManagePanel";
import {
  manageFragment,
  readManageFragment,
  readManageToken,
  takeStashedManageToken,
} from "@/lib/events/manageToken";

interface ManageSearch {
  /**
   * STARY odnośnik `?token=` - czytany wyłącznie po to, żeby przepisać go na
   * fragment. `undefined`, gdy adres przyszedł bez niego.
   */
  token?: string;
}

export const Route = createFileRoute("/events/$slug_/manage")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): ManageSearch => {
    // Kształt klucza sprawdzamy TU i jeszcze raz w komponencie: router skleja
    // wynik z surowymi parametrami (żaden przodek nie waliduje adresu), więc
    // literówka z zapytania potrafi przeżyć ten walidator.
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
  const search: ManageSearch = Route.useSearch();
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();

  const fragmentToken = readManageFragment(hash);
  const legacyRaw = search.token;
  const legacyToken = readManageToken(legacyRaw);
  // Bez klucza w adresie panel czeka na sprawdzenie przechowalni kasy - inaczej
  // powrót z płatności mignąłby polem „wklej klucz".
  const [stashChecked, setStashChecked] = useState(false);

  useEffect(() => {
    if (legacyRaw !== undefined) {
      // Stary odnośnik: zapytanie znika z adresu, klucz przechodzi do fragmentu
      // (fragment już obecny ma pierwszeństwo - to nowszy format).
      const key = fragmentToken ?? legacyToken;
      void navigate({
        to: "/events/$slug/manage",
        params: { slug },
        search: {},
        hash: key === null ? "" : manageFragment(key),
        replace: true,
        resetScroll: false,
      });
      return;
    }
    if (fragmentToken !== null) return;
    // Odczyt zużywa pozycję, więc drugi przebieg efektu (tryb ścisły) nic już
    // nie znajdzie - nawigacja z pierwszego wystarcza.
    const stashed = takeStashedManageToken(slug);
    if (stashed !== null) {
      void navigate({
        to: "/events/$slug/manage",
        params: { slug },
        search: {},
        hash: manageFragment(stashed),
        replace: true,
        resetScroll: false,
      });
      return;
    }
    setStashChecked(true);
  }, [fragmentToken, legacyRaw, legacyToken, navigate, slug]);

  const token = fragmentToken ?? legacyToken;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      {(token !== null || stashChecked) && <RegistrationManagePanel slug={slug} token={token} />}
    </main>
  );
}

function ManageRouteError() {
  return <FriendlyErrorPage variant="compact" />;
}
