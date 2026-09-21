// KONTRAKT ODPORNOŚCI LOADERA ARCHIWUM BLOGA (`/blog`).
//
// CZEGO TEN PLIK PILNUJE. Loader `/blog` jedzie DWIEMA fazami pod terminem:
// najpierw `site_settings` (rozmiar strony z ustawień czytania), potem sama
// lista wpisów. Po każdej fazie stoi gałąź „nie ma danych" - zasiew pustki
// z `updatedAt: 0` plus `private, no-store` na odpowiedzi. Ta gałąź jest
// WŁAŚCIWA w renderze serwerowym (render musi skończyć się przed watchdogiem
// zapytań, a zasiew leczy się refetchem po hydratacji) i BŁĘDNA przy nawigacji
// SPA: wynik loadera jest niezmienny przez całe życie dopasowania trasy, więc
// powolne - a nie błędne - zapytanie zostawiałoby czytelnikowi PUSTE archiwum
// na stałe, choć wpisy dociągają sekundę później (recenzja PR #382, P1;
// mechanizm w docblocku `withSsrBudget` w `src/lib/asyncBudget.ts`).
//
// ŚRODOWISKO. Suita biegnie w happy-dom, gdzie `document` istnieje zawsze -
// czyli DOMYŚLNIE jesteśmy w przeglądarce. Ścieżkę serwerową modeluje stub
// globalu, bo `isSsrRequest()` liczy `typeof document` PRZY KAŻDYM WYWOŁANIU.
//
// Testujemy loader jako FUNKCJĘ, bez montowania drzewa - ta sama doktryna co
// `archiveLoaderResilience.test.ts` i `eventShellLoader.test.ts`. `head()`
// i `validateSearch` tej trasy mają własny plik (`archiveRoutes.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Mapa `site_settings`; `delayMs` = POWOLNOŚĆ, `throws` = awaria. */
  settings: {} as Record<string, unknown>,
  settingsDelayMs: 0,
  settingsThrow: false,
  /** Strona archiwum; `delayMs` = POWOLNOŚĆ, `throws` = awaria. */
  archive: null as Record<string, unknown> | null,
  archiveDelayMs: 0,
  archiveThrow: false,
  /** `pageSize`, z jakim loader zbudował klucz listy - parytet z komponentem. */
  pageSizes: [] as number[],
  cacheControl: [] as string[],
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => "https://nes.eu/blog" }));

// Atrapa CZĄSTKOWA: `resolvePostsPerPage` biegnie PRAWDZIWE, bo to ono
// decyduje o kluczu listy, a rozjazd tego klucza z komponentem kosztuje drugi
// fetch po hydratacji.
vi.mock("@/lib/queries/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/public")>()),
  blogArchiveQueryOptions: (params: { page: number; pageSize: number }) => {
    h.pageSizes.push(params.pageSize);
    return {
      queryKey: ["public", "blog", "archive", params] as const,
      queryFn: () => {
        if (h.archiveThrow) return Promise.reject(new Error("test: archiwum bloga niedostępne"));
        if (h.archiveDelayMs > 0) {
          return new Promise((resolve) => setTimeout(() => resolve(h.archive), h.archiveDelayMs));
        }
        return Promise.resolve(h.archive);
      },
    };
  },
}));

vi.mock("@/lib/useSiteSetting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"] as const,
    queryFn: () => {
      if (h.settingsThrow) return Promise.reject(new Error("test: ustawienia niedostępne"));
      if (h.settingsDelayMs > 0) {
        return new Promise((resolve) => setTimeout(() => resolve(h.settings), h.settingsDelayMs));
      }
      return Promise.resolve(h.settings);
    },
  },
}));

import { QueryClient } from "@tanstack/react-query";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { BLOG_PAGE_SIZE } from "@/lib/queries/public";
import { Route as BlogRoute } from "@/routes/blog.index";

const NO_STORE = "private, no-store";
const CONTENT = contentCacheControl();

interface BlogLoaderData {
  readonly page: number;
  readonly total: number;
  readonly coverPreload: unknown;
}

type Loader = (ctx: {
  context: { queryClient: QueryClient };
  deps: { page: number };
}) => Promise<BlogLoaderData>;

function runLoader(page = 1): Promise<BlogLoaderData> {
  const loader = (BlogRoute as unknown as { options: { loader: Loader } }).options.loader;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return loader({ context: { queryClient }, deps: { page } });
}

