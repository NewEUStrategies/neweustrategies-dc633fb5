// Dwie bliźniacze trasy panelu konta ZAMONTOWANE: `/profile/bookmarks`
// (zapisane wpisy i strony) oraz `/profile/follows` (obserwowani autorzy,
// kategorie, tagi, programy). Obie stały na okrągłym zerze.
//
// CO TEN PLIK DOWODZI - I DLACZEGO NIE JEST FARMĄ POKRYCIA.
//
//   1. LICZNIK W ZAKŁADCE ODPOWIADA LICZBIE POZYCJI FAKTYCZNIE POKAZANYCH.
//      To nie jest kosmetyka: licznik jest jedyną informacją o rozmiarze
//      zbioru, jaką użytkownik dostaje bez przewijania. „Wpisy (7)" nad listą
//      trzech pozycji znaczy dla niego, że aplikacja zgubiła cztery zapisane
//      artykuły - i tak to zgłosi.
//   2. ZAKŁADKA WSKAZUJĄCA TREŚĆ USUNIĘTĄ / WYCOFANĄ Z PUBLIKACJI NIE ZNIKA
//      PO CICHU. Wpis zapisany do przeczytania i wycofany przez redakcję
//      dostaje wiersz „niedostępne" z możliwością sprzątnięcia. Ciche
//      odfiltrowanie takiej pozycji jest gorsze niż komunikat: użytkownik
//      pamięta, że coś zapisał, nie znajduje tego i traci zaufanie do całej
//      listy. Ta sama reguła obowiązuje obserwacje, których celu nie da się
//      już rozwiązać (profil ukryty przez RLS, skasowana kategoria).
//   3. HYDRACJA JEST ZAWĘŻONA DO TREŚCI PUBLICZNIE DOSTĘPNEJ. Zapytanie
//      o wpisy niesie `status = published` ORAZ `deleted_at is null` ORAZ listę
//      tylko WŁASNYCH identyfikatorów. Zgubienie któregokolwiek ogniwa
//      pokazuje w prywatnym panelu szkic albo treść usuniętą.
//   4. BEZ SESJI TRASA NIE PUKA DO BAZY. `enabled: !!user` w każdym zapytaniu
//      hydracji - bez tego wyjście z sesji zamienia panel w generator żądań
//      401 przy każdym wejściu.
//   5. PEŁNA ŚCIEŻKA STRONY POCHODZI Z BAZY, NIE ZE SKLEJANIA SLUGÓW. Strony
//      bywają zagnieżdżone; odnośnik zbudowany z samego sluga prowadzi na 404.
//      Brak ścieżki z bazy spada na slug, a wynik zawsze zaczyna się od `/`.
//   6. AKCJE WYSYŁAJĄ PAYLOAD O KONKRETNEJ POZYCJI. `on: false` plus dokładny
//      identyfikator i typ bytu - pomyłka w typie usuwa cudzy wiersz z innej
//      zakładki (albo nic, co jest równie mylące).
//   7. JĘZYK INTERFEJSU WYBIERA TYTUŁ I FORMAT DATY, z jawnym spadkiem na
//      drugi język i na kreskę. Puste miejsce zamiast tytułu daje listę
//      nieklikalnych, nierozpoznawalnych wierszy.
//
// DLACZEGO DWA PLIKI, A NIE JEDEN NA TRZY TRASY. `/profile/bookmarks`
// i `/profile/follows` to ta sama trasa napisana dwa razy (hook listy ->
// identyfikatory -> hydracja -> liczniki -> wiersz „niedostępne"), więc dowód
// jednej reguły dla obu MUSI stać obok siebie - inaczej rozjazd między
// bliźniakami przechodzi niezauważony. `/profile/organization` nie ma z nimi
// wspólnej ani jednej zależności (funkcje serwerowe, toasty, dialog
// potwierdzenia, hooki rozliczeń) - wspólny plik znaczyłby dwa rozłączne
// zestawy atrap na górze i czytelnik nie wiedziałby, które obowiązują.
// Ta trasa ma własny plik: `profileOrganizationRoute.test.tsx`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - WARSTWY DANYCH ZAKŁADEK: `src/hooks/__tests__/useBookmarks.test.tsx`
//   dowodzi zawężenia zapisu do właściciela, obojętności na duplikat i
//   izolacji cache'u per konto. Tutaj hook jest atrapą; dowodzimy, że trasa go
//   WOŁA, respektuje jego wynik i wysyła poprawny payload.
// - `useFollows` NIE MA jeszcze własnego pliku testowego (upsert
//   `ignoreDuplicates`, zawężenie usunięcia) - to warstwa danych, nie trasa,
//   i nie udajemy tu jej pokrycia; asercje dotyczą wyłącznie payloadu, jaki
//   trasa temu hookowi podaje.
// - RLS I RPC: `page_full_path` oraz polityki `user_bookmarks` / `user_follows`
//   mają pgTAP. Atrapa nie odtwarza ich reguł, tylko argumenty wywołania.
// - RADIX TABS: podmienione na natywny odpowiednik oddający KONTRAKT (stan +
//   callback + treść tylko aktywnej zakładki), bo pod happy-dom bez pełnego
//   pointer API Radix nie renderuje zawartości.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SupabaseFromStub } from "@/test/supabaseChain";
import type { BookmarkEntityType } from "@/hooks/useBookmarks";
import type { FollowTargetType } from "@/hooks/useFollows";

