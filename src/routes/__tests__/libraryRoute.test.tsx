// Trasa PUBLICZNA `/library` - biblioteka materiałów członkowskich.
// Do dziś: 0 z 41 linii.
//
// CO DOWODZI TEN PLIK.
//
// Ta strona jest zarazem powierzchnią SPRZEDAŻOWĄ (teaser z kłódką ma
// przekonać niezalogowanego do wejścia na `/pricing`) i powierzchnią
// DOSTĘPOWĄ (zalogowany członek pobiera plik). Render samego komponentu mija
// dwie warstwy, w których to się rozstrzyga: loader (czy siatka kart jest
// w HTML z serwera, więc widoczna dla crawlera i bez przeskoku układu) oraz
// `head()`, który biegnie POZA drzewem Reacta i bierze język z ADRESU.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. METADANE SĄ PUBLICZNE, PLIK NIE JEST. Karta pokazuje tytuł, rodzaj
//      i rozmiar, ale ścieżka do pliku NIE opuszcza bazy - pobranie idzie
//      przez server fn z bramką rangi. Przycisk „Pobierz" pokazany komuś,
//      kto nie ma warstwy, to obietnica, którą baza i tak odrzuci.
//   2. BRAMKA RANGI JEST WIDOCZNA, NIE UKRYTA. Materiał powyżej warstwy
//      czytelnika prowadzi na `/pricing`, a nie na martwy przycisk.
//   3. AWARIA ODCZYTU NIE MOŻE WYGLĄDAĆ JAK PUSTA BIBLIOTEKA. Trzy stany
//      (ładowanie / błąd / pustka) mają trzy różne zdania.
//   4. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH.
//   5. MATERIAŁ INNEGO OBSZARU ROBOCZEGO NIE POJAWIA SIĘ NA TYM HOŚCIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SERWEROWEJ STRONY POBRANIA (`authorize_resource_download`, podpisany URL,
//   zapis do `resource_downloads`): to kontrakt `resources.functions.ts`
//   i pgTAP, nie trasy. Tutaj server fn jest ATRAPĄ i przedmiotem dowodu jest
//   WYŁĄCZNIE to, co trasa jej podaje i co robi z każdą odpowiedzią.
// - PARYTETU SŁOWNIKA PL/EN: `src/lib/i18n-library.ts` ma go wspólnie
//   z bramkami `check:i18n-parity`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `member_resources` ze WSZYSTKICH obszarów roboczych. */
  resources: [] as Record<string, unknown>[],
  /** Tenant PRZEGLĄDANEJ domeny - atrapa polityki `public_tenant_id()`. */
  tenantId: "tenant-a",
  /** `true` = odczyt listy materiałów pada (blip backendu). */
  broken: false,
  /** Zalogowany użytkownik albo `null` (gość ma osobną ścieżkę w UI). */
  userId: null as string | null,
  /** Warstwa zwracana przez RPC `current_membership_tier`. */
  currentTier: null as Record<string, unknown> | null,
  /** Ładunki, jakie server fn pobrania dostała od trasy. */
  downloadPayloads: [] as unknown[],
  /** Odpowiedź atrapy server fn - kolejno dla każdego wywołania. */
  downloadResults: [] as unknown[],
  /** `true` = server fn rzuca (sieć padła w trakcie pobierania). */
  downloadThrows: false,
  /** Wywołania `window.open` - dowód, że podpisany URL trafia do przeglądarki. */
  opened: [] as string[],
  /** Komunikaty błędów pokazane przez `toast.error`. */
  errorToasts: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/library",
  /** Etykiety odczytów W KOLEJNOŚCI - podstawa pomiaru round-tripów. */
  reads: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  stub.setResponse("member_resources", () => {
    h.reads.push("member_resources");
    if (h.broken) return fail("test: tabela member_resources niedostepna");
    // Polityka publiczna: tylko wiersze tenanta przeglądanej domeny.
    return ok(h.resources.filter((row) => row.tenant_id === h.tenantId));
  });
  return {
    supabase: {
      from: stub.from,
      rpc: async () => ({ data: h.currentTier === null ? [] : [h.currentTier], error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.userId === null ? null : { user: { id: h.userId } },
    user: h.userId === null ? null : { id: h.userId },
    roles: [],
    tenantId: null,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));

// Atrapa `useServerFn` oddaje samą funkcję, więc atrapa modułu serwerowego
// niżej jest jednocześnie tym, co trasa wywoła. Reszta pakietu MUSI zostać
// prawdziwa - importują ją moduły `*.functions.ts` w grafie tego testu.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

vi.mock("@/lib/billing/resources.functions", () => ({
  downloadMemberResource: async ({ data }: { data: unknown }) => {
    h.downloadPayloads.push(data);
    if (h.downloadThrows) throw new Error("test: siec padla w trakcie pobierania");
    return h.downloadResults.length > 1 ? h.downloadResults.shift() : h.downloadResults[0];
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => void h.errorToasts.push(message),
    success: () => {},
  },
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

import "@/test/i18nReal";
import { QueryClient } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead } from "@/test/routeHarness";
import type { RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as LibraryRoute } from "@/routes/library";

const PATH = "/library";
const RESOURCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// ── fixtures (RODO: wszystkie tytuły i opisy są ZMYŚLONE) ───────────────────

function resource(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RESOURCE_ID,
    tenant_id: "tenant-a",
    title_pl: "Raport o zielonym wodorze",
    title_en: "Green hydrogen report",
    description_pl: "Przegląd projektów wodorowych w Europie Środkowej.",
    description_en: "A review of hydrogen projects in Central Europe.",
    category: "report",
    file_name: "raport.pdf",
    file_size: 2_097_152,
    mime_type: "application/pdf",
    min_tier_rank: 0,
    download_count: 0,
    created_at: "2026-05-01T09:00:00.000Z",
    ...patch,
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function mount(entry = PATH, queryClient?: QueryClient) {
  return renderRoute({ route: LibraryRoute, path: PATH, initialEntry: entry, queryClient });
}

/** Karta materiału o danym tytule - `<li>`, w którym leży ten nagłówek. */
function resourceCard(title: string): HTMLElement {
  const card = screen.getByText(title).closest("li");
  if (!(card instanceof HTMLElement)) throw new Error(`test: brak karty "${title}"`);
  return card;
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
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

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.resources = [resource()];
  h.tenantId = "tenant-a";
  h.broken = false;
  h.userId = null;
  h.currentTier = null;
  h.downloadPayloads = [];
  h.downloadResults = [{ ok: true, url: "https://signed.test/raport.pdf" }];
  h.downloadThrows = false;
  h.opened = [];
  h.errorToasts = [];
  h.requestUrl = "https://nes.example.org/library";
  h.reads = [];
  vi.spyOn(window, "open").mockImplementation((url) => {
    h.opened.push(String(url));
    return null;
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /library - karta materiału", () => {
  it("pokazuje tytuł, opis, rodzaj i rozmiar pliku", async () => {
    // Rozmiar i rodzaj są jedyną informacją o tym, co czytelnik pobiera.
    // Bez nich decyzja „klikam" jest podejmowana w ciemno.
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: "Biblioteka materiałów" }),
    ).toBeInTheDocument();
    const card = resourceCard("Raport o zielonym wodorze");
    expect(
      within(card).getByText("Przegląd projektów wodorowych w Europie Środkowej."),
    ).toBeInTheDocument();
    expect(within(card).getByText("Raport")).toBeInTheDocument();
    expect(within(card).getByText("2.0 MB")).toBeInTheDocument();
  });

  it("materiał bez rozmiaru nie pokazuje „0 B” ani pustego nawiasu", async () => {
    // `file_size` jest nullowalne (materiał wgrany linkiem). Zero bajtów na
    // karcie to informacja nieprawdziwa.
    h.resources = [resource({ file_size: null })];
    await mount();

    expect(resourceCard("Raport o zielonym wodorze").textContent).not.toContain("0 B");
  });

  it("licznik pobrań pojawia się dopiero, gdy ktoś pobrał, i ma polską formę", async () => {
    h.resources = [resource({ download_count: 3 })];
    await mount();
    expect(resourceCard("Raport o zielonym wodorze").textContent).toContain("3 pobrania");
    cleanup();

    h.resources = [resource({ download_count: 0 })];
    await mount(PATH, freshClient());
    expect(resourceCard("Raport o zielonym wodorze").textContent).not.toMatch(/pobrani[ae]/);
  });

  it("po angielsku bierze angielski tytuł, opis i etykietę rodzaju", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Members' library" })).toBeInTheDocument();
    const card = resourceCard("Green hydrogen report");
    expect(
      within(card).getByText("A review of hydrogen projects in Central Europe."),
    ).toBeInTheDocument();
    expect(within(card).getByText("Report")).toBeInTheDocument();
    expect(screen.queryByText("Raport o zielonym wodorze")).not.toBeInTheDocument();
  });

  it("materiał bez tłumaczenia tytułu spada na drugi język, a nie na pustkę", async () => {
    // Redakcja tłumaczy materiały stopniowo. Karta bez nagłówka jest nie do
    // kliknięcia i nie do przeczytania.
    await i18n.changeLanguage("en");
    h.resources = [resource({ title_en: "" })];
    await mount();

    expect(screen.getByText("Raport o zielonym wodorze")).toBeInTheDocument();
  });

  it("nieznany rodzaj materiału nie wywraca karty ani nie gubi ikony", async () => {
    // `category` jest kolumną tekstową - redakcja może wpisać wartość,
    // której mapa ikon nie zna. Karta musi się wtedy wyrenderować.
    h.resources = [resource({ category: "nieznany_rodzaj" })];
    await mount();

    expect(resourceCard("Raport o zielonym wodorze")).toBeInTheDocument();
  });

  it("nie zostawia biblioteki z wadami dostępności", async () => {
    h.userId = "user-1";
    h.currentTier = { key: "member", rank: 2 };
    await mount();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(await screen.findByRole("list").then((el) => el));
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /library - trzy różne prawdy: pustka, błąd, treść", () => {
  it("pusta biblioteka daje komunikat redakcyjny, a nie pustą siatkę", async () => {
    h.resources = [];
    await mount();

    expect(screen.getByText("Nie ma jeszcze żadnych materiałów.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Biblioteka materiałów" }),
    ).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.resources = [];
    await mount();

    expect(screen.getByText("No materials yet.")).toBeInTheDocument();
  });

  it("awaria odczytu mówi „nie udało się”, a NIE „nie ma materiałów”", async () => {
    // Loader łapie błąd (`.catch(() => undefined)`), więc trasa wychodzi
    // z HTTP 200 - ale komponent MUSI odróżnić awarię od pustki, bo inaczej
    // czytelnik odchodzi w przekonaniu, że biblioteka jest pusta.
    h.broken = true;
    await mount();

    expect(await screen.findByText("Nie udało się wczytać biblioteki.")).toBeInTheDocument();
    expect(screen.queryByText("Nie ma jeszcze żadnych materiałów.")).toBeNull();
  });

  it("po angielsku komunikat awarii też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.broken = true;
    await mount();

    expect(await screen.findByText("Could not load the library.")).toBeInTheDocument();
  });

  it("awaria odczytu NIE wywraca trasy - nagłówek strony zostaje", async () => {
    // To sedno `.catch(() => undefined)` w loaderze: gołe `ensureQueryData`
    // zamieniłoby blip bazy w HTTP 500, a wtedy crawler traktuje stronę jak
    // awarię serwera i wypada ona z indeksu.
    h.broken = true;
    await mount();

    expect(
      screen.getByRole("heading", { level: 1, name: "Biblioteka materiałów" }),
    ).toBeInTheDocument();
  });
});

describe("trasa /library - izolacja obszarów roboczych", () => {
  it("materiał innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    // Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`),
    // więc wiersz obcego tenanta NIE WRACA z odczytu. Trasa musi z tego zrobić
    // pustkę, a nie cudzy raport do pobrania pod naszą domeną.
    h.resources = [resource({ tenant_id: "tenant-b", title_pl: "Raport obcego obszaru" })];
    await mount();

    expect(screen.queryByText("Raport obcego obszaru")).not.toBeInTheDocument();
    expect(screen.getByText("Nie ma jeszcze żadnych materiałów.")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ten sam wiersz na WŁASNYM hoście renderuje się", async () => {
    h.resources = [resource({ tenant_id: "tenant-b", title_pl: "Raport obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mount();

    expect(screen.getByText("Raport obcego obszaru")).toBeInTheDocument();
  });
});

describe("trasa /library - bramka rangi i pobranie", () => {
  it("gość widzi kartę, ale zamiast „Pobierz” dostaje drogę do logowania", async () => {
    // Metadane są publiczne z premedytacją (teaser sprzedażowy), ale przycisk
    // pobrania pokazany gościowi to obietnica, której nie ma jak spełnić.
    await mount();

    const card = resourceCard("Raport o zielonym wodorze");
    expect(within(card).getByRole("link", { name: /Zaloguj się/ })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(within(card).queryByRole("button", { name: "Pobierz" })).toBeNull();
  });

  it("materiał POWYŻEJ warstwy czytelnika prowadzi na /pricing, nie na martwy przycisk", async () => {
    // To jedyne miejsce, w którym bramka rangi jest widoczna dla czytelnika.
    // Przycisk „Pobierz", który baza odrzuci, to najgorszy z możliwych stanów.
    h.userId = "user-1";
    h.currentTier = { key: "free", rank: 0 };
    h.resources = [resource({ min_tier_rank: 3 })];
    await mount();

    const card = resourceCard("Raport o zielonym wodorze");
    expect(within(card).getByRole("link", { name: /Zobacz poziomy członkostwa/ })).toHaveAttribute(
      "href",
      "/pricing",
    );
    expect(within(card).queryByRole("button", { name: "Pobierz" })).toBeNull();
  });

  it("członek z wystarczającą rangą dostaje przycisk i podpisany URL w nowej karcie", async () => {
    h.userId = "user-1";
    h.currentTier = { key: "member", rank: 3 };
    h.resources = [resource({ min_tier_rank: 3 })];
    await mount();

    // `useCurrentTier` biegnie PO montażu (warstwa jest personalizacją, więc
    // celowo nie zasiewa jej loader) - przycisk pojawia się dopiero, gdy ranga
    // dojedzie. Odczyt bez oczekiwania łapałby jeszcze stan zablokowany.
    fireEvent.click(await screen.findByRole("button", { name: "Pobierz" }));

    await waitFor(() => expect(h.opened).toEqual(["https://signed.test/raport.pdf"]));
    // Trasa podaje WYŁĄCZNIE identyfikator materiału - ścieżka pliku nigdy
    // nie opuszcza bazy, więc nie ma czego podmienić po stronie klienta.
    expect(h.downloadPayloads).toEqual([{ resourceId: RESOURCE_ID }]);
  });

  it("odmowa rangi z serwera daje komunikat o warstwie, a nie ogólny błąd", async () => {
    // Dwa różne kody z server fn to dwa różne zdania: „twoja warstwa nie
    // obejmuje" kieruje na cennik, „nie udało się" prosi o ponowienie.
    h.userId = "user-1";
    h.currentTier = { key: "member", rank: 3 };
    h.downloadResults = [{ ok: false, error: "tier_required" }];
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Pobierz" }));

    await waitFor(() =>
      expect(h.errorToasts).toEqual(["Twój poziom członkostwa nie obejmuje tego materiału."]),
    );
    expect(h.opened).toEqual([]);
  });

  it("inny kod błędu daje komunikat ogólny, nie zdanie o warstwie", async () => {
    h.userId = "user-1";
    h.currentTier = { key: "member", rank: 3 };
    h.downloadResults = [{ ok: false, error: "not_found" }];
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Pobierz" }));

    await waitFor(() =>
      expect(h.errorToasts).toEqual(["Nie udało się przygotować pliku. Spróbuj ponownie."]),
    );
  });

  it("wywrotka sieci w trakcie pobierania NIE blokuje przycisku na zawsze", async () => {
    // `finally { setBusy(false) }` jest tu jedyną rzeczą, która oddaje
    // przycisk czytelnikowi. Bez niej jedna nieudana próba kończy sesję.
    h.userId = "user-1";
    h.currentTier = { key: "member", rank: 3 };
    h.downloadThrows = true;
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Pobierz" }));

    await waitFor(() =>
      expect(h.errorToasts).toEqual(["Nie udało się przygotować pliku. Spróbuj ponownie."]),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Pobierz" })).not.toBeDisabled());
  });

  it("gość dostaje na górze strony podpowiedź o logowaniu, zalogowany już nie", async () => {
    await mount();
    expect(screen.getAllByText("Zaloguj się, aby pobierać materiały.").length).toBeGreaterThan(0);
    cleanup();

    h.userId = "user-1";
    h.currentTier = { key: "member", rank: 3 };
    await mount(PATH, freshClient());
    expect(screen.queryByText("Zaloguj się, aby pobierać materiały.")).toBeNull();
  });
});

describe("trasa /library - nagłówek dokumentu", () => {
  it("po polsku niesie polski tytuł z marką, krótki og:title i znacznik języka", () => {
    // Marka w tytule karty przeglądarki/SERP, `og:title` zostaje krótki -
    // to świadome rozdzielenie `documentTitle` i `title` w `buildContentHead`.
    const head = routeHead(LibraryRoute);

    expect(headTitle(head)).toBe("Biblioteka materiałów - New European Strategies");
    expect(metaContent(head, "property", "og:title")).toBe("Biblioteka materiałów");
    expect(metaContent(head, "name", "description")).toBe(
      "Raporty, briefingi i dane dla członków New European Strategies.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", () => {
    h.requestUrl = "https://nes.example.org/en/library";
    const head = routeHead(LibraryRoute);

    expect(headTitle(head)).toBe("Members' library - New European Strategies");
    expect(metaContent(head, "property", "og:title")).toBe("Members' library");
    expect(metaContent(head, "name", "description")).toBe(
      "Reports, briefings and data for New European Strategies members.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("kanoniczny bierze adres z żądania, a pusty adres spada na /library", () => {
    const withUrl = routeHead(LibraryRoute);
    expect((withUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(
      "https://nes.example.org/library",
    );

    h.requestUrl = "";
    const noUrl = routeHead(LibraryRoute);
    expect((noUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(PATH);
  });

  it("NIE wyłącza biblioteki z indeksu - teaser jest powierzchnią sprzedażową", () => {
    // Asercja o BRAKU wpisu. `noindex` dopisany tu „bo to strona dla członków"
    // wyciąłby z wyszukiwarki cały kanał pozyskania - a plik i tak jest za
    // bramką rangi, więc nie ma czego chronić metatagiem.
    const robots = (routeHead(LibraryRoute).meta ?? []).filter((e) => e.name === "robots");

    expect(robots).toEqual([]);
  });
});

// ── LICZBA ZAPYTAŃ NA PIERWSZYM WCZYTANIU (zapadka) ─────────────────────────
//
// POMIAR, NIE OPINIA. Loader zasiewa `["library-resources"]`, więc siatka kart
// jest w HTML z serwera. Zasiew ma jednak wartość tylko wtedy, gdy dane są
// PO hydratacji jeszcze świeże - inaczej `useQuery` pobiera tę samą listę
// drugi raz zaraz po montażu i loader płaci za nic (dokładnie ten defekt
// zmierzono na `/polls`). Zapadka pilnuje więc jednej rzeczy: lista schodzi
// z serwera i NIE jest ponawiana z przeglądarki.
//
// CO ZOSTAJE KLIENCKIE I DLACZEGO. `useCurrentTier` (RPC
// `current_membership_tier`) NIE wchodzi do loadera: to czysta
// PERSONALIZACJA, a dokument `/library` idzie do cache'a brzegowego, więc
// zasiew rangi wysłałby każdemu kolejnemu czytelnikowi warstwę pierwszego.
// Metadane są publiczne z premedytacją, ranga nie jest.
describe("trasa /library - zapadka na liczbie odczytów listy", () => {
  it("loader zasiewa listę materiałów - siatka kart jest w HTML z serwera", async () => {
    const queryClient = freshClient();
    const loader: unknown = LibraryRoute.options.loader;
    if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
    await (loader as (ctx: { context: { queryClient: QueryClient } }) => Promise<unknown>)({
      context: { queryClient },
    });

    expect(h.reads).toEqual(["member_resources"]);
    expect(queryClient.getQueryData(["library-resources"])).toBeDefined();
  });

  it("po hydratacji NIE pobiera tej samej listy drugi raz", async () => {
    // Każdy ponowny odczyt tu to round-trip z pełnym opóźnieniem sieci
    // czytelnika za dane, które właśnie przyjechały w dokumencie.
    const queryClient = freshClient();
    const loader: unknown = LibraryRoute.options.loader;
    if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
    await (loader as (ctx: { context: { queryClient: QueryClient } }) => Promise<unknown>)({
      context: { queryClient },
    });
    const afterLoader = [...h.reads];

    const view = await mount(PATH, queryClient);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    const clientReads = h.reads.slice(afterLoader.length);
    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).toEqual([]);
  });

  it("KONTROLA DODATNIA: bez zasiewu lista JEST pobierana z przeglądarki", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby atrapa
    // odczytu w ogóle nie liczyła wywołań - albo gdyby komponent przestał
    // czytać listę.
    const view = await mount(PATH, freshClient());
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads).toContain("member_resources");
  });
});
