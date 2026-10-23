// WĘZEŁ DANYCH ZESTAWU BOOTU (P2.1) - `<script type="application/json" id="nes-boot-set">`
// w `<head>` każdego dokumentu SSR z zestawem, zaraz po `<HeadContent />`, przed sondą
// i loaderem bootu (`routes/__root.tsx`).
//
// SKĄD TREŚĆ. Zestaw składa serwer w haku dehydratacji routera (`bootSet.server.ts`,
// `prepareBootSet` z `src/router.tsx`): po `router.load()`, przed renderem Reacta, raz na
// żądanie. Escapowany JSON czeka w rejestrze kluczowanym routerem (`bootSetRegistry.ts`).
//
// DLACZEGO WĘZEŁ W DRZEWIE REACTA. Od router-core 1.171.37 `serverSsr` nie ma kanału HTML
// (`injectHtml` zniknęło, `router-core/dist/esm/router.d.ts:516-551`): sam router dopisuje
// wyłącznie skrypty hydratacji w `<body>`. Powłoka dokumentu (`<head>` nigdy nie stoi
// w Suspense) wychodzi tak samo na ścieżce strumieniowej (przeglądarki, także Lighthouse/PSI),
// `allReady` (crawlery) i `renderToString`, więc węzeł stoi ZAWSZE w `<head>` przed loaderem -
// deterministyczniej niż dawna „pierwsza granica strumienia". Bajty są te same co
// `bootSetHtml(set)`: kolejność atrybutów `type`, `id` czytają regexy e2e i `documentWeight.ts`.
//
// TOŻSAMOŚĆ HYDRATACJI. Wzorzec `ScriptOnce`/`ScrollRestoration` TanStacka: na serwerze
// `<script>`, w przeglądarce `null` w tym samym miejscu drzewa (`useId` i kontekst drzewa bez
// zmian). Węzła z HTML-u hydratacja też nie zobaczy: loader czyta go i USUWA, zanim wstawi
// wejście (`bootLoaderScript.ts`, funkcja Q) - React 19 dopasowałby pozostawiony `<script>` bez
// `src` w `<head>` do następnego oczekiwanego skryptu.
//
// KOSZT KLIENTA. W bundlu przeglądarki `isServer` jest stałą `false`, więc komponent zwija się
// do `useRouter` i `null`.
import { useRouter } from "@tanstack/react-router";
import { isServer } from "@tanstack/router-core/isServer";

import { BOOT_SET_ELEMENT_ID } from "./bootSetId";
import { getBootSetJson } from "./bootSetRegistry";

/** Węzeł `#nes-boot-set` routera tego żądania; poza SSR i bez zestawu - nic. */
export function BootSetNode() {
  const router = useRouter({ warn: false });
  // Bez routera (goły render powłoki w teście) i w przeglądarce - nic.
  if (!router || !(isServer ?? router.isServer)) return null;
  const bootSetJson = getBootSetJson(router);
  if (bootSetJson === undefined) return null;
  return (
    <script
      type="application/json"
      id={BOOT_SET_ELEMENT_ID}
      dangerouslySetInnerHTML={{ __html: bootSetJson }}
    />
  );
}