interface BookmarkRow {
  id: string;
  entity_type: BookmarkEntityType;
  entity_id: string;
  created_at: string;
}
interface FollowRow {
  id: string;
  target_type: FollowTargetType;
  target_id: string;
  created_at: string;
}

const h = vi.hoisted(() => ({
  language: "pl",
  user: { id: "user-1" } as { id: string } | null,
  /** Wynik `useBookmarks()`; `undefined` = zapytanie hooka w locie. */
  bookmarks: undefined as BookmarkRow[] | undefined,
  /** Wynik `useFollows()`. */
  follows: undefined as FollowRow[] | undefined,
  /** `toggle.isPending` - blokada przycisku w wierszu „niedostępne". */
  togglePending: false,
  /** Payloady, z jakimi trasa zawołała mutacje - to jest tu dowód. */
  bookmarkPayloads: [] as { entityType: string; entityId: string; on: boolean }[],
  followPayloads: [] as { targetType: string; targetId: string; on: boolean }[],
  chain: null as SupabaseFromStub | null,
  /** Wywołania RPC pełnej ścieżki strony. */
  rpcCalls: [] as { fn: string; args: Record<string, unknown> | undefined }[],
  /** Ścieżka zwracana przez `page_full_path` per identyfikator strony. */
  pagePaths: {} as Record<string, string | null>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

// JEDEN obiekt na moduł, z getterami na pola zmienne per test. Świeży literał
// przy każdym renderze zapętla efekty czytające `x.data` w tablicy zależności.
vi.mock("@/hooks/useAuth", () => {
  const session = {};
  const auth = {
    get user() {
      return h.user;
    },
    get session() {
      return h.user ? session : null;
    },
    loading: false,
  };
  return { useAuth: () => auth };
});

vi.mock("@/hooks/useBookmarks", () => {
  const query = {
    get data() {
      return h.bookmarks;
    },
  };
  const toggle = {
    mutate: (vars: { entityType: string; entityId: string; on: boolean }) => {
      h.bookmarkPayloads.push(vars);
    },
    get isPending() {
      return h.togglePending;
    },
  };
  return { useBookmarks: () => query, useToggleBookmark: () => toggle };
});

vi.mock("@/hooks/useFollows", () => {
  const query = {
    get data() {
      return h.follows;
    },
  };
  const toggle = {
    mutate: (vars: { targetType: string; targetId: string; on: boolean }) => {
      h.followPayloads.push(vars);
    },
    get isPending() {
      return h.togglePending;
    },
  };
  return { useFollows: () => query, useToggleFollow: () => toggle };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const stub = supabaseFromStub();
  h.chain = stub;
  return {
    supabase: {
      from: stub.from,
      rpc: (fn: string, args?: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args });
        const raw: unknown = args ? args["_page_id"] : undefined;
        const id = typeof raw === "string" ? raw : "";
        return Promise.resolve({ data: h.pagePaths[id] ?? null, error: null });
      },
    },
  };
});

// Radix Tabs bez pełnego pointer API nie renderuje zawartości pod happy-dom.
// Atrapa oddaje KONTRAKT: wartość, callback zmiany i treść WYŁĄCZNIE aktywnej
// zakładki (liczniki w wyzwalaczach są widoczne zawsze - tak jak w Radiksie).
vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ value: string; set: (next: string) => void }>({
    value: "",
    set: () => undefined,
  });
  const Tabs = ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    children?: ReactNode;
  }) => (
    <Ctx.Provider value={{ value, set: onValueChange }}>
      <div data-testid="tabs" data-value={value}>
        {children}
      </div>
    </Ctx.Provider>
  );
  const TabsList = ({ children }: { children?: ReactNode }) => <div role="tablist">{children}</div>;
  const TabsTrigger = ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = React.useContext(Ctx);
    return (
      <button
        type="button"
        role="tab"
        data-tab-trigger={value}
        aria-selected={ctx.value === value}
        onClick={() => ctx.set(value)}
      >
        {children}
      </button>
    );
  };
  const TabsContent = ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = React.useContext(Ctx);
    return ctx.value === value ? <div data-tab-content={value}>{children}</div> : null;
  };
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

