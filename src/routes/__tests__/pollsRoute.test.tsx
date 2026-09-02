// Trasa PUBLICZNA `/polls` - ankiety społeczności. Do dziś: 0 z 35 linii.
//
// CO DOWODZI TEN PLIK.
//
// Ta strona ma trzy warstwy, których render samego komponentu nie widzi:
// BRAMKĘ MODUŁU (wyłączone ankiety nie mogą kosztować ani jednego zapytania),
// LOADER (pytania i opcje muszą być w HTML z serwera, a rozkład głosów NIE -
// to anti-anchoring) oraz KANAŁ REALTIME na `poll_votes`, który jest jedynym
// mechanizmem, dzięki któremu słupki rosną bez odświeżania strony.
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. WYŁĄCZONY MODUŁ NIE PYTA O ANKIETY. Loader wychodzi przed odczytem,
//      a widok pokazuje ekran „moduł wyłączony" - inaczej wyłączenie modułu
//      w panelu kosztowałoby zapytanie na każde żądanie.
//   2. WYNIKI SĄ WYŁĄCZNIE KLIENCKIE. Zasianie ich w loaderze zapiekłoby
//      rozkład głosów w cache brzegowym i wysłałoby każdemu czytelnikowi ten
//      sam, cudzy stan `my_vote` - a to jednocześnie zakotwiczenie wyboru
//      i wyciek personalizacji.
//   3. KANAŁ REALTIME ZAMYKA SIĘ PRZY ODMONTOWANIU. Gubiony `removeChannel`
//      nie psuje niczego od razu - dopiero po kilku przejściach między
//      trasami kończy się limit kanałów i przestają przychodzić zdarzenia
//      w CAŁEJ aplikacji.
//   4. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH.
//   5. ANKIETA INNEGO OBSZARU ROBOCZEGO NIE POJAWIA SIĘ NA TYM HOŚCIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/community/publicQueries.ts` biegnie tu PRAWDZIWY (atrapowany jest
//   wyłącznie klient PostgREST), więc klucze cache, filtr `status in
//   (open,closed)` i kształt wyników są tymi z produkcji.
// - RPC `vote_poll` (walidacja opcji, okno czasowe, anti-anchoring po stronie
//   bazy) ma asercje pgTAP; tutaj przedmiotem dowodu jest WYŁĄCZNIE to, co
//   trasa wysyła i co robi z odpowiedzią.
// - BLOKU ANKIETY W TREŚCI WPISU (`PollBlockView`) - to osobna powierzchnia
//   z własnym kanałem `poll-votes-block-<id>`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `polls` ze WSZYSTKICH obszarów roboczych. */
  polls: [] as Record<string, unknown>[],
  /** Wiersze `site_settings` (klucz -> wartość) widoczne publicznie. */
  settings: {} as Record<string, unknown>,
  /** Wyniki zwracane przez RPC `get_poll_results_bulk`. */
  results: [] as Record<string, unknown>[],
  /** Tenant PRZEGLĄDANEJ domeny - atrapa polityki `public_tenant_id()`. */
  tenantId: "tenant-a",
  /** Tabele, których odczyt ma paść (blip backendu). */
  broken: new Set<string>(),
  /** Zalogowany użytkownik albo `null` (gość nie może głosować). */
  userId: null as string | null,
  /**
   * Etykiety odczytów W KOLEJNOŚCI - PODSTAWA POMIARU zapytań (blok N5).
   * Bez tej listy „optymalizacja" byłaby opinią, a nie pomiarem.
   */
  reads: [] as string[],
  /** Argumenty RPC `vote_poll` - dowód, co trasa wysyła do bazy. */
  votes: [] as Record<string, unknown>[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/polls",
  /** Atrapa kanałów realtime - wstrzykiwana z fabryki `vi.mock`. */
  rt: null as unknown,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const { realtimeStub } = await import("@/test/supabase/realtime");
  const stub = supabaseFromStub();
  const rt = realtimeStub();
  h.rt = rt;

  stub.setResponse("site_settings", () => {
    h.reads.push("site_settings");
    if (h.broken.has("site_settings")) return fail("test: tabela site_settings niedostepna");
    return ok(Object.entries(h.settings).map(([key, value]) => ({ key, value })));
  });
  stub.setResponse("polls", () => {
    h.reads.push("polls");
    if (h.broken.has("polls")) return fail("test: tabela polls niedostepna");
    // Polityka publiczna: tylko wiersze tenanta przeglądanej domeny.
    return ok(h.polls.filter((row) => row.tenant_id === h.tenantId));
  });

  return {
    supabase: {
      from: stub.from,
      rpc: async (name: string, args?: Record<string, unknown>) => {
        if (name === "get_poll_results_bulk") {
          h.reads.push("rpc:get_poll_results_bulk");
          if (h.broken.has("get_poll_results_bulk")) {
            return { data: null, error: { message: "test: RPC wynikow niedostepny" } };
          }
          return { data: h.results, error: null };
        }
        if (name === "vote_poll") {
          h.votes.push(args ?? {});
          return {
            data: { visible: true, my_vote: args?.p_option_idx, total: 1, counts: [1, 0] },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      channel: (name: string, config?: Record<string, unknown>) => rt.channel(name, config),
      removeChannel: (channel: Parameters<typeof rt.removeChannel>[0]) => rt.removeChannel(channel),
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

// Bez tej atrapy mapa `site_settings` żyje w module-owym cache TTL i przecieka
// MIĘDZY testami - pomiar liczby zapytań (blok N5) mierzyłby wtedy kolejność
// plików, nie zachowanie trasy.
vi.mock("@/lib/ssrCache", () => ({
  // Przecinek po parametrze typu jest KONIECZNY w `.tsx` - bez niego `<T>`
  // parsuje się jako element JSX i cały plik nie kompiluje.
  edgeTtlCache: async <T,>(_key: string, _ttl: number, fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

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
import type { RealtimeStub } from "@/test/supabase/realtime";
import { COMMUNITY_MODULES_KEY } from "@/lib/community/modulesSettings";
import { Route as PollsRoute } from "@/routes/polls";

const PATH = "/polls";
const POLL_ID = "11111111-1111-4111-8111-111111111111";

/** Atrapa kanałów w kształcie, którego dotykają asercje - STRAŻNIK, nie rzut. */
function rt(): RealtimeStub {
  const stub = h.rt;
  if (!stub || typeof stub !== "object" || !("liveChannels" in stub)) {
    throw new Error("test: atrapa kanalow realtime nie zostala podlaczona");
  }
  return stub as RealtimeStub;
}

// ── fixtures (RODO: wszystkie pytania i opcje są ZMYŚLONE) ──────────────────

function poll(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: POLL_ID,
    tenant_id: "tenant-a",
    question_pl: "Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?",
    question_en: "Should Europe speed up grid expansion?",
    options: [
      { pl: "Tak, natychmiast", en: "Yes, immediately" },
      { pl: "Nie, najpierw magazyny", en: "No, storage first" },
    ],
    status: "open",
    ends_at: null,
    ...patch,
  };
}

function modules(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { [COMMUNITY_MODULES_KEY]: { polls_enabled: true, qa_enabled: true, ...patch } };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({ route: PollsRoute, path: PATH, initialEntry: PATH, queryClient });
}

/** Karta ankiety o danym pytaniu - `<article>`, w którym leży ten nagłówek. */
function pollCard(question: string): HTMLElement {
  const card = screen.getByRole("heading", { level: 2, name: question }).closest("article");
  if (!(card instanceof HTMLElement)) throw new Error(`test: brak karty "${question}"`);
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
  h.polls = [poll()];
  h.settings = modules();
  h.results = [];
  h.tenantId = "tenant-a";
  h.broken = new Set<string>();
  h.userId = null;
  h.reads = [];
  h.votes = [];
  h.requestUrl = "https://nes.example.org/polls";
  rt().reset();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /polls - treść ankiety", () => {
  it("pokazuje pytanie i WSZYSTKIE opcje do wyboru", async () => {
    // Ankieta z brakującą opcją to ankieta z zafałszowanym wynikiem.
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Ankiety" })).toBeInTheDocument();
    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    expect(within(card).getByText("Tak, natychmiast")).toBeInTheDocument();
    expect(within(card).getByText("Nie, najpierw magazyny")).toBeInTheDocument();
  });

  it("po angielsku bierze angielskie pytanie i angielskie opcje", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Polls" })).toBeInTheDocument();
    const card = pollCard("Should Europe speed up grid expansion?");
    expect(within(card).getByText("Yes, immediately")).toBeInTheDocument();
    expect(screen.queryByText("Tak, natychmiast")).not.toBeInTheDocument();
  });

  it("ankieta bez opcji nie wywraca strony (redakcja zapisała szkic)", async () => {
    // `options` jest kolumną jsonb - pusta tablica i wartość nie-tablicowa to
    // realne wejścia. Karta bez opcji jest bezużyteczna, ale nie może zabrać
    // ze sobą całej strony.
    h.polls = [poll({ options: [] }), poll({ id: "p2", options: "nie-tablica" })];
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Ankiety" })).toBeInTheDocument();
  });

  it("ZAMKNIĘTA ankieta jest oznaczona i nie da się w niej zagłosować", async () => {
    // Aktywny przycisk w zamkniętej ankiecie to obietnica, którą RPC odrzuci.
    h.userId = "user-1";
    h.polls = [poll({ status: "closed" })];
    await mount();

    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    expect(within(card).getByText("Ankieta zamknięta")).toBeInTheDocument();
    within(card)
      .getAllByRole("button")
      .forEach((button) => expect(button).toBeDisabled());
  });

  it("gość widzi ankietę i podpowiedź o logowaniu, ale nie może głosować", async () => {
    await mount();

    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    expect(within(card).getByText("Zaloguj się, aby oddać głos.")).toBeInTheDocument();
    within(card)
      .getAllByRole("button")
      .forEach((button) => expect(button).toBeDisabled());
  });

  it("zalogowany oddaje głos przez RPC z NUMEREM opcji, nie z jej treścią", async () => {
    // Indeks opcji jest jedyną rzeczą, którą baza umie zwalidować. Wysłanie
    // etykiety pozwalałoby zagłosować na opcję, której w ankiecie nie ma.
    h.userId = "user-1";
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /Nie, najpierw magazyny/ }));

    await waitFor(() => expect(h.votes).toEqual([{ p_poll_id: POLL_ID, p_option_idx: 1 }]));
  });

  it("nie zostawia strony ankiet z wadami dostępności", async () => {
    h.userId = "user-1";
    h.results = [
      { poll_id: POLL_ID, result: { visible: true, my_vote: 0, total: 5, counts: [3, 2] } },
    ];
    const view = await mount();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /polls - anti-anchoring wyników", () => {
  it("dopóki serwer nie odsłoni wyników, liczb NIE MA na ekranie", async () => {
    // To nie kosmetyka: rozkład głosów pokazany przed zagłosowaniem
    // zakotwicza wybór, więc `visible=false` MUSI chować liczby, a nie
    // pokazywać zer.
    h.results = [
      { poll_id: POLL_ID, result: { visible: false, my_vote: null, total: 0, counts: [] } },
    ];
    await mount();

    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    expect(within(card).getByText("Wyniki zobaczysz po oddaniu głosu.")).toBeInTheDocument();
    // Asercja idzie na SUMĘ GŁOSÓW, nie na „brak jakiejkolwiek cyfry":
    // licznik przy opcji renderuje zastępcze „0% · 0" także w stanie
    // ukrytym, a zera nie zakotwiczają wyboru - w przeciwieństwie do sumy
    // i rozkładu, które tu NIE MOGĄ się pojawić.
    expect(within(card).queryByText(/\d+\s+głos/)).toBeNull();
  });

  it("po odsłonięciu pokazuje sumę głosów w polskiej formie", async () => {
    h.results = [
      { poll_id: POLL_ID, result: { visible: true, my_vote: 0, total: 3, counts: [2, 1] } },
    ];
    await mount();

    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    expect(await within(card).findByText("3 głosy")).toBeInTheDocument();
  });

  it("awaria RPC wyników NIE zabiera pytania ani opcji", async () => {
    // Wyniki są dodatkiem, pytanie jest treścią. Blip RPC nie może zabrać
    // czytelnikowi możliwości oddania głosu.
    h.broken.add("get_poll_results_bulk");
    await mount();

    expect(screen.getByText("Tak, natychmiast")).toBeInTheDocument();
  });
});

describe("trasa /polls - bramka modułu", () => {
  it("wyłączony moduł pokazuje ekran „moduł wyłączony”, a nie pustą listę", async () => {
    h.settings = modules({ polls_enabled: false });
    await mount();

    expect(screen.queryByRole("heading", { level: 1, name: "Ankiety" })).toBeNull();
    expect(
      screen.queryByText("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?"),
    ).toBeNull();
  });

  it("wyłączony moduł NIE KOSZTUJE ani jednego zapytania o ankiety", async () => {
    // Loader wychodzi PRZED odczytem, a `useQuery` ma `enabled: false`.
    // Bez tego wyłączenie modułu w panelu i tak płaciłoby za select na
    // każde żądanie - na trasie, której nikt nie widzi.
    h.settings = modules({ polls_enabled: false });
    await mount();

    expect(h.reads.filter((label) => label === "polls")).toEqual([]);
    expect(h.reads.filter((label) => label === "rpc:get_poll_results_bulk")).toEqual([]);
  });

  it("KONTROLA DODATNIA: włączony moduł ankiety JEDNAK czyta", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby atrapa
    // odczytu w ogóle nie liczyła wywołań.
    await mount();

    expect(h.reads).toContain("polls");
  });

  it("awaria odczytu ustawień NIE wywraca trasy - moduł działa na domyślnych", async () => {
    // `.catch(() => undefined)` w loaderze plus domyślne `polls_enabled: true`
    // to jedyna rzecz, która trzyma tę stronę przy życiu, gdy padnie mapa
    // ustawień - a pada ona dla wszystkich modułów naraz.
    h.broken.add("site_settings");
    await mount();

    expect(await screen.findByRole("heading", { level: 1, name: "Ankiety" })).toBeInTheDocument();
  });
});

describe("trasa /polls - stan pusty i błąd listy", () => {
  it("brak ankiet daje komunikat redakcyjny, a nie pustą listę", async () => {
    h.polls = [];
    await mount();

    expect(screen.getByText("Brak aktywnych ankiet.")).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.polls = [];
    await mount();

    expect(screen.getByText("No active polls right now.")).toBeInTheDocument();
  });

  it("awaria odczytu ankiet mówi „nie udało się”, a NIE „nie ma ankiet”", async () => {
    h.broken.add("polls");
    await mount();

    expect(await screen.findByText("Nie udało się pobrać danych.")).toBeInTheDocument();
    expect(screen.queryByText("Brak aktywnych ankiet.")).toBeNull();
  });
});

describe("trasa /polls - izolacja obszarów roboczych", () => {
  it("ankieta innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    h.polls = [poll({ tenant_id: "tenant-b", question_pl: "Pytanie obcego obszaru" })];
    await mount();

    expect(screen.queryByText("Pytanie obcego obszaru")).not.toBeInTheDocument();
    expect(screen.getByText("Brak aktywnych ankiet.")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ta sama ankieta na WŁASNYM hoście renderuje się", async () => {
    h.polls = [poll({ tenant_id: "tenant-b", question_pl: "Pytanie obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mount();

    expect(
      screen.getByRole("heading", { level: 2, name: "Pytanie obcego obszaru" }),
    ).toBeInTheDocument();
  });
});

describe("trasa /polls - kanał realtime na poll_votes", () => {
  it("subskrybuje kanał nazwany po WIDOCZNYCH ankietach i filtruje po ich identyfikatorach", async () => {
    // Nazwa kanału i filtr są tu jednym mechanizmem: bez filtra
    // `poll_id=in.(...)` czytelnik jednej strony dostawałby zdarzenia
    // WSZYSTKICH ankiet w obszarze roboczym.
    await mount();

    await waitFor(() => expect(rt().liveChannels("poll-votes-").length).toBe(1));
    const channel = rt().channelByPrefix("poll-votes-");
    expect(channel?.name).toBe(`poll-votes-${POLL_ID}`);
    expect(channel?.subscribeCount).toBe(1);
    const listener = channel?.listeners.find((l) => l.type === "postgres_changes");
    expect(listener?.filter).toMatchObject({
      event: "*",
      schema: "public",
      table: "poll_votes",
      filter: `poll_id=in.(${POLL_ID})`,
    });
  });

  it("BRAK ankiet = BRAK kanału (nie subskrybujemy pustki)", async () => {
    // Kanał bez ankiet nie ma czego słuchać, a i tak zajmuje jedno z limitu
    // połączeń realtime tenanta.
    h.polls = [];
    await mount();

    await waitFor(() => expect(screen.getByText("Brak aktywnych ankiet.")).toBeInTheDocument());
    expect(rt().liveChannels("poll-votes-")).toEqual([]);
  });

  it("NOWY GŁOS z bazy dochodzi do widoku - słupki rosną bez odświeżania", async () => {
    // To jest cała wartość realtime na tej trasie. Bez inwalidacji czytelnik
    // patrzy na zamrożony rozkład, a strona wygląda na zepsutą.
    h.results = [
      { poll_id: POLL_ID, result: { visible: true, my_vote: 0, total: 1, counts: [1, 0] } },
    ];
    const view = await mount();
    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    expect(await within(card).findByText("1 głos")).toBeInTheDocument();

    // Nowy głos pojawia się w bazie i przychodzi kanałem.
    h.results = [
      { poll_id: POLL_ID, result: { visible: true, my_vote: 0, total: 2, counts: [1, 1] } },
    ];
    rt()
      .channelByPrefix("poll-votes-")
      ?.emitPostgres("poll_votes", {
        eventType: "INSERT",
        new: { poll_id: POLL_ID },
      });

    // Debounce 250 ms - czekamy na skutek, nie na implementację.
    await waitFor(() => expect(within(card).getByText("2 głosy")).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(view.queryClient.getQueryState(["public-poll-results", POLL_ID, "anon"])).toBeDefined();
  });

  it("ODMONTOWANIE trasy WYPISUJE subskrypcję - kanał nie wycieka", async () => {
    // Gubiony `removeChannel` na trasie publicznej nie psuje niczego od razu:
    // dopiero po kilku przejściach między trasami kończy się limit kanałów
    // i przestają przychodzić zdarzenia w całej aplikacji.
    const view = await mount();
    await waitFor(() => expect(rt().liveChannels("poll-votes-").length).toBe(1));

    view.unmount();

    await waitFor(() => expect(rt().liveChannels("poll-votes-")).toEqual([]));
    expect(rt().channels.every((channel) => channel.removed)).toBe(true);
  });

  it("KONTROLA DODATNIA: przed odmontowaniem kanał JEST otwarty", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby kanał nigdy
    // się nie otwierał - a to nie brak wycieku, tylko brak realtime.
    await mount();

    await waitFor(() => expect(rt().liveChannels("poll-votes-").length).toBe(1));
    expect(rt().channels.some((channel) => !channel.removed)).toBe(true);
  });
});

// ── DOSTĘPNOŚĆ: OPCJE ANKIETY JAKO GRUPA WYBORU ────────────────────────────
//
// Ankieta jednokrotnego wyboru to semantycznie GRUPA opcji z jedną etykietą -
// pytaniem. Dzisiejsza karta buduje ją z przycisków `aria-pressed` w gołym
// `<ul>`, bez roli grupy i bez powiązania z pytaniem. Skutek jest mierzalny
// i całkowicie niewidoczny dla axe (przyciski MAJĄ dostępne nazwy, lista JEST
// poprawną listą): czytnik ekranu na stronie z trzema ankietami czyta dziewięć
// przycisków przełącznikowych bez informacji, do którego pytania należą.
//
// NIE NAPRAWIAM TEGO TUTAJ, bo `PollCard` jest WSPÓLNY dla `/polls` i dla
// bloku ankiety w treści wpisu (`PollBlockView`), a zamiana przycisków na
// grupę radiową zmienia obsługę klawiatury obu powierzchni (strzałki zamiast
// tabulacji, jedno zatrzymanie tabulatora na grupę). To zmiana zachowania
// dwóch powierzchni naraz, nie usunięcie błędu na jednej trasie.
describe("trasa /polls - dostępność grupy wyboru", () => {
  it.fails("DEFEKT: opcje ankiety NIE tworzą grupy opisanej pytaniem", async () => {
    // KONTRAKT: opcje jednej ankiety są grupą, a jej dostępną nazwą jest
    // pytanie. Wtedy czytnik ekranu mówi „grupa: Czy Europa... , opcja 1 z 2".
    h.userId = "user-1";
    await mount();

    expect(
      screen.getByRole("group", {
        name: "Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?",
      }),
    ).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: dziś opcje to przyciski przełącznikowe z etykietą tekstową", async () => {
    // Para do `it.fails` wyżej: opisuje stan DZISIEJSZY, więc gdyby ktoś
    // usunął `aria-pressed` albo etykiety, ten test padnie od razu - zapadka
    // nie jest zapisem „i tak jest źle".
    h.userId = "user-1";
    h.results = [
      { poll_id: POLL_ID, result: { visible: true, my_vote: 1, total: 1, counts: [0, 1] } },
    ];
    await mount();

    const card = pollCard("Czy Europa powinna przyspieszyć rozbudowę sieci przesyłowych?");
    const buttons = within(card).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    await waitFor(() => expect(buttons[1]).toHaveAttribute("aria-pressed", "true"));
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    // Etykieta tekstowa jest jedyną dostępną nazwą tych przycisków.
    expect(buttons[0]).toHaveAccessibleName(/Tak, natychmiast/);
  });
});

describe("trasa /polls - nagłówek dokumentu", () => {
  it("po polsku niesie polski tytuł, opis i znacznik języka", () => {
    const head = routeHead(PollsRoute);

    expect(headTitle(head)).toBe("Ankiety społeczności");
    expect(metaContent(head, "name", "description")).toBe(
      "Głosuj w ankietach społeczności i zobacz, co myślą inni.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", () => {
    h.requestUrl = "https://nes.example.org/en/polls";
    const head = routeHead(PollsRoute);

    expect(headTitle(head)).toBe("Community polls");
    expect(metaContent(head, "name", "description")).toBe(
      "Vote in community polls and see the pulse of readers.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("kanoniczny bierze adres z żądania, a pusty adres spada na /polls", () => {
    const withUrl = routeHead(PollsRoute);
    expect((withUrl.links ?? []).find((l) => l.rel === "canonical")?.href).toBe(
      "https://nes.example.org/polls",
    );

    h.requestUrl = "";
    expect((routeHead(PollsRoute).links ?? []).find((l) => l.rel === "canonical")?.href).toBe(PATH);
  });

  it("NIE wyłącza ankiet z indeksu", () => {
    const robots = (routeHead(PollsRoute).meta ?? []).filter((e) => e.name === "robots");

    expect(robots).toEqual([]);
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM WCZYTANIU ───────────────────────────────
//
// POMIAR, NIE OPINIA. `measureFirstPaint` rozdziela dwie fale tego samego
// wczytania:
//   * FALA LOADERA - odczyty, które robi serwer, zanim poleci HTML;
//   * FALA KLIENTA - odczyty startujące na MONTAŻU, czyli round-tripy PO
//     hydratacji, każdy z pełnym opóźnieniem sieci czytelnika.
// Rozdzielenie działa, bo loader zasiewa cache zapytań, a ten jedzie do
// przeglądarki w dehydrowanym ładunku SSR, więc świeży wpis nie jest ponawiany
// na montażu.
//
// BUDŻETY PLATFORMY, w których to się musi zmieścić: ROOT_WARM_BUDGET_MS
// 2500, SSR_DB_DEADLINE_MS 8000, limit 6 równoległych subrequestów na żądanie
// na Workers. Root loader zużywa część tego limitu na rozgrzewkę chrome,
// więc każde zapytanie dopisane do loadera trasy konkuruje z nim o miejsce.
//
// ZMIERZONE PRZED ZMIANĄ: loader 2 odczyty (`site_settings`, `polls`),
// klient 2 odczyty (`rpc:get_poll_results_bulk` ORAZ ponowny `polls`).
// ZMIERZONE PO ZMIANIE: loader 2 odczyty, klient 1 odczyt.
//
// CO SIĘ ZMIENIŁO I DLACZEGO. Drugi odczyt `polls` w fali klienta był
// pomiarem, nie przypuszczeniem: `publicPollsQueryOptions` NIE deklarowało
// `staleTime`, więc lista zasiana loaderem była przeterminowana w chwili
// hydratacji i `useQuery` pobierało ją PONOWNIE zaraz po montażu. Loader
// płacił za dane, z których przeglądarka nie korzystała ani sekundy.
// Naprawa to jedna linia w warstwie zapytań (`staleTime: 60_000`, ta sama
// wartość co lista wydarzeń) - bez zmiany klucza, filtra i kolejności.
//
// ODRZUCENIE Z UZASADNIENIEM. Jedyne zapytanie klienckie tej trasy
// (`pollResultsQueryOptions`) NIE MOŻE wejść do loadera, i to z dwóch
// niezależnych powodów:
//   1. ANTI-ANCHORING. RPC `get_poll_results_bulk` personalizuje odpowiedź
//      (`my_vote`, `visible`). Zasiew w loaderze wsadziłby ten stan do
//      dokumentu, a dokument idzie do cache'a brzegowego - więc KAŻDY
//      kolejny czytelnik dostałby cudzy `my_vote` i odsłonięty rozkład
//      głosów przed własnym wyborem. To jednocześnie wyciek personalizacji
//      i zakotwiczenie odpowiedzi.
//   2. KLUCZ ZAWIERA UŻYTKOWNIKA (`["public-poll-results", ids, uid|anon]`),
//      którego loader SSR nie zna w chwili rozgrzewki.
// Zapadka stoi więc na DZISIEJSZEJ liczbie jednego zapytania klienckiego,
// a nie na zerze - i pilnuje, żeby DRUGIE zapytanie klienckie nie weszło tu
// niezauważone.

/** Wynik pomiaru pierwszego wczytania: odczyty serwera kontra odczyty klienta. */
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

type PollsLoader = (ctx: { context: { queryClient: QueryClient } }) => Promise<unknown>;

/**
 * Loader trasy jako funkcja - `renderRoute` woła go sam, ale wtedy nie da się
 * ODCZYTAĆ granicy między falami. Tutaj wołamy go wprost na tym samym kliencie
 * zapytań, który potem dostaje `renderRoute`: drugi bieg loadera trafia już na
 * ciepły, świeży cache, więc nie dolicza odczytów do fali klienta.
 */
function pollsLoader(): PollsLoader {
  const loader: unknown = PollsRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as PollsLoader;
}

async function measureFirstPaint(): Promise<FirstPaintMeasurement> {
  const queryClient = freshClient();
  await pollsLoader()({ context: { queryClient } });
  const loaderReads = [...h.reads];

  const view = await mount(queryClient);
  await screen.findByRole("heading", { level: 1 });
  // Zapytania klienckie startują w efektach montażu - czekamy, aż cache
  // przestanie się zmieniać, inaczej pomiar liczyłby mniej, niż strona robi.
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasa /polls - zapadka na liczbie zapytań pierwszego wczytania", () => {
  it("loader zasiewa USTAWIENIA i ANKIETY - pytania są w HTML z serwera", async () => {
    // Bez zasiewu crawler i czytelnik z wolną siecią widzą samą powłokę,
    // a pytania dojeżdżają po hydratacji razem z przeskokiem układu.
    const { loaderReads } = await measureFirstPaint();

    expect(loaderReads).toEqual(["site_settings", "polls"]);
  });

  it("nie robi WIĘCEJ NIŻ JEDNO zapytanie klienckie na pierwszym wczytaniu", async () => {
    // ZAPADKA. Każdy odczyt w tej fali to round-trip po hydratacji z pełnym
    // opóźnieniem sieci czytelnika. Dopisanie tu drugiego `useQuery` bez
    // zasiewu w loaderze ma wywalić ten test, a nie przejść niezauważone.
    const { clientReads } = await measureFirstPaint();

    expect(clientReads.length, `odczyty klienta: ${clientReads.join(", ")}`).toBeLessThanOrEqual(1);
  });

  it("wyniki ZOSTAJĄ klienckie - to jedyny dopuszczony round-trip", async () => {
    // Odrzucenie z uzasadnieniem (patrz komentarz nad tym blokiem): zasiew
    // wsadziłby cudzy `my_vote` do dokumentu w cache'u brzegowym.
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect(loaderReads).not.toContain("rpc:get_poll_results_bulk");
    expect(clientReads).toEqual(["rpc:get_poll_results_bulk"]);
  });

  it("klucz wyników ZAWIERA użytkownika - cache nie serwuje cudzego głosu", async () => {
    // Drugi powód odrzucenia przeniesienia, sprawdzony wykonawczo: po
    // zalogowaniu klucz zmienia się z „anon" na identyfikator użytkownika.
    const anon = await mount();
    await waitFor(() => expect(anon.queryClient.isFetching()).toBe(0));
    expect(anon.queryClient.getQueryData(["public-poll-results", POLL_ID, "anon"])).toBeDefined();
    cleanup();

    h.userId = "user-77";
    const signed = await mount(freshClient());
    await waitFor(() => expect(signed.queryClient.isFetching()).toBe(0));
    expect(
      signed.queryClient.getQueryData(["public-poll-results", POLL_ID, "user-77"]),
    ).toBeDefined();
    expect(
      signed.queryClient.getQueryData(["public-poll-results", POLL_ID, "anon"]),
    ).toBeUndefined();
  });

  it("wyłączony moduł kosztuje JEDEN odczyt ustawień i ani jednego więcej", async () => {
    // Najtańsza możliwa ścieżka: bramka rozstrzyga się na mapie, którą
    // rozgrzewa root loader, więc `ensureQueryData` deduplikuje z nim.
    h.settings = modules({ polls_enabled: false });
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect(loaderReads).toEqual(["site_settings"]);
    expect(clientReads).toEqual([]);
  });
});
