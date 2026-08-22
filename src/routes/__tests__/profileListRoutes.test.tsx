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

  // NAPRAWIONE (defekty 1 i 2). Awaria hydracji nie jest już milczącą pustką.
  //
  // LICZNIK ZOSTAJE PRZY SUROWEJ LICZBIE ZAKŁADEK - i to jest właściwy wybór.
  // Odczyt `user_bookmarks` się udał, więc „Wpisy (2)" jest PRAWDĄ: dwie
  // zakładki istnieją. Kłamstwem była pusta lista pod tym licznikiem, bo
  // znaczyła „a jednak nic nie masz". Zerowanie licznika przy awarii mówiłoby
  // to samo kłamstwo, tylko drugą stroną. Kontraktem jest więc: licznik
  // ZGADZA SIĘ Z LISTĄ albo pod nim stoi komunikat, który wyjaśnia różnicę.
  it("licznik nigdy nie stoi nad MILCZĄCĄ pustką", async () => {
    h.bookmarks = [bookmark("post", "post-1"), bookmark("post", "post-2")];
    chain().setResponse("posts", fail("hydracja padła"));
    await mountBookmarks();

    await waitFor(() => expect(chain().chainsFor("posts").length).toBeGreaterThan(0));
    await waitFor(() => expect(node('[data-testid="hydration-error"]')).toBeTruthy());
    // Albo wiersze zgadzają się z licznikiem, albo różnicę wyjaśnia komunikat.
    const explained =
      rowCount("post") === tabCount("post") ||
      all('[data-tab-content="post"] [data-testid="hydration-error"]').length > 0;
    expect(explained).toBe(true);
  });

  it("AWARIA hydracji ma własny komunikat, odrębny od pustej listy", async () => {
    h.bookmarks = [bookmark("post", "post-1")];
    chain().setResponse("posts", fail("hydracja padła"));
    await mountBookmarks();

    await waitFor(() => expect(chain().chainsFor("posts").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(tabText("post")).toContain("profile.lists.loadFailed");
    // NIE komunikat pustki: „nie masz nic zapisanego" byłby tu nieprawdą.
    expect(tabText("post")).not.toContain("profile.bookmarks.empty");
  });

  it("awaria hydracji daje DROGĘ WYJŚCIA: ponowienie odczytu", async () => {
    let attempts = 0;
    h.bookmarks = [bookmark("post", "post-1")];
    chain().setResponse("posts", () => {
      attempts += 1;
      return attempts === 1 ? fail("hydracja padła") : ok([POST_ROWS[0]]);
    });
    await mountBookmarks();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByText("profile.lists.retry"));
    await waitFor(() => expect(rowCount("post")).toBe(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("zakładka STRON ma własną awarię hydracji i własne ponowienie", async () => {
    // Dwie zakładki, dwa niezależne zapytania: awaria stron nie może udawać
    // awarii wpisów ani odwrotnie.
    let attempts = 0;
    h.bookmarks = [bookmark("page", "page-1")];
    chain().setResponse("pages", () => {
      attempts += 1;
      return attempts === 1
        ? fail("hydracja padła")
        : ok([{ id: "page-1", slug: "zespol", title_pl: "Zespół", title_en: "Team" }]);
    });
    await mountBookmarks();

    clickTab("page");
    await waitFor(() => expect(tabText("page")).toContain("profile.lists.loadFailed"));
    fireEvent.click(screen.getByText("profile.lists.retry"));
    await waitFor(() => expect(rowCount("page")).toBe(1));
  });

  it("PUSTA lista zakładek nadal mówi „nic nie zapisałeś”, nie „awaria”", async () => {
    // Trzy stany muszą zostać rozłączne: pustka, awaria, oczekiwanie.
    h.bookmarks = [];
    await mountBookmarks();
    await waitFor(() => expect(tabText("post")).toContain("profile.bookmarks.empty"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(node('[data-tab-content="post"]').textContent).not.toContain("profile.lists.loadFailed");
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

  // NAPRAWIONE (defekty 3 i 4). Ta sama poprawka co przy zakładkach, ten sam
  // atom (`ListHydrationNotice`) i ten sam wybór: licznik zostaje przy liczbie
  // obserwacji (bo ta jest prawdziwa), a różnicę wyjaśnia komunikat.
  it("licznik obserwacji nigdy nie stoi nad MILCZĄCĄ pustką", async () => {
    h.follows = [follow("author", "author-1"), follow("author", "author-2")];
    chain().setResponse("profiles", fail("hydracja padła"));
    await mountFollows();

    await waitFor(() => expect(chain().chainsFor("profiles").length).toBeGreaterThan(0));
    await waitFor(() => expect(node('[data-testid="hydration-error"]')).toBeTruthy());
    const explained =
      rowCount("author") === tabCount("author") ||
      all('[data-tab-content="author"] [data-testid="hydration-error"]').length > 0;
    expect(explained).toBe(true);
  });

  it("AWARIA hydracji obserwacji ma własny komunikat, odrębny od pustki", async () => {
    h.follows = [follow("author", "author-1")];
    chain().setResponse("profiles", fail("hydracja padła"));
    await mountFollows();

    await waitFor(() => expect(chain().chainsFor("profiles").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(tabText("author")).toContain("profile.lists.loadFailed");
    expect(tabText("author")).not.toContain("profile.follows.empty");
  });

  it("awaria hydracji obserwacji daje ponowienie odczytu", async () => {
    let attempts = 0;
    h.follows = [follow("author", "author-1")];
    chain().setResponse("profiles", () => {
      attempts += 1;
      return attempts === 1
        ? fail("hydracja padła")
        : ok([{ id: "author-1", slug: "anna", display_name: "Anna", avatar_url: null }]);
    });
    await mountFollows();

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByText("profile.lists.retry"));
    await waitFor(() => expect(rowCount("author")).toBe(1));
  });

  it.each([
    ["category", "categories"],
    ["tag", "tags"],
    ["program", "programs"],
  ])("zakładka %s ma WŁASNĄ awarię hydracji i własne ponowienie", async (kind, table) => {
    // Cztery zakładki, cztery niezależne zapytania. Awaria jednej nie może
    // udawać awarii pozostałych - ani ich naprawiać.
    let attempts = 0;
    h.follows = [follow(kind as FollowTargetType, `${kind}-1`)];
    chain().setResponse(table, () => {
      attempts += 1;
      return attempts === 1
        ? fail("hydracja padła")
        : ok([
            {
              id: `${kind}-1`,
              slug: "x",
              name_pl: "X",
              name_en: "X",
              title_pl: "X",
              title_en: "X",
            },
          ]);
    });
    await mountFollows();

    clickTab(kind);
    await waitFor(() => expect(tabText(kind)).toContain("profile.lists.loadFailed"));
    fireEvent.click(screen.getByText("profile.lists.retry"));
    await waitFor(() => expect(rowCount(kind)).toBe(1));
  });

  it("PUSTA lista obserwacji nadal mówi „nikogo nie obserwujesz”", async () => {
    h.follows = [];
    await mountFollows();
    await waitFor(() => expect(tabText("author")).toContain("profile.follows.empty"));
    expect(screen.queryByRole("alert")).toBeNull();
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

// ---------------------------------------------------------------------------
// DOMKNIĘCIE GAŁĘZI: JĘZYK WIERSZA I ODPOWIEDŹ BAZY BEZ TREŚCI.
//
// Bloki niżej dowodzą dwóch rzeczy, których wcześniejsze testy tego pliku nie
// ruszały, a które użytkownik widzi natychmiast:
//
//   A. NAZWA W WIERSZU MA SPADEK NA DRUGI JĘZYK W OBIE STRONY. Wcześniej
//      udowodniony był tylko kierunek EN -> PL (angielski interfejs, brak
//      nazwy EN). Brakowało kierunku PL -> EN: konferencja albo program
//      wprowadzony przez redakcję tylko po angielsku ma dla polskiego
//      użytkownika pokazać nazwę angielską, a NIE pusty chip. Pusty wiersz na
//      liście obserwowanych jest defektem widocznym gołym okiem: użytkownik
//      widzi klikalny pasek bez ani jednego słowa i nie wie, co odsubskrybowuje.
//      Ta sama reguła dotyczy obserwowanego autora bez sluga I bez nazwy -
//      taki wiersz miałby sam przycisk.
//
//   B. PUSTE CIAŁO ODPOWIEDZI (`data: null`, `error: null`) NIE JEST PUSTĄ
//      LISTĄ. PostgREST potrafi odpowiedzieć bez treści przy zerowym błędzie.
//      Gdyby trasa przepuściła takie `null` dalej, `missing` policzyłoby się
//      na `null` (fałsz) i wyszłaby MILCZĄCA pustka pod niezerowym licznikiem -
//      dokładnie ten defekt, który ten plik już raz łapał dla awarii hydracji.
//      Ochroną jest `?? []` w każdym `queryFn`: null zamienia się w brak
//      wierszy, więc każda pozycja dostaje wiersz „niedostępne”, a licznik
//      nadal zgadza się z listą.
//
// CZEGO TE BLOKI NIE DUBLUJĄ: kierunku EN -> PL (jest wyżej, w blokach
// „KATEGORIE po angielsku” i „PROGRAMY po angielsku”), awarii hydracji
// (`fail(...)`, bloki o `ListHydrationNotice`) ani warstwy danych hooków.
// ---------------------------------------------------------------------------

describe("/profile/follows - spadek nazwy na drugi język i wiersz bez nazwy", () => {
  it("KATEGORIA bez nazwy polskiej pokazuje polskiemu użytkownikowi nazwę angielską, nie pusty chip", async () => {
    // Symetria do bloku „KATEGORIE po angielsku”: tam brakowało EN, tu PL.
    h.language = "pl";
    h.follows = [follow("category", "cat-tylko-en")];
    chain().setResponse(
      "categories",
      ok([{ id: "cat-tylko-en", slug: "green-deal", name_pl: null, name_en: "Green Deal" }]),
    );
    await mountFollows();

    clickTab("category");
    await waitFor(() => expect(rowCount("category")).toBe(1));
    const label = (node('[data-tab-content="category"] a').textContent ?? "").trim();
    expect(label).toBe("Green Deal");
    // Ani pustka, ani kreska - kreska znaczy „nazwy nie ma wcale”, a tu jest.
    expect(label).not.toBe("");
    expect(label).not.toBe("-");
    expect(hrefs("category")).toEqual(["/category/green-deal"]);
  });

  it("KATEGORIA bez OBU nazw dostaje kreskę, nie klikalny pasek bez treści", async () => {
    h.follows = [follow("category", "cat-bez-nazw")];
    chain().setResponse(
      "categories",
      ok([{ id: "cat-bez-nazw", slug: "bez-nazwy", name_pl: null, name_en: null }]),
    );
    await mountFollows();

    clickTab("category");
    await waitFor(() => expect(rowCount("category")).toBe(1));
    // Kreska jest tu JEDYNĄ informacją, że wiersz istnieje i da się go kliknąć.
    expect((node('[data-tab-content="category"] a').textContent ?? "").trim()).toBe("-");
    expect(hrefs("category")).toEqual(["/category/bez-nazwy"]);
  });

  it("PROGRAM bez nazwy polskiej pokazuje polskiemu użytkownikowi nazwę angielską", async () => {
    // Program prowadzony po angielsku (nazwa własna inicjatywy) - polski
    // użytkownik ma zobaczyć tę nazwę, a nie puste miejsce nad przyciskiem.
    h.language = "pl";
    h.follows = [follow("program", "prog-tylko-en")];
    chain().setResponse(
      "programs",
      ok([{ id: "prog-tylko-en", slug: "horizon", name_pl: null, name_en: "Horizon Europe" }]),
    );
    await mountFollows();

    clickTab("program");
    await waitFor(() => expect(rowCount("program")).toBe(1));
    const label = (node('[data-tab-content="program"] a').textContent ?? "").trim();
    expect(label).toBe("Horizon Europe");
    expect(label).not.toBe("");
    expect(hrefs("program")).toEqual(["/programs/horizon"]);
  });

  it("OBSERWOWANY bez sluga I bez nazwy dostaje kreskę, nie wiersz z samym przyciskiem", async () => {
    // Profil ukryty z listy autorów (brak sluga) i bez nazwy wyświetlanej:
    // bez kreski zostałby pasek, na którym widać wyłącznie „przestań obserwować”.
    h.follows = [follow("author", "author-anonim")];
    chain().setResponse(
      "profiles",
      ok([{ id: "author-anonim", display_name: null, slug: null, avatar_url: null }]),
    );
    await mountFollows();

    await waitFor(() => expect(rowCount("author")).toBe(1));
    const label = screen.getByText("-");
    expect(label.tagName).toBe("SPAN");
    // Brak sluga = brak odnośnika w nikąd, ale nazwa nadal musi być widoczna.
    expect(hrefs("author")).toEqual([]);
    expect(buttonsIn("author").length).toBe(1);
  });

  // DEFEKT. Program bez ŻADNEJ nazwy renderuje się jako PUSTY odnośnik.
  //
  // CO: `src/routes/profile.follows.tsx:325` liczy nazwę programu inline
  //     (`lang === "en" ? pr.name_en || pr.name_pl : pr.name_pl || pr.name_en`)
  //     i nie ma ostatniego ogniwa `|| "-"`. Gdy obie kolumny są puste,
  //     wyrażenie daje `null`, a `<Link>` renderuje się bez treści.
  // GDZIE: profile.follows.tsx:325 (wiersz programu). Kategorie w tej samej
  //     liście przechodzą przez `localize()` (linia 36), które kończy się na
  //     `|| "-"`, więc bliźniacza zakładka zachowuje się INACZEJ.
  // KONSEKWENCJA: w zakładce „Programy” użytkownik widzi klikalny pasek bez ani
  //     jednego słowa - sam przycisk „przestań obserwować” po prawej. Nie wie,
  //     co obserwuje ani czego się pozbywa, a licznik nad listą twierdzi, że
  //     pozycja jest. Wygląda to na zepsuty render, nie na brak danych,
  //     więc zgłoszenie idzie na aplikację, a nie na redakcję.
  it.fails(
    "DEFEKT: program bez OBU nazw daje PUSTY odnośnik, choć kategoria w tej samej liście daje kreskę",
    async () => {
      h.follows = [follow("program", "prog-bez-nazw")];
      chain().setResponse(
        "programs",
        ok([{ id: "prog-bez-nazw", slug: "bez-nazwy", name_pl: null, name_en: null }]),
      );
      await mountFollows();

      clickTab("program");
      await waitFor(() => expect(rowCount("program")).toBe(1));
      // Oczekiwanie zgodne z kategoriami: brak obu nazw = kreska, nie pustka.
      expect((node('[data-tab-content="program"] a').textContent ?? "").trim()).toBe("-");
    },
  );

  it("opis stanu faktycznego: pusty odnośnik programu ma jednak poprawny CEL", async () => {
    // To NIE jest życzenie, tylko zapis rzeczywistości obok defektu wyżej:
    // wiersz jest pusty wizualnie, ale odnośnik prowadzi tam, gdzie powinien,
    // więc naprawa polega na dołożeniu kreski, a nie na przebudowie wiersza.
    h.follows = [follow("program", "prog-bez-nazw")];
    chain().setResponse(
      "programs",
      ok([{ id: "prog-bez-nazw", slug: "bez-nazwy", name_pl: null, name_en: null }]),
    );
    await mountFollows();

    clickTab("program");
    await waitFor(() => expect(rowCount("program")).toBe(1));
    expect((node('[data-tab-content="program"] a').textContent ?? "").trim()).toBe("");
    expect(hrefs("program")).toEqual(["/programs/bez-nazwy"]);
  });
});

// Tabela przypadków TYPOWANA na wejściu - dzięki temu `kind` jest już
// `FollowTargetType` i nie trzeba go rzutować w treści testu.
const FOLLOW_TABLES: ReadonlyArray<readonly [FollowTargetType, string]> = [
  ["author", "profiles"],
  ["category", "categories"],
  ["tag", "tags"],
  ["program", "programs"],
];

describe("/profile/follows - odpowiedź bazy BEZ TREŚCI i lista obserwacji w locie", () => {
  it.each(FOLLOW_TABLES)(
    "zakładka %s: odpowiedź `data: null` bez błędu daje wiersze „niedostępne”, nie milczącą pustkę",
    async (kind, table) => {
      // PostgREST potrafi odpowiedzieć pustym ciałem przy `error: null`.
      // Bez `?? []` w `queryFn` `missing` policzyłoby się na `null` i pod
      // licznikiem „(2)” stanęłaby pusta lista - ten sam defekt, który ten plik
      // łapie dla awarii hydracji, tylko wywołany inaczej.
      h.follows = [follow(kind, `${kind}-1`), follow(kind, `${kind}-2`)];
      chain().setResponse(table, ok(null));
      await mountFollows();

      clickTab(kind);
      await waitFor(() => expect(rowCount(kind)).toBe(2));
      expect(tabCount(kind)).toBe(2);
      expect(screen.getAllByText("profile.follows.unavailable").length).toBe(2);
      // To nie jest stan awarii ani oczekiwania - komunikaty muszą zostać rozłączne.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(tabText(kind)).not.toContain("profile.lists.loadFailed");
      expect(tabText(kind)).not.toContain("profile.follows.empty");
    },
  );

  it("każdy martwy wiersz z pustej odpowiedzi da się sprzątnąć POD WŁASNYM identyfikatorem", async () => {
    // Wiersze „niedostępne” z pustej odpowiedzi nie mogą być klonami: kliknięcie
    // drugiego musi usunąć drugą obserwację, nie pierwszą.
    h.follows = [follow("tag", "tag-1"), follow("tag", "tag-2")];
    chain().setResponse("tags", ok(null));
    await mountFollows();

    clickTab("tag");
    await waitFor(() => expect(rowCount("tag")).toBe(2));
    fireEvent.click(buttonsIn("tag")[1]);
    expect(h.followPayloads).toEqual([{ targetType: "tag", targetId: "tag-2", on: false }]);
  });

  it("LISTA OBSERWACJI JESZCZE NIE WCZYTANA: zero zapytań hydracji i zero liczników", async () => {
    // `useFollows()` bez danych (pierwszy odczyt w locie). Trasa nie może
    // wywalić się na `undefined` ani ruszyć hydracji bez identyfikatorów -
    // inaczej każde wejście w panel wysyłałoby zapytanie `in ("id", [])`.
    // OPIS STANU FAKTYCZNEGO, NIE ŻYCZENIE: w tym momencie zakładka pokazuje
    // komunikat pustki, choć poprawniejsze byłoby oczekiwanie. Trasa nie
    // odróżnia tych dwóch stanów dla PIERWSZEGO kroku odczytu (odróżnia dla
    // drugiego - patrz `ListHydrationNotice`), więc tak to tu zapisujemy.
    h.follows = undefined;
    await mountFollows();

    expect(chain().chains.length).toBe(0);
    expect(tabCount("author")).toBe(0);
    expect(tabCount("category")).toBe(0);
    expect(tabCount("tag")).toBe(0);
    expect(tabCount("program")).toBe(0);
    expect(tabText("author")).toBe("profile.follows.empty");
  });
});

const BOOKMARK_TABLES: ReadonlyArray<readonly [BookmarkEntityType, string]> = [
  ["post", "posts"],
  ["page", "pages"],
];

describe("/profile/bookmarks - odpowiedź bazy BEZ TREŚCI i lista zakładek w locie", () => {
  it.each(BOOKMARK_TABLES)(
    "zakładka %s: odpowiedź `data: null` bez błędu daje wiersze „niedostępne”, a licznik zgadza się z listą",
    async (kind, table) => {
      h.bookmarks = [bookmark(kind, `${kind}-1`), bookmark(kind, `${kind}-2`)];
      chain().setResponse(table, ok(null));
      await mountBookmarks();

      clickTab(kind);
      await waitFor(() => expect(rowCount(kind)).toBe(2));
      expect(tabCount(kind)).toBe(2);
      expect(screen.getAllByText("profile.bookmarks.unavailable").length).toBe(2);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(tabText(kind)).not.toContain("profile.bookmarks.empty");
    },
  );

  it("pusta odpowiedź o STRONY nie woła `page_full_path` dla nieistniejącego wiersza", async () => {
    // RPC ścieżki biegnie PER wiersz. Gdyby `null` przeszło dalej, poleciałoby
    // wywołanie z `_page_id: undefined` - śmieciowe zapytanie na każde wejście.
    h.bookmarks = [bookmark("page", "page-1")];
    chain().setResponse("pages", ok(null));
    await mountBookmarks();

    clickTab("page");
    await waitFor(() => expect(rowCount("page")).toBe(1));
    expect(h.rpcCalls).toEqual([]);
  });

  it("LISTA ZAKŁADEK JESZCZE NIE WCZYTANA: zero zapytań hydracji i zero liczników", async () => {
    // Bliźniacza reguła do `/profile/follows` - i ten sam świadomy opis stanu
    // faktycznego: pierwszy krok odczytu nie ma własnego komunikatu oczekiwania.
    h.bookmarks = undefined;
    await mountBookmarks();

    expect(chain().chains.length).toBe(0);
    expect(tabCount("post")).toBe(0);
    expect(tabCount("page")).toBe(0);
    expect(tabText("post")).toBe("profile.bookmarks.empty");
  });
});