// `Link` bez pełnego drzewa tras - wspólna atrapa repo renderuje prawdziwy
// `href` z podstawionymi parametrami, więc asercja czyta CEL odnośnika.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { renderRoute } from "@/test/routeHarness";
import { fail, ok } from "@/test/supabaseChain";
import { Route as BookmarksRoute } from "@/routes/profile.bookmarks";
import { Route as FollowsRoute } from "@/routes/profile.follows";

/** Ustalona data bazowa - żadna asercja nie zależy od dnia przejazdu suity. */
const NOW = new Date("2026-08-21T10:00:00.000Z");

function chain(): SupabaseFromStub {
  // STRAŻNIK, nie rzutowanie: atrapa klienta powstaje w fabryce mocka, więc
  // brak przypisania znaczy „mock się nie wykonał" - to błąd testu, nie pustka.
  if (!h.chain) throw new Error("test: atrapa `supabase.from` nie została utworzona");
  return h.chain;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  h.language = "pl";
  h.user = { id: "user-1" };
  h.bookmarks = [];
  h.follows = [];
  h.togglePending = false;
  h.bookmarkPayloads = [];
  h.followPayloads = [];
  h.rpcCalls = [];
  h.pagePaths = {};
  chain().reset();
  // Domyślnie każda tabela hydracji odpowiada pustką - test, który czegoś
  // oczekuje, planuje to jawnie.
  for (const table of ["posts", "pages", "profiles", "categories", "tags", "programs"]) {
    chain().setResponse(table, ok([]));
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function node(selector: string): HTMLElement {
  const found = document.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`test: brak elementu ${selector}`);
  return found;
}

function all(selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector));
}

/** Liczba z etykiety zakładki - to ona ma się zgadzać z długością listy. */
function tabCount(value: string): number {
  const text = node(`[data-tab-trigger="${value}"]`).textContent ?? "";
  const match = /\((\d+)\)/.exec(text);
  if (!match) throw new Error(`test: zakładka "${value}" nie pokazuje licznika: "${text}"`);
  return Number(match[1]);
}

/** Liczba wierszy FAKTYCZNIE pokazanych w aktywnej zakładce. */
function rowCount(value: string): number {
  return all(`[data-tab-content="${value}"] li`).length;
}

function tabText(value: string): string {
  return (node(`[data-tab-content="${value}"]`).textContent ?? "").trim();
}

function hrefs(value: string): string[] {
  return all(`[data-tab-content="${value}"] a`).map((a) => a.getAttribute("href") ?? "");
}

function buttonsIn(value: string): HTMLElement[] {
  return all(`[data-tab-content="${value}"] button`).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}

function clickTab(value: string): void {
  fireEvent.click(node(`[data-tab-trigger="${value}"]`));
}

const bookmark = (entity_type: BookmarkEntityType, entity_id: string): BookmarkRow => ({
  id: `b-${entity_id}`,
  entity_type,
  entity_id,
  created_at: "2026-08-01T00:00:00.000Z",
});

const follow = (target_type: FollowTargetType, target_id: string): FollowRow => ({
  id: `f-${target_id}`,
  target_type,
  target_id,
  created_at: "2026-08-01T00:00:00.000Z",
});

async function mountBookmarks() {
  return renderRoute({
    route: BookmarksRoute,
    path: "/profile/bookmarks",
    initialEntry: "/profile/bookmarks",
  });
}

async function mountFollows() {
  return renderRoute({
    route: FollowsRoute,
    path: "/profile/follows",
    initialEntry: "/profile/follows",
  });
}

const POST_ROWS = [
  {
    id: "post-1",
    slug: "raport-o-energii",
    title_pl: "Raport o energii",
    title_en: "Energy report",
    cover_image_url: "https://example.test/cover.webp",
    published_at: "2026-03-05T09:00:00.000Z",
  },
  {
    id: "post-2",
    slug: "brief-transportowy",
    title_pl: "Brief transportowy",
    title_en: "Transport brief",
    cover_image_url: null,
    published_at: null,
  },
];