/** Przestaw JEDEN przebieg na RENDER SERWEROWY - patrz nagłówek pliku. */
function renderOnServer(): void {
  vi.stubGlobal("document", undefined);
}

const ARCHIVE = {
  posts: [
    { id: "p1", slug: "pkb-2026", cover_image_url: null },
    { id: "p2", slug: "inflacja-2026", cover_image_url: null },
  ],
  total: 2,
  page: 1,
  pageSize: BLOG_PAGE_SIZE,
};

beforeEach(() => {
  h.settings = { reading: { posts_per_page: 7 } };
  h.settingsDelayMs = 0;
  h.settingsThrow = false;
  h.archive = ARCHIVE;
  h.archiveDelayMs = 0;
  h.archiveThrow = false;
  h.pageSizes = [];
  h.cacheControl = [];
  h.linkHeaders = [];
});

afterEach(() => {
  // Stub środowiska nie może przeciekać na kolejny przypadek.
  vi.unstubAllGlobals();
});

describe("/blog - odporność loadera", () => {
  it("czysty odczyt zostaje przy polityce treści i niesie rozmiar strony z ustawień", async () => {
    const data = await runLoader();

    expect(data.total).toBe(2);
    expect(h.pageSizes).toEqual([7]);
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("BLIP ODCZYTU LISTY degraduje do 200 `no-store`, a nie do HTTP 500", async () => {
    h.archiveThrow = true;
    const data = await runLoader();

    expect(data.total).toBe(0);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("NAWIGACJA SPA: POWOLNE ustawienia NIE degradują - loader czeka i oddaje dane", async () => {
    // Faza pierwsza ma 500 ms. Tu odpowiedź przychodzi PÓŹNIEJ, ale jest
    // POPRAWNA, więc przy nawigacji po stronie klienta nie ma prawa zepchnąć
    // archiwum na `BLOG_PAGE_SIZE` i `no-store`: rozjazd rozmiaru strony
    // kosztowałby drugi fetch po hydratacji, a nagłówek `no-store` - pełny
    // render dla każdego kolejnego czytelnika.
    //
    // BEZ `renderOnServer()` z premedytacją - happy-dom JEST przeglądarką.
    h.settingsDelayMs = 700;
    const data = await runLoader();

    expect(h.pageSizes, "budżet zadziałał w przeglądarce - to jest naprawiany defekt").toEqual([7]);
    expect(data.total).toBe(2);
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("NAWIGACJA SPA: POWOLNA lista NIE zasiewa pustego archiwum", async () => {
    // SEDNO. Po przekroczeniu `BLOG_LOADER_BUDGET_MS` loader sieje PUSTĄ listę
    // i zwraca `total: 0` - a ten wynik jest niezmienny, więc czytelnik
    // zostawał z pustym archiwum aż do kolejnej nawigacji albo przeładowania.
    h.archiveDelayMs = 4_500;
    const data = await runLoader();

    expect(data.total).toBe(2);
    expect(h.cacheControl).toEqual([CONTENT]);
  });

  it("KONTROLA POZYTYWNA: to samo opóźnienie listy NA SERWERZE degraduje", async () => {
    // Bez tej pary przypadek wyżej dowodziłby tylko tego, że 4 500 ms się
    // mieści - różnicę robi ŚRODOWISKO, nie długość opóźnienia. Bez stubu
    // `document` ten przebieg poszedłby ścieżką przeglądarki, czyli po prostu
    // by poczekał, i „zielony" wynik nie mówiłby nic o kontrakcie SSR.
    renderOnServer();
    h.archiveDelayMs = 4_500;
    const started = Date.now();
    const data = await runLoader();

    expect(data.total).toBe(0);
    expect(h.cacheControl).toEqual([NO_STORE]);
    // Budżet trasy (`BLOG_LOADER_BUDGET_MS` = 4 000 ms), a nie watchdog SSR
    // (5 000 ms) i nie pełne 4 500 ms odpowiedzi.
    expect(Date.now() - started).toBeLessThan(4_400);
  });

  it("blip samych USTAWIEŃ zdejmuje nagłówek wspólny, ale zostawia wpisy", async () => {
    // Ustawienia dają wyłącznie rozmiar strony, więc ich brak nie kasuje
    // treści - ale render na domyślce z kodu nie jest prawdą tenanta i nie
    // wolno go rozdać kolejnym czytelnikom z brzegu.
    h.settingsThrow = true;
    const data = await runLoader();

    expect(h.pageSizes).toEqual([BLOG_PAGE_SIZE]);
    expect(data.total).toBe(2);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });
});
