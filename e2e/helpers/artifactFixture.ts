// OBCE ORIGINY ARTEFAKTU FIXTURE W PRZEGLĄDARCE - backend klienta i obrazy - NIEZALEŻNIE OD
// ŚRODOWISKA BUILDU. Wspólne dla specyfikacji, które porównują stan strony między dwoma
// dokumentami (przeładowanie) albo czekają na nawigację SPA i nie mogą zależeć od tego, jak
// i kiedy padnie żądanie do hosta, którego runner nie ma.
//
// BACKEND KLIENTA. SSR artefaktu dostaje dane z `scripts/performance/replayFetch.mjs`, ale
// przeglądarka woła Supabase pod adresem WPIECZONYM w bundle w chwili buildu: w
// `lib/supabasePublicConfig.ts` `import.meta.env.VITE_SUPABASE_URL` wygrywa z
// `window.__SUPABASE_CONFIG__`, który serwer fixture ustawia na 127.0.0.1:4199. Lokalny build
// z `VITE_SUPABASE_URL=http://127.0.0.1:4199` woła więc martwy port 4199, a build CI
// (`.github/workflows/ci.yml`) - `secrets.VITE_SUPABASE_URL || https://placeholder.supabase.co`:
// placeholder nie istnieje (`net::ERR_NAME_NOT_RESOLVED` na runnerze, przez proxy sandboksa
// `ERR_TUNNEL_CONNECTION_FAILED`), a z sekretem przeglądarka rozmawiałaby z prawdziwą bazą
// (dokument z 127.0.0.1 to host podglądu, więc CSP `connect-src` przepuszcza każde `https:`).
// Trasa po samym porcie 4199 nie łapała w CI niczego (porażka 844f86138: nawigacja SPA na
// `/regulamin` czekała ~15,4 s na zapytanie o nadpisania SEO). Dlatego dopasowanie idzie po
// ścieżce API Supabase na originie innym niż aplikacja - nie po hoście z builda. (Węższe
// `isFixtureBackend` z `homeFixture.ts` - sam PostgREST na `*.supabase.co` i 127.0.0.1 -
// liczy odczyty w `backend-quiet`; baza z sekretu może stać pod własną domeną.)
//
// OBRAZY. Okładki i ikony fixture leżą na `https://fixture.invalid/*` (`homeFixture.ts`),
// hoście, który z konstrukcji nie istnieje - a jak i kiedy żądanie padnie, zależy od maszyny
// (runner CI: `ERR_NAME_NOT_RESOLVED` po ~20 ms, sandbox: tunel proxy). `OptimizedImage`
// pokazuje zaślepkę innej wysokości tylko wtedy, gdy błąd zobaczy React (element z renderu
// klienckiego albo błąd po hydratacji); zepsuty `<img>` z HTML-u serwera, który padł przed
// hydratacją, zostaje. Ten sam fragment strony ma więc dwa możliwe układy (telefon 412 px:
// pierwsza sekcja z cv 1004,8 albo 1039,3 px - porażka CI 844f86138). Obrazy z dysku, z tego
// samego pliku co harness Lighthouse'a (`fixtureImageFor`), wczytują się zawsze.
import { test, type Page } from "@playwright/test";

import { fixtureImageFor } from "../../scripts/performance/homeFixture";

/** Ścieżki HTTP API Supabase (PostgREST, Auth, Storage, Edge Functions) - jak w każdym projekcie. */
const SUPABASE_API_PATH = /^\/(?:rest|auth|storage|functions)\/v1\//;

/** Żądanie przeglądarki do backendu Supabase: ścieżka API na originie innym niż aplikacja. */
export function isClientBackendUrl(url: URL, appOrigin: string): boolean {
  return url.origin !== appOrigin && SUPABASE_API_PATH.test(url.pathname);
}

/**
 * Backend klienta jak martwy port fixture - pod KAŻDYM originem, który wpiekł build: odmowa
 * połączenia na każde żądanie, poza ścieżkami z `replies` (ścieżka -> ciało JSON, np.
 * `{ "/rest/v1/pages": [] }`). Preflight CORS trasowanego żądania Playwright obsługuje sam.
 */
export async function routeClientBackend(
  page: Page,
  replies: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("routeClientBackend: brak `use.baseURL` w konfiguracji");
  const appOrigin = new URL(baseURL).origin;
  await page.route(
    (url) => isClientBackendUrl(url, appOrigin),
    (route) => {
      const { pathname } = new URL(route.request().url());
      return Object.hasOwn(replies, pathname)
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(replies[pathname]),
          })
        : route.abort("connectionrefused");
    },
  );
}

/** Obrazy fixture (`https://fixture.invalid/*`) z dysku: każdy obraz się wczytuje, nic nie ściga się z hydratacją. */
export async function serveFixtureImages(page: Page): Promise<void> {
  await page.route("https://fixture.invalid/**", (route) => {
    const { body, contentType } = fixtureImageFor(route.request().url());
    return route.fulfill({ status: 200, contentType, body });
  });
}