describe("/profile/bookmarks - zapisane wpisy", () => {
  it("pokazuje zapisane wpisy z tytułem, odnośnikiem i datą, a licznik zgadza się z listą", async () => {
    h.bookmarks = [bookmark("post", "post-1"), bookmark("post", "post-2")];
    chain().setResponse("posts", ok(POST_ROWS));
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(2));
    expect(tabCount("post")).toBe(2);
    expect(hrefs("post")).toEqual(["/post/raport-o-energii", "/post/brief-transportowy"]);
    expect(screen.getByText("Raport o energii")).toBeTruthy();
    // Data w formacie polskim (drugi wpis nie ma daty - i nie pokazuje pustej).
    expect(tabText("post")).toContain(
      new Date("2026-03-05T09:00:00.000Z").toLocaleDateString("pl-PL"),
    );
    // Okładka albo zastępczy prostokąt - nigdy złamany obrazek.
    expect(all(`[data-tab-content="post"] img`).length).toBe(1);
  });

  it("HYDRACJA jest zawężona: własne identyfikatory, tylko opublikowane, nieusunięte", async () => {
    h.bookmarks = [bookmark("post", "post-1"), bookmark("post", "post-2")];
    chain().setResponse("posts", ok(POST_ROWS));
    await mountBookmarks();

    await waitFor(() => expect(chain().lastChain("posts")).toBeTruthy());
    const posts = chain().lastChain("posts");
    expect(posts?.argsOf("in")).toEqual(["id", ["post-1", "post-2"]]);
    expect(posts?.argsOf("eq")).toEqual(["status", "published"]);
    expect(posts?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(String(posts?.argsOf("select")?.[0])).toContain("cover_image_url");
  });

  it("BRAK ZAKŁADEK: komunikat pustki, zero zapytań i licznik 0", async () => {
    h.bookmarks = [];
    await mountBookmarks();

    expect(screen.getAllByText("profile.bookmarks.empty").length).toBe(1);
    expect(tabCount("post")).toBe(0);
    expect(tabCount("page")).toBe(0);
    expect(chain().chainsFor("posts").length).toBe(0);
    expect(chain().chainsFor("pages").length).toBe(0);
  });

  it("BEZ SESJI trasa nie puka do bazy, nawet mając identyfikatory w cache", async () => {
    h.user = null;
    h.bookmarks = [bookmark("post", "post-1")];
    chain().setResponse("posts", ok(POST_ROWS));
    await mountBookmarks();

    await waitFor(() => expect(tabCount("post")).toBe(1));
    expect(chain().chainsFor("posts").length).toBe(0);
    expect(rowCount("post")).toBe(0);
  });

  it("zakładka do treści USUNIĘTEJ nie znika po cichu: wiersz „niedostępne”, licznik zgodny", async () => {
    // Trzy zapisane wpisy, hydracja zwraca dwa (trzeci wycofany z publikacji).
    h.bookmarks = [
      bookmark("post", "post-1"),
      bookmark("post", "post-2"),
      bookmark("post", "post-znikniety"),
    ];
    chain().setResponse("posts", ok(POST_ROWS));
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(3));
    expect(screen.getAllByText("profile.bookmarks.unavailable").length).toBe(1);
    // Reguła nadrzędna: licznik = liczba wierszy pokazanych, nie liczba żywych.
    expect(tabCount("post")).toBe(3);
  });

  it("sprzątnięcie martwej zakładki wysyła PAYLOAD z jej identyfikatorem i `on: false`", async () => {
    h.bookmarks = [bookmark("post", "post-1"), bookmark("post", "post-znikniety")];
    chain().setResponse("posts", ok([POST_ROWS[0]]));
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(2));
    const buttons = buttonsIn("post");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(h.bookmarkPayloads).toEqual([
      { entityType: "post", entityId: "post-znikniety", on: false },
    ]);
  });

  it("usunięcie ŻYWEJ zakładki celuje w jej wpis, nie w sąsiedni", async () => {
    h.bookmarks = [bookmark("post", "post-1"), bookmark("post", "post-2")];
    chain().setResponse("posts", ok(POST_ROWS));
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(2));
    fireEvent.click(buttonsIn("post")[1]);
    expect(h.bookmarkPayloads).toEqual([{ entityType: "post", entityId: "post-2", on: false }]);
  });

  it("trwający zapis BLOKUJE przycisk w wierszu „niedostępne” (bez podwójnego usunięcia)", async () => {
    h.togglePending = true;
    h.bookmarks = [bookmark("post", "post-znikniety")];
    chain().setResponse("posts", ok([]));
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(1));
    const button = buttonsIn("post")[0];
    expect(button.getAttribute("disabled")).not.toBeNull();
  });

  it("ANGIELSKI interfejs bierze tytuł EN i datę w formacie en-GB", async () => {
    h.language = "en";
    h.bookmarks = [bookmark("post", "post-1")];
    chain().setResponse("posts", ok([POST_ROWS[0]]));
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(1));
    expect(screen.getByText("Energy report")).toBeTruthy();
    const expected = new Date("2026-03-05T09:00:00.000Z").toLocaleDateString("en-GB");
    expect(tabText("post")).toContain(expected);
    expect(expected).not.toBe(new Date("2026-03-05T09:00:00.000Z").toLocaleDateString("pl-PL"));
  });

  it("brak tytułu w wybranym języku spada na drugi, a brak OBU daje kreskę", async () => {
    h.bookmarks = [bookmark("post", "post-a"), bookmark("post", "post-b")];
    chain().setResponse(
      "posts",
      ok([
        {
          id: "post-a",
          slug: "tylko-en",
          title_pl: null,
          title_en: "Only English",
          cover_image_url: null,
          published_at: null,
        },
        {
          id: "post-b",
          slug: "bez-tytulu",
          title_pl: null,
          title_en: null,
          cover_image_url: null,
          published_at: null,
        },
      ]),
    );
    await mountBookmarks();

    await waitFor(() => expect(rowCount("post")).toBe(2));
    expect(screen.getByText("Only English")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
  });

  // DEFEKT 1. Awaria hydracji zostawia licznik z surowej liczby zakładek,
  // a lista renderuje ZERO wierszy. Użytkownik czyta „Wpisy (2)" nad pustym
  // prostokątem i wnioskuje, że panel zgubił jego zapisane artykuły - a one
  // są w bazie, nie udało się tylko jedno zapytanie. Nie naprawiamy tego
  // testem: wybór między „pokaż licznik z zakładek" a „pokaż licznik z listy"
  // jest decyzją projektową (patrz komentarz w pliku trasy, linie 124-135),
  // a jej konsekwencją jest osobny stan błędu, którego trasa dziś nie ma.
  it.fails("licznik zakładki zgadza się z listą TAKŻE po awarii hydracji", async () => {
    h.bookmarks = [bookmark("post", "post-1"), bookmark("post", "post-2")];
    chain().setResponse("posts", fail("hydracja padła"));
    await mountBookmarks();

    await waitFor(() => expect(chain().chainsFor("posts").length).toBeGreaterThan(0));
    expect(tabCount("post")).toBe(rowCount("post"));
  });

  // DEFEKT 2. Awaria hydracji jest NIEODRÓŻNIALNA od pustki i od oczekiwania:
  // trasa nie czyta `postsQ.isError` ani `isPending`, więc w każdym z tych
  // trzech przypadków rysuje puste `<ul>` bez ani jednego słowa. Użytkownik
  // nie wie, czy ma odświeżyć stronę, czy naprawdę nic nie zapisał. Nie
  // naprawiamy: dodanie stanu błędu to zmiana zachowania produkcyjnego (nowe
  // klucze i18n, decyzja o treści komunikatu), a nie poprawka testu.
  it.fails("AWARIA hydracji ma własny komunikat, odrębny od pustej listy", async () => {
    h.bookmarks = [bookmark("post", "post-1")];
    chain().setResponse("posts", fail("hydracja padła"));
    await mountBookmarks();

    await waitFor(() => expect(chain().chainsFor("posts").length).toBeGreaterThan(0));
    expect(tabText("post").length).toBeGreaterThan(0);
  });
});

