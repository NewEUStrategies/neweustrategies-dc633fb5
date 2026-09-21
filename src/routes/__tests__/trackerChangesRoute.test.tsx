// Trasa PUBLICZNA `/tracker/changes` - globalny feed „co się zmieniło".
// Do dziś: 0 z 35 linii.
//
// CO DOWODZI TEN PLIK.
//
// To najgęstsza treściowo strona trackera: wpisy osi czasu ze WSZYSTKICH
// opublikowanych dossier, pogrupowane po dniach. Render samego komponentu mija
// warstwę, w której to się rozstrzyga - `head()` biegnie POZA drzewem Reacta
// i bierze język z ADRESU, a treść w wyjściu serwera istnieje wyłącznie
// dlatego, że loader rozgrzał DOKŁADNIE ten klucz, który czyta `useQuery`.
//
// ── DECYZJA N4 DLA TEJ TRASY: LOADER MUSI BYĆ (i jest) ──────────────────────
//
// Audyt wymienił `/tracker/changes` jako trasę BEZ loadera i miał rację co do
// stanu zastanego: `useQuery` nie startuje fetcha na serwerze, więc całe ciało
// tej strony schodziło do crawlera jako `t("tracker.loading")`, a powłoka bez
// treści wchodziła do NES Edge Cache na do 24 h. Loader (`loadResilient` +
// `resilientCacheControl`) jest tu od naprawy N4 z 2026-09-02.
//
// UZASADNIENIE, DLACZEGO TA TRASA NIE MOGŁA ZOSTAĆ BEZ LOADERA: DOKŁADNIE te
// same wpisy publikujemy już crawlerom kanałem `/tracker/rss.xml`
// (`lib/tracker/feed.ts`). Wersja HTML oddająca pustą powłokę tam, gdzie RSS
// oddaje pełne pozycje, nie jest decyzją produktową, tylko przeoczeniem -
// a feed to JEDNO zapytanie (bez kaskady explorera), więc SSR kosztuje jeden
// round-trip.
//
// Rozważona i ODRZUCONA alternatywa „dane przyjdą z loadera trasy nadrzędnej":
// sprawdzone w `routeTree.gen.ts` - pliku `tracker.tsx` NIE MA, rodzicem
// `/tracker/*` jest `__root`, więc nie ma czyich danych filtrować.
//
// BRAK `notFound()` JEST ŚWIADOMY: pusty feed to legalny stan (nowy tenant,
// dossier bez ani jednego wpisu osi czasu) z własnym komunikatem
// `tracker.changes.empty`, a nie brakujący adres.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/tracker/queries.ts` biegnie tu PRAWDZIWY (atrapowany jest tylko
//   klient PostgREST), więc klucz cache, embed `!inner` i odsiew statusu są
//   tymi z produkcji.
// - KONTRAKTU NAGŁÓWKA `x-tenant-host`: ma własny plik
//   `src/integrations/supabase/__tests__/tenantHostFetch.test.ts`. Tutaj
//   dowodzimy SKUTKU, którego tamten plik nie widzi: wpis, który nie wrócił
//   z odczytu, zamienia się w komunikat pustki, a nie w cudze dossier.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, render, fireEvent, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `eu_policy_updates` (z embedem dossier) ze WSZYSTKICH obszarów. */
  updates: [] as Record<string, unknown>[],
  /**
   * Tenant PRZEGLĄDANEJ domeny. Atrapa odgrywa rolę polityki
   * `tenant_id = public_tenant_id()` - trasa własnego porównania tenantów nie
   * ma i mieć nie powinna, więc modelujemy SKUTEK.
   */
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  /** `true` = odczyt feedu pada (blip backendu). */
  broken: false,
  /** Kolejne wartości `limit`, z jakimi produkcja weszła w odczyt. */
  limits: [] as unknown[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/tracker/changes",
  /** Nagłówki `Cache-Control` ustawione przez loader. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  stub.setResponse("eu_policy_updates", (chain) => {
    const limit = chain.argsOf("limit")?.[0];
    h.limits.push(limit);
    if (h.broken) return fail("test: tabela eu_policy_updates niedostepna");
    const visible = h.updates.filter((row) => row.tenant_id === h.tenantId);
    return ok(typeof limit === "number" ? visible.slice(0, limit) : visible);
  });
  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

// `<Link>` czyta kontekst routera i wywraca się bez `RouterProvider`. Blok
// „wyjście serwera" renderuje KOMPONENT trasy poza routerem (bo tylko tak widać
// HTML serwera), więc podmieniamy JEDNO wiązanie na wspólny stub-anchor;
// `createFileRoute`, `RouterProvider` i cała reszta modułu zostają prawdziwe,
// więc `renderRoute` nadal montuje trasę przez prawdziwy router.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// Ekran awarii trasy: `FriendlyErrorPage` pod nim woła `useRouter()`, więc bez
// `RouterProvider` nie da się go wyrenderować - a przedmiotem dowodu jest tu
// WYŁĄCZNIE to, JAKI TYTUŁ trasa mu podaje (do 2026-09-02 był to polski
// literał, widziany także przez czytelnika wersji angielskiej). Marker echuje
// ten prop; sam ekran ma własny plik testowy.
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: (props: { title?: string }) => (
    <div data-testid="route-error">{String(props.title)}</div>
  ),
}));

import "@/test/i18nReal";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { recentUpdatesQueryOptions } from "@/lib/tracker/queries";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as ChangesRoute } from "@/routes/tracker.changes";

const PATH = "/tracker/changes";
// Identyfikatory obszarów roboczych. Literały MUSZĄ też stać w fabryce
// `vi.hoisted` wyżej: vitest wynosi ją nad importy i nad te deklaracje, więc
// odwołanie do stałej z tego miejsca padłoby na „cannot access before
// initialization".
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** Ten sam literał, którym trasa woła loader i inicjuje stan komponentu. */
const PAGE = 40;

// ── fixtures (RODO: wszystkie dossier i noty są ZMYŚLONE) ───────────────────

function update(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "u1",
    tenant_id: TENANT_A,
    note_pl: "Rada przyjęła stanowisko ogólne.",
    note_en: "The Council adopted its general approach.",
    stage_from: "parliament",
    stage_to: "council",
    source_url: "https://example.org/dokument",
    happened_on: "2026-07-01",
    created_at: "2026-07-01T10:00:00.000Z",
    eu_policy_items: {
      slug: "akt-o-rynkach-danych",
      title_pl: "Akt o rynkach danych",
      title_en: "Data Markets Act",
      policy_area: "digital",
      status: "published",
    },
    ...patch,
  };
}