describe("/profile/bookmarks - zapisane strony", () => {
  const PAGE_ROWS = [
    { id: "page-1", slug: "zespol", title_pl: "Zespół", title_en: "Team" },
    { id: "page-2", slug: "kontakt", title_pl: "Kontakt", title_en: "Contact" },
  ];

  it("przełączenie zakładki pokazuje strony z PEŁNĄ ścieżką z bazy", async () => {
    h.bookmarks = [bookmark("page", "page-1"), bookmark("page", "page-2")];
    chain().setResponse("pages", ok(PAGE_ROWS));
    // Pierwsza strona jest zagnieżdżona, druga wraca ze ścieżką bez wiodącego
    // ukośnika - odnośnik i tak musi być absolutny.
    h.pagePaths = { "page-1": "/o-nas/zespol", "page-2": "kontakt" };
    await mountBookmarks();

    await waitFor(() => expect(tabCount("page")).toBe(2));
    clickTab("page");
    await waitFor(() => expect(rowCount("page")).toBe(2));
    expect(hrefs("page")).toEqual(["/o-nas/zespol", "/kontakt"]);
    expect(screen.getByText("Zespół")).toBeTruthy();
  });

  it("BRAK ścieżki z bazy spada na slug strony, nie na pusty odnośnik", async () => {
    h.bookmarks = [bookmark("page", "page-1")];
    chain().setResponse("pages", ok([PAGE_ROWS[0]]));
    h.pagePaths = {};
    await mountBookmarks();

    clickTab("page");
    await waitFor(() => expect(rowCount("page")).toBe(1));
    expect(hrefs("page")).toEqual(["/zespol"]);
  });

  it("RPC pełnej ścieżki jest wołany PER strona, z jej identyfikatorem", async () => {
    h.bookmarks = [bookmark("page", "page-1"), bookmark("page", "page-2")];
    chain().setResponse("pages", ok(PAGE_ROWS));
    await mountBookmarks();

    await waitFor(() => expect(h.rpcCalls.length).toBe(2));
    expect(h.rpcCalls.map((call) => call.fn)).toEqual(["page_full_path", "page_full_path"]);
    expect(h.rpcCalls.map((call) => call.args)).toEqual([
      { _page_id: "page-1" },
      { _page_id: "page-2" },
    ]);
  });

  it("zapytanie o strony jest zawężone do opublikowanych i nieusuniętych", async () => {
    h.bookmarks = [bookmark("page", "page-1")];
    chain().setResponse("pages", ok([PAGE_ROWS[0]]));
    await mountBookmarks();

    await waitFor(() => expect(chain().lastChain("pages")).toBeTruthy());
    const pages = chain().lastChain("pages");
    expect(pages?.argsOf("in")).toEqual(["id", ["page-1"]]);
    expect(pages?.argsOf("eq")).toEqual(["status", "published"]);
    expect(pages?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("USUNIĘTA strona dostaje wiersz „niedostępne”, a jej usunięcie niesie typ `page`", async () => {
    h.bookmarks = [bookmark("page", "page-1"), bookmark("page", "page-usunieta")];
    chain().setResponse("pages", ok([PAGE_ROWS[0]]));
    await mountBookmarks();

    clickTab("page");
    await waitFor(() => expect(rowCount("page")).toBe(2));
    expect(tabCount("page")).toBe(2);
    const buttons = buttonsIn("page");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(h.bookmarkPayloads).toEqual([
      { entityType: "page", entityId: "page-usunieta", on: false },
    ]);
  });

  it("usunięcie ŻYWEJ zakładki strony celuje w jej wiersz", async () => {
    h.bookmarks = [bookmark("page", "page-1")];
    chain().setResponse("pages", ok([PAGE_ROWS[0]]));
    await mountBookmarks();

    clickTab("page");
    await waitFor(() => expect(rowCount("page")).toBe(1));
    fireEvent.click(buttonsIn("page")[0]);
    expect(h.bookmarkPayloads).toEqual([{ entityType: "page", entityId: "page-1", on: false }]);
  });

  it("zakładka Strony bez zapisanych stron ma komunikat pustki, choć Wpisy mają treść", async () => {
    h.bookmarks = [bookmark("post", "post-1")];
    chain().setResponse("posts", ok([POST_ROWS[0]]));
    await mountBookmarks();

    await waitFor(() => expect(tabCount("post")).toBe(1));
    clickTab("page");
    expect(tabCount("page")).toBe(0);
    expect(tabText("page")).toBe("profile.bookmarks.empty");
  });
});

describe("/profile/follows - obserwowani autorzy", () => {
  const AUTHOR_ROWS = [
    {
      id: "author-1",
      display_name: "Anna Nowak",
      slug: "anna-nowak",
      avatar_url: "https://example.test/a.webp",
    },
    { id: "author-2", display_name: "Jan Kowalski", slug: null, avatar_url: null },
    { id: "author-3", display_name: null, slug: "bez-nazwy", avatar_url: null },
  ];

  it("pokazuje obserwowanych z awatarem i odnośnikiem, licznik zgadza się z listą", async () => {
    h.follows = [follow("author", "author-1"), follow("author", "author-2")];
    chain().setResponse("profiles", ok([AUTHOR_ROWS[0], AUTHOR_ROWS[1]]));
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(2));
    expect(tabCount("author")).toBe(2);
    expect(hrefs("author")).toEqual(["/author/anna-nowak"]);
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    // Autor BEZ sluga nie dostaje odnośnika w nikąd - dostaje sam napis.
    expect(screen.getByText("Jan Kowalski").tagName).toBe("SPAN");
    expect(all(`[data-tab-content="author"] img`).length).toBe(1);
  });

  it("obserwowany BEZ nazwy wyświetlanej dostaje kreskę, nie pusty wiersz", async () => {
    h.follows = [follow("author", "author-3")];
    chain().setResponse("profiles", ok([AUTHOR_ROWS[2]]));
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(1));
    expect(screen.getByText("-")).toBeTruthy();
    expect(hrefs("author")).toEqual(["/author/bez-nazwy"]);
  });

  it("HYDRACJA autorów pyta tylko o obserwowane identyfikatory", async () => {
    h.follows = [follow("author", "author-1")];
    chain().setResponse("profiles", ok([AUTHOR_ROWS[0]]));
    await mountFollows();

    await waitFor(() => expect(chain().lastChain("profiles")).toBeTruthy());
    expect(chain().lastChain("profiles")?.argsOf("in")).toEqual(["id", ["author-1"]]);
  });

  it("obserwacja, której celu NIE DA SIĘ rozwiązać, dostaje wiersz z możliwością odsubskrybowania", async () => {
    h.follows = [follow("author", "author-1"), follow("author", "author-ukryty")];
    chain().setResponse("profiles", ok([AUTHOR_ROWS[0]]));
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(2));
    expect(tabCount("author")).toBe(2);
    expect(screen.getAllByText("profile.follows.unavailable").length).toBe(1);
    const buttons = buttonsIn("author");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(h.followPayloads).toEqual([
      { targetType: "author", targetId: "author-ukryty", on: false },
    ]);
  });

  it("odsubskrybowanie ŻYWEGO autora celuje w jego identyfikator", async () => {
    h.follows = [follow("author", "author-1")];
    chain().setResponse("profiles", ok([AUTHOR_ROWS[0]]));
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(1));
    fireEvent.click(buttonsIn("author")[0]);
    expect(h.followPayloads).toEqual([{ targetType: "author", targetId: "author-1", on: false }]);
  });

  it("trwający zapis BLOKUJE przycisk w wierszu nierozwiązanej obserwacji", async () => {
    h.togglePending = true;
    h.follows = [follow("author", "author-ukryty")];
    chain().setResponse("profiles", ok([]));
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(1));
    expect(buttonsIn("author")[0].getAttribute("disabled")).not.toBeNull();
  });

  it("BRAK OBSERWACJI: komunikat pustki w każdej zakładce, zero zapytań", async () => {
    h.follows = [];
    await mountFollows();

    expect(tabCount("author")).toBe(0);
    expect(tabCount("category")).toBe(0);
    expect(tabCount("tag")).toBe(0);
    expect(tabCount("program")).toBe(0);
    expect(tabText("author")).toBe("profile.follows.empty");
    expect(chain().chains.length).toBe(0);
  });

  it("BEZ SESJI trasa nie puka do bazy, choć obserwacje są w cache", async () => {
    h.user = null;
    h.follows = [follow("author", "author-1"), follow("tag", "tag-1")];
    await mountFollows();

    await waitFor(() => expect(tabCount("author")).toBe(1));
    expect(chain().chains.length).toBe(0);
    expect(rowCount("author")).toBe(0);
  });

  // DEFEKT 3. Bliźniacza trasa ma ten sam rozjazd co zakładki: liczniki liczą
  // SUROWE identyfikatory obserwacji (`ids.author.length`), więc po awarii
  // hydracji zakładka mówi „Autorzy (2)" nad pustą listą. Dla użytkownika to
  // znaczy „aplikacja zgubiła moje obserwacje". Nie naprawiamy testem -
  // brakuje tu stanu błędu, a jego dodanie jest zmianą zachowania.
  it.fails("licznik obserwacji zgadza się z listą TAKŻE po awarii hydracji", async () => {
    h.follows = [follow("author", "author-1"), follow("author", "author-2")];
    chain().setResponse("profiles", fail("hydracja padła"));
    await mountFollows();

    await waitFor(() => expect(chain().chainsFor("profiles").length).toBeGreaterThan(0));
    expect(tabCount("author")).toBe(rowCount("author"));
  });

  // DEFEKT 4. Jak wyżej: awaria hydracji obserwacji nie ma ŻADNEGO komunikatu
  // (trasa nie czyta `isError`), więc jest nieodróżnialna od pustki i od
  // oczekiwania. Konsekwencja: użytkownik nie wie, czy odświeżyć stronę.
  it.fails("AWARIA hydracji obserwacji ma własny komunikat, odrębny od pustki", async () => {
    h.follows = [follow("author", "author-1")];
    chain().setResponse("profiles", fail("hydracja padła"));
    await mountFollows();

    await waitFor(() => expect(chain().chainsFor("profiles").length).toBeGreaterThan(0));
    expect(tabText("author").length).toBeGreaterThan(0);
  });
});

describe("/profile/follows - kategorie, tagi, programy", () => {
  it("KATEGORIE: nazwa w języku interfejsu, odnośnik do kategorii, payload z typem `category`", async () => {
    h.follows = [follow("category", "cat-1"), follow("category", "cat-brak")];
    chain().setResponse(
      "categories",
      ok([{ id: "cat-1", slug: "energia", name_pl: "Energia", name_en: "Energy" }]),
    );
    await mountFollows();

    clickTab("category");
    await waitFor(() => expect(rowCount("category")).toBe(2));
    expect(tabCount("category")).toBe(2);
    expect(hrefs("category")).toEqual(["/category/energia"]);
    expect(screen.getByText("Energia")).toBeTruthy();
    expect(chain().lastChain("categories")?.argsOf("in")).toEqual(["id", ["cat-1", "cat-brak"]]);
    fireEvent.click(buttonsIn("category")[0]);
    expect(h.followPayloads).toEqual([{ targetType: "category", targetId: "cat-1", on: false }]);
  });

  it("KATEGORIE po angielsku: nazwa EN, a jej brak spada na PL", async () => {
    h.language = "en";
    h.follows = [follow("category", "cat-1"), follow("category", "cat-2")];
    chain().setResponse(
      "categories",
      ok([
        { id: "cat-1", slug: "energia", name_pl: "Energia", name_en: "Energy" },
        { id: "cat-2", slug: "transport", name_pl: "Transport PL", name_en: null },
      ]),
    );
    await mountFollows();

    clickTab("category");
    await waitFor(() => expect(rowCount("category")).toBe(2));
    expect(screen.getByText("Energy")).toBeTruthy();
    expect(screen.getByText("Transport PL")).toBeTruthy();
  });

  it("TAGI: nazwa z krzyżykiem, odnośnik do tagu, payload z typem `tag`", async () => {
    h.follows = [follow("tag", "tag-1"), follow("tag", "tag-brak")];
    chain().setResponse("tags", ok([{ id: "tag-1", slug: "green-deal", name: "Green Deal" }]));
    await mountFollows();

    clickTab("tag");
    await waitFor(() => expect(rowCount("tag")).toBe(2));
    expect(tabCount("tag")).toBe(2);
    expect(hrefs("tag")).toEqual(["/tag/green-deal"]);
    expect(screen.getByText("#Green Deal")).toBeTruthy();
    expect(chain().lastChain("tags")?.argsOf("in")).toEqual(["id", ["tag-1", "tag-brak"]]);
    fireEvent.click(buttonsIn("tag")[0]);
    expect(h.followPayloads).toEqual([{ targetType: "tag", targetId: "tag-1", on: false }]);
  });

  it("PROGRAMY: nazwa PL po polsku, odnośnik do programu, payload z typem `program`", async () => {
    h.follows = [follow("program", "prog-1"), follow("program", "prog-brak")];
    chain().setResponse(
      "programs",
      ok([{ id: "prog-1", slug: "eu-fit", name_pl: "Fit for 55", name_en: null }]),
    );
    await mountFollows();

    clickTab("program");
    await waitFor(() => expect(rowCount("program")).toBe(2));
    expect(tabCount("program")).toBe(2);
    expect(hrefs("program")).toEqual(["/programs/eu-fit"]);
    expect(screen.getByText("Fit for 55")).toBeTruthy();
    expect(chain().lastChain("programs")?.argsOf("in")).toEqual(["id", ["prog-1", "prog-brak"]]);
    fireEvent.click(buttonsIn("program")[0]);
    expect(h.followPayloads).toEqual([{ targetType: "program", targetId: "prog-1", on: false }]);
  });

  it("PROGRAMY po angielsku: nazwa EN, a jej brak spada na PL", async () => {
    h.language = "en";
    h.follows = [follow("program", "prog-1"), follow("program", "prog-2")];
    chain().setResponse(
      "programs",
      ok([
        { id: "prog-1", slug: "eu-fit", name_pl: "Fit for 55", name_en: "Fit for 55 EN" },
        { id: "prog-2", slug: "eu-cbam", name_pl: "CBAM PL", name_en: null },
      ]),
    );
    await mountFollows();

    clickTab("program");
    await waitFor(() => expect(rowCount("program")).toBe(2));
    expect(screen.getByText("Fit for 55 EN")).toBeTruthy();
    expect(screen.getByText("CBAM PL")).toBeTruthy();
  });

  it("cztery rodzaje obserwacji w jednym koncie dają CZTERY zapytania i cztery zgodne liczniki", async () => {
    h.follows = [
      follow("author", "author-1"),
      follow("category", "cat-1"),
      follow("tag", "tag-1"),
      follow("program", "prog-1"),
    ];
    chain().setResponse(
      "profiles",
      ok([{ id: "author-1", display_name: "Anna Nowak", slug: "anna-nowak", avatar_url: null }]),
    );
    chain().setResponse(
      "categories",
      ok([{ id: "cat-1", slug: "energia", name_pl: "Energia", name_en: "Energy" }]),
    );
    chain().setResponse("tags", ok([{ id: "tag-1", slug: "green-deal", name: "Green Deal" }]));
    chain().setResponse(
      "programs",
      ok([{ id: "prog-1", slug: "eu-fit", name_pl: "Fit for 55", name_en: null }]),
    );
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(1));
    for (const [tab, table] of [
      ["author", "profiles"],
      ["category", "categories"],
      ["tag", "tags"],
      ["program", "programs"],
    ] as const) {
      expect(chain().chainsFor(table).length).toBe(1);
      clickTab(tab);
      await waitFor(() => expect(rowCount(tab)).toBe(1));
      expect(tabCount(tab)).toBe(1);
    }
  });
});