/** N wpisów o różnych identyfikatorach - do dowodu „pokaż więcej". */
function manyUpdates(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    update({ id: `u${index}`, happened_on: "2026-07-01" }),
  );
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({ route: ChangesRoute, path: PATH, initialEntry: PATH, queryClient });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
// `httpEquiv` w unii kluczy: `head()` tych tras emituje nie tylko
// `name`/`property`, ale też `http-equiv` (np. `content-language`),
// a helper skopiowany z innego testu tego klucza nie znał.
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/** Komponent trasy - STRAŻNIK, nie rzutowanie. */
function changesComponent(): () => ReactElement {
  const component: unknown = ChangesRoute.options.component;
  if (typeof component !== "function") throw new Error("test: trasa nie ma komponentu");
  return component as () => ReactElement;
}

type ChangesLoader = (ctx: {
  context: { queryClient: QueryClient };
}) => Promise<{ degraded: boolean }>;

function changesLoader(): ChangesLoader {
  const loader: unknown = ChangesRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as ChangesLoader;
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Wyjście SERWERA komponentu trasy - `render()` z RTL tego nie pokaże, bo
 *  efekty montowania (start fetcha) wykonują się przed powrotem z `render`. */
function ssr(queryClient: QueryClient): string {
  const Component = changesComponent();
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <Component />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.updates = [update()];
  h.tenantId = TENANT_A;
  h.broken = false;
  h.limits = [];
  h.requestUrl = "https://nes.example.org/tracker/changes";
  h.cacheControl = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /tracker/changes - treść feedu", () => {
  it("pokazuje notę, plakietkę zmiany etapu i link do dossier", async () => {
    // To trzy niezależne rzeczy: nota (treść), plakietka (co się stało) i link
    // (droga dalej). Wypadnięcie linku zamienia feed w listę bez wyjścia.
    await mount();

    expect(await screen.findByText("Rada przyjęła stanowisko ogólne.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Akt o rynkach danych" })).toHaveAttribute(
      "href",
      "/tracker/akt-o-rynkach-danych",
    );
    expect(screen.getByText("Zmiana etapu: Parlament → Rada")).toBeInTheDocument();
  });

  it("wpis bez etapu wyjściowego mówi ETAP, a nie zmianę z niczego", async () => {
    // `stage_from: null` to pierwszy wpis dossier. Komunikat „zmiana z null"
    // byłby nieprawdą, więc słownik ma na to osobny klucz.
    h.updates = [update({ stage_from: null })];
    await mount();

    expect(await screen.findByText("Etap: Rada")).toBeInTheDocument();
  });

  it("grupuje wpisy po dniu i nazywa dzisiejszy dzień słowem, nie datą", async () => {
    // Grupy dzienne są całą nawigacją tego feedu. „Dzisiaj"/„Wczoraj" to
    // jedyne dwie etykiety, które nie są datą - i jedyne, które mogą się
    // rozjechać ze strefą czasową.
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    h.updates = [
      update({ id: "u-today", happened_on: today }),
      update({ id: "u-yesterday", happened_on: yesterday }),
      update({ id: "u-old", happened_on: "2026-07-01" }),
    ];
    await mount();

    expect(await screen.findByRole("heading", { level: 2, name: "Dzisiaj" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Wczoraj" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "1 lipca 2026" })).toBeInTheDocument();
  });

  it("wpis z niepoprawną datą pokazuje surowy ISO, a nie napis Invalid Date", async () => {
    // Import danych z eur-lex może wstawić datę, której `Date` nie zna. Napis
    // „Invalid Date" w nagłówku grupy to widoczna awaria; surowy ISO nie jest.
    h.updates = [update({ happened_on: "nie-data" })];
    await mount();

    expect(await screen.findByRole("heading", { level: 2, name: "nie-data" })).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("po angielsku bierze angielską notę i angielski tytuł dossier", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(
      await screen.findByText("The Council adopted its general approach."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data Markets Act" })).toBeInTheDocument();
    expect(screen.queryByText("Rada przyjęła stanowisko ogólne.")).not.toBeInTheDocument();
  });

  it("przycisk pokaz-wiecej ROZSZERZA OKNO ODCZYTU, a nie tylko chowa sam siebie", async () => {
    // Przycisk zmienia KLUCZ zapytania (`limit`), więc jego jedyny widoczny
    // skutek to nowy odczyt. Gdyby przestał podnosić `limit`, feed wyglądałby
    // identycznie i kończył się na czterdziestym wpisie na zawsze.
    h.updates = manyUpdates(PAGE * 2);
    await mount();

    const more = await screen.findByRole("button", { name: "Pokaż więcej" });
    fireEvent.click(more);

    await waitFor(() => expect(h.limits).toContain(PAGE * 2));
  });

  it("nie zostawia feedu z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByText("Rada przyjęła stanowisko ogólne.");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /tracker/changes - stan pusty i degradacja", () => {
  it("pusty feed daje komunikat, nie 404 i nie pustą powłokę", async () => {
    h.updates = [];
    await mount();

    expect(await screen.findByText("Brak aktualizacji.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /Co się zmieniło/ })).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.updates = [];
    await mount();

    expect(await screen.findByText("No updates yet.")).toBeInTheDocument();
  });

  it("wpis dossier w statusie szkicu nie wchodzi do publicznego feedu", async () => {
    // Podwójne zabezpieczenie: embed `!inner` odsiewa je w bazie, a warstwa
    // zapytań filtruje jeszcze raz po stronie klienta. Nota o niepublikowanym
    // dossier w publicznym feedzie to wyciek redakcyjny.
    h.updates = [
      update({
        eu_policy_items: {
          slug: "szkic",
          title_pl: "Dossier w przygotowaniu",
          title_en: "Draft file",
          policy_area: "digital",
          status: "draft",
        },
      }),
    ];
    await mount();

    expect(await screen.findByText("Brak aktualizacji.")).toBeInTheDocument();
    expect(screen.queryByText("Dossier w przygotowaniu")).not.toBeInTheDocument();
  });

  it("awaria odczytu NIE wywraca trasy i NIE trafia do cache'a wspólnego", async () => {
    // Gołe `ensureQueryData` zamieniłoby blip bazy w HTTP 500, a wtedy crawler
    // traktuje stronę jak awarię serwera. Zdegradowany render woli pustkę -
    // ale nie wolno mu utrwalić się na brzegu.
    h.broken = true;
    const data = await changesLoader()({ context: { queryClient: freshClient() } });

    expect(data.degraded).toBe(true);
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("czysty render deklaruje politykę treści, nie no-store", async () => {
    const data = await changesLoader()({ context: { queryClient: freshClient() } });

    expect(data.degraded).toBe(false);
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });
});

describe("trasa /tracker/changes - izolacja obszarów roboczych", () => {
  it("wpis innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    // Autorytetem jest polityka publiczna: wiersz obcego tenanta NIE WRACA
    // z odczytu. Ten test pilnuje SKUTKU - komunikat pustki, nie cudze dossier.
    h.updates = [
      update({
        tenant_id: TENANT_B,
        note_pl: "Nota obcego obszaru",
        eu_policy_items: {
          slug: "obce",
          title_pl: "Dossier obcego obszaru",
          title_en: "Foreign file",
          policy_area: "digital",
          status: "published",
        },
      }),
    ];
    await mount();

    expect(await screen.findByText("Brak aktualizacji.")).toBeInTheDocument();
    expect(screen.queryByText("Nota obcego obszaru")).not.toBeInTheDocument();
    expect(screen.queryByText("Dossier obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ten sam wpis na własnym hoście renderuje się", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie izolacja, tylko awaria.
    h.updates = [update({ tenant_id: TENANT_B, note_pl: "Nota obcego obszaru" })];
    h.tenantId = TENANT_B;
    await mount();

    expect(await screen.findByText("Nota obcego obszaru")).toBeInTheDocument();
  });
});

describe("trasa /tracker/changes - nagłówek dokumentu", () => {
  it("po polsku tytuł i opis mówią o trackerze legislacyjnym", async () => {
    const head = routeHead(ChangesRoute);

    expect(headTitle(head)).toBe("Co się zmieniło - tracker legislacyjny UE");
    expect(metaContent(head, "name", "description")).toBe(
      "Najnowsze aktualizacje wszystkich śledzonych dossier legislacyjnych UE.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", async () => {
    // O języku nagłówka rozstrzyga wyłącznie prefiks adresu: `head()` biegnie
    // poza drzewem Reacta i nie wolno mu czytać singletonu i18next, wspólnego
    // dla współbieżnych żądań SSR.
    h.requestUrl = "https://nes.example.org/en/tracker/changes";
    const head = routeHead(ChangesRoute);

    expect(headTitle(head)).toBe("What changed - EU legislative tracker");
    expect(metaContent(head, "name", "description")).toBe(
      "The latest updates across all tracked EU legislative files.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("NIE wyłącza się z indeksu i deklaruje kanoniczny plus hreflang", async () => {
    const head = routeHead(ChangesRoute);

    expect((head.meta ?? []).filter((entry) => entry.name === "robots")).toEqual([]);
    expect((head.links ?? []).find((link) => link.rel === "canonical")?.href).toBe(
      "https://nes.example.org/tracker/changes",
    );
    expect(
      (head.links ?? [])
        .filter((link) => link.rel === "alternate")
        .map((link) => link.hrefLang)
        .sort(),
    ).toEqual(["en", "pl", "x-default"]);
  });
});

// ── WYJŚCIE SERWERA: TREŚĆ, NIE „Wczytywanie..." ────────────────────────────
//
// Blok mierzy HTML, który naprawdę wychodzi z serwera, i ma KONTROLĘ DODATNIĄ
// (ten sam render bez rozgrzanego klucza), bez której „zawiera notę" mogłoby
// przechodzić na dowolnym stringu.

describe("trasa /tracker/changes - wyjście serwera niesie wpisy", () => {
  it("po rozgrzaniu przez loader HTML serwera zawiera notę i tytuł dossier", async () => {
    const queryClient = freshClient();
    await changesLoader()({ context: { queryClient } });

    const html = ssr(queryClient);

    expect(html).toContain("Rada przyjęła stanowisko ogólne.");
    expect(html).toContain("Akt o rynkach danych");
    expect(html).not.toContain("Wczytywanie");
  });

  it("KONTROLA DODATNIA: bez rozgrzania serwer oddaje gałąź ładowania", async () => {
    // To jest stan, który naprawia loader: `useQuery` z `enabled` domyślnym ma
    // na serwerze `isLoading: true`, więc komponent renderuje gałąź ładowania.
    // Gdyby ktoś wyciął loader, poprzedni test zrobi się czerwony, a ten
    // zostanie zielony - i to jest właściwy podział ról.
    const html = ssr(freshClient());

    expect(html).toContain("Wczytywanie");
    expect(html).not.toContain("Rada przyjęła stanowisko ogólne.");
  });

  it("loader i komponent czytają TEN SAM klucz z tym samym oknem", async () => {
    // Rozjazd klucza (inne `limit` w loaderze i w komponencie) daje SSR pod
    // jednym wpisem cache i odczyt kliencki pod innym: treść zeszłaby
    // z serwera i została pobrana PO RAZ DRUGI, bez żadnego błędu.
    expect(recentUpdatesQueryOptions(PAGE).queryKey).toEqual(["tracker", "recent-updates", PAGE]);

    const queryClient = freshClient();
    await changesLoader()({ context: { queryClient } });
    const readsAfterLoader = h.limits.length;
    expect(readsAfterLoader).toBe(1);
    expect(h.limits[0]).toBe(PAGE);

    await mount(queryClient);
    await screen.findByText("Rada przyjęła stanowisko ogólne.");
    expect(h.limits.length, "feed pobrany po raz drugi po hydratacji").toBe(readsAfterLoader);
  });
});

// ── DEFEKT PRZYPIĘTY, NIE NAPRAWIONY ───────────────────────────────────────
//
// Loader ODRÓŻNIA blip backendu od pustego feedu (zwraca `degraded` i zdejmuje
// nagłówek cache'a wspólnego), ale KOMPONENT tego sygnału nie czyta: przy
// padniętej bazie czytelnik dostaje „Brak aktualizacji.", co jest wtedy
// NIEPRAWDĄ i nie mówi mu, że ma ponowić.
//
// DLACZEGO NIE NAPRAWIAM TEGO TUTAJ: naprawa wymaga `Route.useLoaderData()`
// w komponencie, a to odbiera możliwość renderowania komponentu POZA routerem
// - czyli wysadza blok „wyjście serwera" wyżej, który jest jedynym dowodem
// naprawy N4 dla tej trasy. Domknięcie wymaga harnessu renderującego
// serwerowo CAŁE drzewo routera; to osobna praca na `src/test/routeHarness.tsx`.
// Wzorzec docelowy jest już w repo: `/tracker` (indeks) czyta `degraded`
// i renderuje `DegradedDataNotice` zamiast zdania o pustce.

describe("trasa /tracker/changes - zdegradowany feed kłamie o braku aktualizacji", () => {
  it.fails("POWINIEN mówić o awarii sekcji, a nie o braku aktualizacji", async () => {
    h.broken = true;
    await mount();

    expect(await screen.findByText("Ta sekcja chwilowo nie ma danych")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: dziś zdegradowany render pokazuje komunikat pustki", async () => {
    // Bez tego przypadku `it.fails` wyżej przechodziłby też wtedy, gdyby trasa
    // przy awarii nie renderowała NICZEGO - a to inny defekt niż opisany.
    h.broken = true;
    await mount();

    expect(await screen.findByText("Brak aktualizacji.")).toBeInTheDocument();
    expect(screen.queryByText("Ta sekcja chwilowo nie ma danych")).not.toBeInTheDocument();
  });
});

/** `errorComponent` trasy jako komponent - STRAŻNIK, nie rzutowanie. */
function routeErrorComponent(): (props: { error: Error; reset: () => void }) => ReactElement {
  const component: unknown = ChangesRoute.options.errorComponent;
  if (typeof component !== "function") throw new Error("test: trasa nie ma errorComponent");
  return component as (props: { error: Error; reset: () => void }) => ReactElement;
}

describe("trasa /tracker/changes - ekran awarii mówi językiem strony", () => {
  it("po polsku podaje zdanie ze słownika, nie literał z kodu", async () => {
    // Do 2026-09-02 tytuł ekranu awarii był wpisany po polsku na sztywno, więc
    // czytelnik wersji angielskiej dostawał jedyny polski napis na stronie -
    // i nie było tego widać w żadnym teście ani w interfejsie.
    const ErrorComponent = routeErrorComponent();
    render(<ErrorComponent error={new Error("test: awaria")} reset={() => {}} />);

    expect(screen.getByTestId("route-error")).toHaveTextContent(
      "Nie udało się wczytać trackera. Spróbuj ponownie później.",
    );
  });

  it("po angielsku to samo zdanie jest angielskie", async () => {
    await i18n.changeLanguage("en");
    const ErrorComponent = routeErrorComponent();
    render(<ErrorComponent error={new Error("test: awaria")} reset={() => {}} />);

    expect(screen.getByTestId("route-error")).toHaveTextContent(
      "Could not load the tracker. Please try again later.",
    );
  });
});
