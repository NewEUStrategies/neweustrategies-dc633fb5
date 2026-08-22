// Trasa `/reading-list` ZAMONTOWANA razem z jej organizmami i molekułami.
//
// CO TEN PLIK DOWODZI (nazwane po SKUTKU dla czytelnika, nie po nazwie funkcji):
//
//  1. TRZY BRAMKI DOSTĘPU DAJĄ TRZY RÓŻNE EKRANY. Wyłączona personalizacja
//     (decyzja administratora), gość bez trybu gościnnego (zaproszenie do
//     logowania z kontekstem, DLACZEGO się pojawiło) i wpuszczony gość
//     (lokalna lista + rekomendacje) to trzy rozłączne powierzchnie. Zlanie ich
//     zamieniało tę stronę w twardy login-wall.
//  2. GOŚĆ I ZALOGOWANY TO DWA RÓŻNE DRZEWA DANYCH. Sekcja gościa czyta
//     `localStorage`, sekcja zalogowanego pyta bazę. Ta sama zakładka, dwa
//     zupełnie inne źródła - i to jest testowany kontrakt sklejenia trasy.
//  3. PUSTKA, ŁADOWANIE I AWARIA TO TRZY OSOBNE KOMUNIKATY. „Nie masz
//     zapisanych" na awarii RPC mówi czytelnikowi, że system nic dla niego nie
//     ma, kiedy w rzeczywistości nie zdołał zapytać. W tym repo ta klasa
//     defektu wystąpiła trzy razy, dlatego każdy stan ma tu własny przypadek -
//     w tym DWA `it.fails` na miejsca, gdzie awaria nadal udaje brak danych.
//  4. ZAPYTANIA NIE LECĄ BEZ POWODU. Nazwy obserwowanych bytów nie są pytane,
//     gdy nie ma żadnej obserwacji; tabela `pages` nie jest pytana, gdy nie ma
//     zapisanych stron. Bez tego czytelnik z pustą listą i tak puka do trzech
//     tabel.
//  5. ZAPISANE STRONY WRACAJĄ NA LISTĘ. Strona zapisana z paska czytania
//     znikała bez śladu (rozjazd z `/profile/bookmarks`), bo sekcja filtrowała
//     wyłącznie `entity_type === "post"`. Pełna ścieżka pochodzi z bazy
//     (`page_full_path`), a nie ze wzorca trasy.
//  6. TRASA JEST `noindex`. Lista czytelnicza jest prywatną powierzchnią
//     jednego czytelnika - jej indeksacja to wyciek zainteresowań.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//  * ATOMÓW: `gridColsClass`, `localizedTitle`/`savedPageTitle`,
//    `reasonBadgeKey`, `buildFollowChips` i `readingListTabs` mają tabele
//    przypadków w `src/components/readingList/atoms/__tests__/readingListAtoms.test.ts`.
//    Tutaj dowodzimy, że organizmy je WOŁAJĄ i respektują wynik.
//  * MAGAZYNU GOŚCIA: parsowanie uszkodzonej wartości, brak `window` w SSR
//    i reguła „poprawny zapis" mają `src/lib/readingList/__tests__/guestSaved.test.ts`
//    i `guestSavedSsr.test.ts`.
//  * HOOKÓW DANYCH: `useBookmarks` ma `src/hooks/__tests__/useBookmarks.test.tsx`;
//    `useFollows`, `useFollowedFeed` i `useRecommendedPosts` są tu ATRAPAMI, bo
//    przedmiotem dowodu jest reakcja organizmu na ich stany, nie ich własny
//    kontrakt z bazą (ten pilnują pgTAP i `check:rpc-contract`).
//  * AUTORYZACJI: `user_bookmarks` / `user_follows` / `get_followed_feed` /
//    `get_recommended_posts_v2` mają RLS i pgTAP. Atrapa łańcucha nie odtwarza
//    ich reguł i nie udaje, że to robi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { buildFollowChips } from "@/components/readingList/atoms/followChips";
import { GUEST_SAVED_ARTICLES_KEY } from "@/lib/storageKeys";
import { onOpenLoginPopup, type LoginPopupOptions } from "@/lib/loginPopupBus";
import { axeViolations, summarize } from "@/test/axe";
import { ok, fail, type RecordedChain } from "@/test/supabaseChain";

/** Wiersz feedu obserwowanych / rekomendacji w zakresie kolumn karty. */
interface FeedRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  excerpt_pl: string;
  excerpt_en: string;
  cover_image_url: string;
  reasons: string[];
}

/** Zakładka z `user_bookmarks`. */
interface BookmarkRow {
  id: string;
  entity_type: "post" | "page";
  entity_id: string;
  created_at: string;
}

/** Obserwacja z `user_follows`. */
interface FollowRow {
  id: string;
  target_type: "author" | "category" | "tag";
  target_id: string;
  created_at: string;
}

const h = vi.hoisted(() => ({
  lang: "pl",
  user: null as { id: string } | null,
  personalizationEnabled: true,
  allowGuests: false,
  savedEnabled: true,
  followedEnabled: true,
  recommendedEnabled: true,
  columns: 3,
  /** `undefined` = brak wpisu w ustawieniach, czyli domyślny limit organizmu. */
  recommendedPerPage: 9 as number | undefined,

  /** `undefined` = zapytanie o zakładki jeszcze nie odpowiedziało. */
  bookmarks: [] as BookmarkRow[] | undefined,
  bookmarksLoading: false,

  follows: null as FollowRow[] | null,
  togglePending: false,
  toggleCalls: [] as { targetType: string; targetId: string; on: boolean }[],

  /** `null` = feed jeszcze w locie (osobny stan od PUSTEGO feedu). */
  feedPages: null as FeedRow[][] | null,
  feedLoading: false,
  feedHasNext: false,
  feedFetchingNext: false,
  feedNextCalls: 0,

  /** `undefined` = rekomendacje w locie; `[]` = pusta odpowiedź RPC. */
  recommended: undefined as FeedRow[] | undefined,
  recommendedError: null as Error | null,
  recommendedLimits: [] as number[],
  recommendedRefetches: 0,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

// Nakładka słownika rejestruje klucze efektem ubocznym importu; asercje stoją
// na KLUCZACH (atrapa i18n), więc rejestracja nie ma tu czego wnieść.
vi.mock("@/lib/i18n-reading-list", () => ({ ensureI18n: () => undefined }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  // Molekuły linkują do `/blog`, `/post/$slug`, `/author/$slug`, `/category/$slug`,
  // `/tag/$slug` i `/profile/interests` - tras, których w drzewie testowym nie ma.
  // Zaślepka renderuje PRAWDZIWY `<a href>` z podstawionymi parametrami, więc
  // asercje czytają docelowy adres, a nie wzorzec trasy.
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, session: h.user, loading: false }),
}));

vi.mock("@/hooks/usePersonalizedSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/usePersonalizedSettings")>();
  const base = actual.DEFAULT_PERSONALIZED_SETTINGS;
  return {
    ...actual,
    usePersonalizedSettings: () => ({
      ...base,
      enabled: h.personalizationEnabled,
      allowGuests: h.allowGuests,
      sections: {
        saved: { ...base.sections.saved, enabled: h.savedEnabled, columns: h.columns },
        followed: { ...base.sections.followed, enabled: h.followedEnabled, columns: h.columns },
        recommended: {
          ...base.sections.recommended,
          enabled: h.recommendedEnabled,
          columns: h.columns,
          postsPerPage: h.recommendedPerPage,
        },
      },
    }),
  };
});

vi.mock("@/hooks/useFollows", () => ({
  useFollows: () => ({ data: h.follows }),
  useToggleFollow: () => ({
    isPending: h.togglePending,
    mutate: (input: { targetType: string; targetId: string; on: boolean }) =>
      h.toggleCalls.push(input),
  }),
}));

vi.mock("@/hooks/useFollowedFeed", () => ({
  useFollowedFeed: () => ({
    data: h.feedPages === null ? undefined : { pages: h.feedPages },
    isLoading: h.feedLoading,
    hasNextPage: h.feedHasNext,
    isFetchingNextPage: h.feedFetchingNext,
    fetchNextPage: () => {
      h.feedNextCalls += 1;
      return Promise.resolve();
    },
  }),
}));

vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({ data: h.bookmarks, isLoading: h.bookmarksLoading }),
}));

vi.mock("@/hooks/useRecommendedPosts", () => ({
  useRecommendedPosts: (limit: number) => {
    h.recommendedLimits.push(limit);
    return {
      data: h.recommended,
      error: h.recommendedError,
      refetch: () => {
        h.recommendedRefetches += 1;
        return Promise.resolve();
      },
    };
  },
}));

// Atrapy klienta muszą powstać PRZED fabryką `vi.mock` i być TĄ SAMĄ instancją,
// którą widzi kod produkcyjny - inaczej test planuje odpowiedzi na jednym
// obiekcie, a organizm pyta drugi. `vi.hoisted` z asynchroniczną fabryką daje to
// bez ani jednego rzutowania: typy wracają wprost z harnessu.
const db = vi.hoisted(async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  return { chain: supabaseFromStub(), rpc: supabaseRpcStub() };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { chain, rpc } = await db;
  return { supabase: { from: chain.from, rpc: rpc.rpc } };
});

const { chain, rpc } = await db;

const { renderRoute, routeMeta } = await import("@/test/routeHarness");
const { Route: ReadingListRoute } = await import("@/routes/reading-list");

function feedRow(id: string, overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id,
    slug: id,
    title_pl: `Wpis ${id}`,
    title_en: `Post ${id}`,
    excerpt_pl: `Zajawka ${id}`,
    excerpt_en: `Excerpt ${id}`,
    cover_image_url: "",
    reasons: [],
    ...overrides,
  };
}

function bookmark(entity: "post" | "page", id: string): BookmarkRow {
  return {
    id: `b-${id}`,
    entity_type: entity,
    entity_id: id,
    created_at: "2026-08-20T10:00:00.000Z",
  };
}

function follow(type: "author" | "category" | "tag", id: string): FollowRow {
  return {
    id: `f-${id}`,
    target_type: type,
    target_id: id,
    created_at: "2026-08-20T10:00:00.000Z",
  };
}

/** Wiersz tabeli `posts` w zakresie kolumn, które czyta karta. */
function postRow(id: string, cover = "") {
  return {
    id,
    slug: id,
    title_pl: `Zapisany ${id}`,
    title_en: `Saved ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: cover === "" ? null : cover,
    published_at: "2026-08-01T10:00:00.000Z",
    parent_page_id: "page-1",
  };
}

async function mount() {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({
      route: ReadingListRoute,
      path: "/reading-list",
      initialEntry: "/reading-list",
    });
  });
  return view;
}

/** Przełącza zakładkę po jej etykiecie redakcyjnej z ustawień personalizacji. */
async function selectTab(label: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
}

/** Nasłuch magistrali okna logowania - bez atrapy, na prawdziwym zdarzeniu. */
function recordLoginPopups(): { seen: LoginPopupOptions[]; stop: () => void } {
  const seen: LoginPopupOptions[] = [];
  const stop = onOpenLoginPopup((opts) => seen.push(opts));
  return { seen, stop };
}

beforeEach(() => {
  // Tylko `Date` - liczniki React Query i `waitFor` muszą zostać na prawdziwym
  // zegarze, inaczej oczekiwanie na render nigdy się nie kończy.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  h.lang = "pl";
  h.user = null;
  h.personalizationEnabled = true;
  h.allowGuests = false;
  h.savedEnabled = true;
  h.followedEnabled = true;
  h.recommendedEnabled = true;
  h.columns = 3;
  h.recommendedPerPage = 9;
  h.bookmarks = [];
  h.bookmarksLoading = false;
  h.follows = null;
  h.togglePending = false;
  h.toggleCalls = [];
  h.feedPages = null;
  h.feedLoading = false;
  h.feedHasNext = false;
  h.feedFetchingNext = false;
  h.feedNextCalls = 0;
  h.recommended = undefined;
  h.recommendedError = null;
  h.recommendedLimits = [];
  h.recommendedRefetches = 0;
  chain.reset();
  rpc.reset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/reading-list - kontrakt adresu i nagłówka", () => {
  it("lista czytelnicza NIE jest indeksowalna i ma własny tytuł zakładki", async () => {
    // Prywatna powierzchnia jednego czytelnika: indeks to wyciek zainteresowań.
    const meta = await routeMeta(ReadingListRoute);
    expect(meta).toEqual([
      { title: "Twoja lista do przeczytania" },
      { name: "robots", content: "noindex" },
    ]);
  });
});

describe("/reading-list - bramki dostępu", () => {
  it("administrator wyłączył personalizację: zaślepka BEZ przycisku logowania", async () => {
    // To nie jest brak uprawnień czytelnika - logowanie nic tu nie zmieni,
    // więc przycisku nie ma z zamysłu.
    h.personalizationEnabled = false;
    await mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "readingList.disabledTitle" }),
    ).toBeTruthy();
    expect(screen.getByText("readingList.disabledBody")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gość bez trybu gościnnego dostaje zaproszenie do logowania Z KONTEKSTEM", async () => {
    // Okno logowania niesie tytuł i opis z ustawień personalizacji, żeby na
    // każdej powierzchni serwisu tłumaczyło TO SAMO „po co się logować".
    await mount();
    const bus = recordLoginPopups();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "readingList.signIn" }));
    });
    bus.stop();
    expect(bus.seen).toEqual([
      {
        title: "Dołącz do społeczności",
        description:
          "Załóż konto, aby zapisywać ulubione artykuły i wracać do nich w dowolnym momencie.",
      },
    ]);
  });

  it("wpuszczony gość widzi listę, a nie login-wall", async () => {
    h.allowGuests = true;
    h.recommended = [];
    await mount();
    expect(screen.getByText("readingList.guestSavedInfo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "readingList.signIn" })).toBeNull();
  });

  it("wyłączona sekcja NIE zostawia zakładki prowadzącej do pustki", async () => {
    h.allowGuests = true;
    h.followedEnabled = false;
    h.recommendedEnabled = false;
    await mount();
    const tabs = screen.getAllByRole("button").map((b) => b.textContent);
    expect(tabs).toEqual(["Twoja lista do przeczytania"]);
  });
});

describe("/reading-list - ZAPISANE u gościa: źródłem jest magazyn przeglądarki", () => {
  beforeEach(() => {
    h.allowGuests = true;
  });

  it("pozycje z magazynu trafiają na listę wraz z datą zapisu", async () => {
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([
        { url: "/post/energia", title: "Energia w Europie", savedAt: 1755000000000 },
      ]),
    );
    await mount();
    expect(screen.getByRole("link", { name: "Energia w Europie" })).toHaveAttribute(
      "href",
      "/post/energia",
    );
    // Data jest sformatowana w języku interfejsu i wchodzi jako PARAMETR klucza.
    expect(screen.getByText(/readingList\.savedAt\(date=/)).toBeTruthy();
  });

  it("pozycja BEZ tytułu pokazuje adres, zamiast pustego odnośnika", async () => {
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([{ url: "/post/bez-tytulu", title: "", savedAt: 1755000000000 }]),
    );
    await mount();
    expect(screen.getByRole("link", { name: "/post/bez-tytulu" })).toBeTruthy();
  });

  it("uszkodzony znacznik czasu NIE wypisuje czytelnikowi „Invalid Date”", async () => {
    // Wpis mógł powstać w starszej wersji hooka zapisywania - wtedy zamiast
    // daty nie ma nic, a nie napis, który wygląda na awarię aplikacji.
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([{ url: "/post/stary", title: "Stary wpis", savedAt: "nie-data" }]),
    );
    await mount();
    expect(screen.getByRole("link", { name: "Stary wpis" })).toBeTruthy();
    expect(screen.queryByText(/readingList\.savedAt/)).toBeNull();
  });

  it("data zapisu jest formatowana w JĘZYKU RENDERU, nie zawsze po polsku", async () => {
    // Ta sama liczba milisekund czyta się inaczej w obu wersjach serwisu; data
    // w polskim formacie na stronie angielskiej wygląda jak błąd danych.
    h.lang = "en";
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([{ url: "/post/a", title: "A", savedAt: 1755000000000 }]),
    );
    await mount();
    expect(screen.getByText("readingList.savedAt(date=12/08/2025)")).toBeTruthy();
  });

  it("PUSTY magazyn daje stan pusty z drogą dalej, a nie „spróbuj ponownie”", async () => {
    // Pustka nie jest awarią: czytelnik dostaje wyjście do artykułów.
    await mount();
    expect(screen.getByText("readingList.guestSavedEmpty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "readingList.browseArticles" })).toHaveAttribute(
      "href",
      "/blog",
    );
    expect(screen.queryByText("readingList.retry")).toBeNull();
  });

  it("usunięcie pozycji zabiera ją z widoku I z magazynu", async () => {
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([
        { url: "/post/a", title: "A", savedAt: 1755000000000 },
        { url: "/post/b", title: "B", savedAt: 1755000000000 },
      ]),
    );
    // Metody magazynu w happy-dom NIE są dziedziczone z `Storage.prototype`,
    // więc szpieg musi siedzieć na INSTANCJI - podmiana prototypu przechodzi
    // obok wywołania i „dowodzi" zapisu, którego nie było.
    const setItem = vi.spyOn(window.localStorage, "setItem");
    await mount();
    const rows = screen.getAllByRole("listitem");
    await act(async () => {
      fireEvent.click(within(rows[0]).getByRole("button", { name: "readingList.guestRemove" }));
    });
    expect(screen.queryByRole("link", { name: "A" })).toBeNull();
    expect(screen.getByRole("link", { name: "B" })).toBeTruthy();
    expect(setItem).toHaveBeenCalledWith(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([{ url: "/post/b", title: "B", savedAt: 1755000000000 }]),
    );
  });

  it("gość w zakładce OBSERWOWANE dostaje zachętę, nie pustą sekcję", async () => {
    await mount();
    await selectTab("Obserwowane");
    expect(screen.getByText("readingList.followedGuest")).toBeTruthy();
    const bus = recordLoginPopups();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "readingList.signIn" }));
    });
    bus.stop();
    expect(bus.seen).toHaveLength(1);
  });

  // AWARIA MAGAZYNU UDAJE UDANE USUNIĘCIE (defekt zachowania, nie testu).
  //
  // PLIK: src/components/readingList/organisms/GuestSavedSection.tsx, linie 33-39
  //       (`writeGuestSaved(next)` w reduktorze `setItems`).
  // MECHANIZM: `writeGuestSaved` NIGDY nie rzuca - odmowę magazynu (tryb
  //   prywatny Safari, wyczerpany limit) zgłasza wynikiem `false`
  //   (`src/lib/readingList/guestSaved.ts`, linie 83-89). Organizm ten wynik
  //   IGNORUJE i bezwarunkowo zwraca nową listę ze stanu w pamięci.
  // KONSEKWENCJA DLA UŻYTKOWNIKA: pozycja znika z ekranu, więc czytelnik jest
  //   przekonany, że ją usunął - a po odświeżeniu karty wraca. Lista gościa
  //   żyje wyłącznie w magazynie, więc „usunięcie" bez zapisu jest usunięciem
  //   pozornym i nie ma żadnego innego miejsca, gdzie mogłoby się utrwalić.
  // DLACZEGO NAPRAWA JEST DECYZJĄ DLA CZŁOWIEKA: trzeba wybrać zachowanie,
  //   którego dziś nie ma - cofnąć usunięcie (pozycja wraca na ekran), pokazać
  //   ostrzeżenie („nie możemy zapisać na tym urządzeniu"), czy przejść na
  //   magazyn w pamięci na czas sesji. Każdy z tych wariantów zmienia to, co
  //   czytelnik widzi, więc nie jest refaktorem pod test.
  it.fails("usunięcie, którego magazyn ODMÓWIŁ, nie może wyglądać na udane", async () => {
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([{ url: "/post/a", title: "A", savedAt: 1755000000000 }]),
    );
    await mount();
    // Odmowa magazynu (tryb prywatny / wyczerpany limit). Szpieg siedzi na
    // INSTANCJI - w happy-dom metody magazynu nie są dziedziczone z prototypu.
    // `finally` jest tu konieczne: asercja tego testu MA rzucić (`it.fails`),
    // więc bez niego atrapa przeżyłaby test i zatruła sąsiadów w tym pliku.
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "readingList.guestRemove" }));
      });
      // Zapis się nie udał, więc pozycja NADAL jest zapisana - czytelnik musi to
      // widzieć, zamiast dowiedzieć się o tym po odświeżeniu strony.
      expect(screen.getByRole("link", { name: "A" })).toBeTruthy();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("/reading-list - ZAPISANE u zalogowanego: źródłem jest baza", () => {
  beforeEach(() => {
    h.user = { id: "u1" };
  });

  it("wpisy i STRONY z zakładek trafiają na jedną listę", async () => {
    // Strona zapisana z paska czytania znikała bez śladu, bo sekcja filtrowała
    // wyłącznie `entity_type === "post"` - rozjazd z `/profile/bookmarks`.
    h.bookmarks = [bookmark("post", "p1"), bookmark("page", "s1")];
    chain.setResponse("posts", ok([postRow("p1")]));
    chain.setResponse(
      "pages",
      ok([{ id: "s1", slug: "o-nas", title_pl: "O nas", title_en: "About" }]),
    );
    rpc.setData("page_full_path", "instytut/o-nas");
    await mount();
    expect(await screen.findByRole("link", { name: /Zapisany p1/ })).toBeTruthy();
    expect(screen.getByText("readingList.savedPagesHeading")).toBeTruthy();
    // Pełną ścieżkę zna baza, nie wzorzec trasy - i musi zacząć się od „/".
    expect(screen.getByRole("link", { name: "O nas" })).toHaveAttribute("href", "/instytut/o-nas");
    expect(rpc.lastCall("page_full_path")?.arg("_page_id")).toBe("s1");
  });

  it("ścieżka strony już z wiodącym ukośnikiem nie dostaje drugiego", async () => {
    h.bookmarks = [bookmark("page", "s1")];
    chain.setResponse(
      "pages",
      ok([{ id: "s1", slug: "o-nas", title_pl: "O nas", title_en: "About" }]),
    );
    rpc.setData("page_full_path", "/instytut/o-nas");
    await mount();
    expect(await screen.findByRole("link", { name: "O nas" })).toHaveAttribute(
      "href",
      "/instytut/o-nas",
    );
  });

  it("gdy baza nie zna ścieżki strony, odnośnik spada na jej slug", async () => {
    // Pozycja bez adresu byłaby zapisem, do którego czytelnik nie może wrócić -
    // a to on sam ją zapisał.
    h.bookmarks = [bookmark("page", "s1")];
    chain.setResponse("pages", ok([{ id: "s1", slug: "o-nas", title_pl: null, title_en: null }]));
    rpc.setData("page_full_path", "");
    await mount();
    expect(await screen.findByRole("link", { name: "o-nas" })).toHaveAttribute("href", "/o-nas");
  });

  it("PUSTA odpowiedź bazy o zapisanych stronach nie wywraca sekcji", async () => {
    // `null` w miejscu wierszy (bez błędu) to nadal POPRAWNA odpowiedź „nic nie
    // znalazłem" - sekcja ma pokazać wpisy i pominąć listę stron, a nie polec
    // na iterowaniu po niczym.
    h.bookmarks = [bookmark("post", "p1"), bookmark("page", "s1")];
    chain.setResponse("posts", ok([postRow("p1")]));
    chain.setResponse("pages", ok(null));
    await mount();
    expect(await screen.findByRole("link", { name: /Zapisany p1/ })).toBeTruthy();
    expect(screen.queryByText("readingList.savedPagesHeading")).toBeNull();
  });

  it("ZAKŁADKI W LOCIE to „ładowanie”, a nie stan pusty", async () => {
    h.bookmarks = undefined;
    h.bookmarksLoading = true;
    await mount();
    expect(screen.getByText("readingList.loading")).toBeTruthy();
    expect(screen.queryByText("readingList.savedEmpty")).toBeNull();
  });

  it("BRAK zakładek to stan PUSTY i ani jedno zapytanie o treść", async () => {
    await mount();
    expect(screen.getByText("readingList.savedEmpty")).toBeTruthy();
    // Bez `enabled` czytelnik bez zapisanych stron i tak pukałby do `pages`.
    expect(chain.chainsFor("posts")).toHaveLength(0);
    expect(chain.chainsFor("pages")).toHaveLength(0);
  });

  it("zapisane WPISY nie wywołują zapytania o zapisane STRONY", async () => {
    h.bookmarks = [bookmark("post", "p1")];
    chain.setResponse("posts", ok([postRow("p1")]));
    await mount();
    expect(await screen.findByRole("link", { name: /Zapisany p1/ })).toBeTruthy();
    expect(chain.chainsFor("pages")).toHaveLength(0);
    // Zapytanie o wpisy zawęża się do opublikowanych i nieusuniętych.
    const posts: RecordedChain | undefined = chain.lastChain("posts");
    expect(posts?.argsOf("in")).toEqual(["id", ["p1"]]);
    expect(posts?.argsOf("eq")).toEqual(["status", "published"]);
    expect(posts?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("okładka wpisu jest DEKORACYJNA - nazwę odnośnika niesie nagłówek karty", async () => {
    h.bookmarks = [bookmark("post", "p1")];
    chain.setResponse("posts", ok([postRow("p1", "https://cdn.example/okladka.jpg")]));
    const view = await mount();
    await screen.findByRole("link", { name: /Zapisany p1/ });
    const img = view.container.querySelector("img");
    expect(img).toHaveAttribute("alt", "");
  });

  it("wersja angielska bierze tytuł EN", async () => {
    h.lang = "en";
    h.bookmarks = [bookmark("post", "p1")];
    chain.setResponse("posts", ok([postRow("p1")]));
    await mount();
    expect(await screen.findByRole("link", { name: /Saved p1/ })).toBeTruthy();
  });

  // AWARIA ODCZYTU TREŚCI UDAJE WIECZNE ŁADOWANIE (defekt zachowania).
  //
  // PLIK: src/components/readingList/organisms/SavedSection.tsx, linie 91-94
  //       (`contentLoading` = „są identyfikatory, ale nie ma jeszcze danych").
  // MECHANIZM: `postsQ.data` jest `undefined` zarówno WTEDY, gdy zapytanie
  //   jeszcze biegnie, jak i wtedy, gdy odpowiedziało BŁĘDEM (queryFn rzuca na
  //   `error` z PostgREST, linia 61). Warunek nie rozróżnia tych dwóch sytuacji,
  //   a `postsQ.isError` nie jest w ogóle czytany.
  // KONSEKWENCJA DLA UŻYTKOWNIKA: przy odmowie bazy czytelnik z zapisanymi
  //   wpisami patrzy na „Ładowanie..." bez końca - bez komunikatu i bez
  //   przycisku ponowienia. Nie wie, że coś się zepsuło, więc nie ma powodu
  //   odświeżyć strony ani zgłosić błędu. Sekcja REKOMENDACJI obok robi to
  //   poprawnie (błąd -> komunikat + „spróbuj ponownie"), więc ta sama strona
  //   zachowuje się w dwóch zakładkach niespójnie.
  // DLACZEGO NAPRAWA JEST DECYZJĄ DLA CZŁOWIEKA: trzeba dopisać CZWARTY stan do
  //   trzech, które nagłówek organizmu opisuje jako rozłączne, i zdecydować, co
  //   z częściową awarią (wpisy weszły, strony nie): pokazać to, co się udało,
  //   z paskiem ostrzeżenia, czy zastąpić całą sekcję kartą błędu. To zmiana
  //   ZACHOWANIA widoku, nie refaktor pod test.
  it.fails("odmowa bazy przy zapisanych wpisach mówi o AWARII, nie o ładowaniu", async () => {
    h.bookmarks = [bookmark("post", "p1"), bookmark("page", "s1")];
    chain.setResponse("posts", fail("permission denied for table posts", "42501"));
    chain.setResponse("pages", fail("permission denied for table pages", "42501"));
    await mount();
    await waitFor(() => expect(chain.chainsFor("posts").length).toBeGreaterThan(0));
    await waitFor(() => expect(chain.chainsFor("pages").length).toBeGreaterThan(0));
    expect(screen.queryByText("readingList.loading")).toBeNull();
  });
});

describe("/reading-list - OBSERWOWANE: chipy obserwacji i feed", () => {
  beforeEach(() => {
    h.user = { id: "u1" };
  });

  async function openFollowed() {
    await mount();
    await selectTab("Obserwowane");
  }

  it("BRAK obserwacji zaprasza do wyboru zainteresowań i nie pyta o nazwy", async () => {
    // To nie pustka feedu: czytelnik jeszcze niczego nie wybrał, więc nie ma
    // czego pokazywać - i nie ma o co pytać trzech tabel.
    h.follows = [];
    await openFollowed();
    expect(screen.getByText("readingList.followedEmpty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "readingList.followedEmptyCta" })).toHaveAttribute(
      "href",
      "/profile/interests",
    );
    expect(chain.chains).toHaveLength(0);
  });

  it("dopóki lista obserwacji nie odpowiedziała, ŻADNA tabela nazw nie jest pytana", async () => {
    // `undefined` z hooka to nie „zero obserwacji" - ale i tak nie ma o co
    // pytać, więc czytelnik nie generuje trzech odczytów w próżnię.
    h.follows = null;
    await openFollowed();
    expect(chain.chains).toHaveLength(0);
    expect(screen.getByText("readingList.followedEmpty")).toBeTruthy();
  });

  it("chipy obserwacji pokazują nazwy z bazy i prowadzą do archiwów", async () => {
    h.follows = [follow("author", "a1"), follow("category", "c1"), follow("tag", "t1")];
    h.feedPages = [[]];
    chain.setResponse(
      "profiles",
      ok([
        {
          id: "a1",
          display_name: "Anna Nowak",
          avatar_url: "https://cdn/a.png",
          slug: "anna-nowak",
        },
      ]),
    );
    chain.setResponse(
      "categories",
      ok([{ id: "c1", name_pl: "Gospodarka", name_en: "Economy", slug: "gospodarka" }]),
    );
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    await openFollowed();
    expect(await screen.findByRole("link", { name: "Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    expect(screen.getByRole("link", { name: "Gospodarka" })).toHaveAttribute(
      "href",
      "/category/gospodarka",
    );
    expect(screen.getByRole("link", { name: "#nato" })).toHaveAttribute("href", "/tag/nato");
    expect(screen.getByText("readingList.yourFollows")).toBeTruthy();
  });

  it("obserwacja JEDNEGO rodzaju nie pyta o dwa pozostałe", async () => {
    h.follows = [follow("tag", "t1")];
    h.feedPages = [[]];
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    await openFollowed();
    expect(await screen.findByRole("link", { name: "#nato" })).toBeTruthy();
    expect(chain.chainsFor("categories")).toHaveLength(0);
    expect(chain.chainsFor("profiles")).toHaveLength(0);
  });

  it("autor BEZ nazwy i BEZ sluga dostaje etykietę zapasową i ŻADNEGO odnośnika", async () => {
    // Link w nikąd jest gorszy niż jego brak: profil publiczny takiej osoby
    // nie istnieje.
    h.follows = [follow("author", "a1")];
    h.feedPages = [[]];
    chain.setResponse(
      "profiles",
      ok([{ id: "a1", display_name: null, avatar_url: null, slug: null }]),
    );
    await openFollowed();
    expect(await screen.findByText("readingList.anonymousAuthor")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "readingList.anonymousAuthor" })).toBeNull();
  });

  it("„przestań obserwować” zgłasza WYŁĄCZENIE obserwacji tego bytu", async () => {
    h.follows = [follow("category", "c1")];
    h.feedPages = [[]];
    chain.setResponse(
      "categories",
      ok([{ id: "c1", name_pl: "Gospodarka", name_en: "Economy", slug: "gospodarka" }]),
    );
    await openFollowed();
    await screen.findByRole("link", { name: "Gospodarka" });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "readingList.unfollow(name=Gospodarka)" }),
      );
    });
    expect(h.toggleCalls).toEqual([{ targetType: "category", targetId: "c1", on: false }]);
  });

  it("w trakcie zmiany obserwacji krzyżyki są ZABLOKOWANE", async () => {
    // Dwa kliknięcia w to samo chipy dawałyby dwa sprzeczne zapisy.
    h.follows = [follow("tag", "t1")];
    h.feedPages = [[]];
    h.togglePending = true;
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    await openFollowed();
    expect(
      await screen.findByRole("button", { name: "readingList.unfollow(name=#nato)" }),
    ).toBeDisabled();
  });

  it("FEED W LOCIE to „ładowanie”, a PUSTY FEED to inny komunikat i inna przyczyna", async () => {
    h.follows = [follow("tag", "t1")];
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    h.feedLoading = true;
    await openFollowed();
    expect(screen.getByText("readingList.loading")).toBeTruthy();
    expect(screen.queryByText("readingList.followedFeedEmpty")).toBeNull();

    cleanup();
    h.feedLoading = false;
    h.feedPages = [[]];
    await openFollowed();
    // Obserwacje SĄ - tylko nic nowego nie wyszło. To zupełnie inne zdanie niż
    // „nie obserwujesz jeszcze nikogo".
    expect(screen.getByText("readingList.followedFeedEmpty")).toBeTruthy();
    expect(screen.queryByText("readingList.followedEmpty")).toBeNull();
  });

  it("feed pokazuje wpisy z badge'em POWODU i deduplikuje po identyfikatorze", async () => {
    // Publikacja nowego wpisu między stronami przesuwa okno offsetu, więc ten
    // sam rekord potrafi wrócić na kolejnej stronie.
    h.follows = [follow("tag", "t1")];
    h.feedPages = [
      [feedRow("f1", { reasons: ["tag", "author"] }), feedRow("f2")],
      [feedRow("f2"), feedRow("f3", { reasons: ["nieznany-powod"] })],
    ];
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    await openFollowed();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    // Badge bierze najbardziej OSOBISTY powód: autor bije tag.
    expect(screen.getByText("readingList.reasons.author")).toBeTruthy();
    // Nieznany kod z nowszej wersji RPC NIE renderuje pustego badge'a.
    expect(screen.queryByText("readingList.reasons.")).toBeNull();
  });

  it("„wczytaj więcej” pojawia się tylko wtedy, gdy jest co wczytać", async () => {
    h.follows = [follow("tag", "t1")];
    h.feedPages = [[feedRow("f1")]];
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    await openFollowed();
    expect(screen.queryByRole("button", { name: "readingList.loadMore" })).toBeNull();

    cleanup();
    h.feedHasNext = true;
    await openFollowed();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "readingList.loadMore" }));
    });
    expect(h.feedNextCalls).toBe(1);
  });

  it("w trakcie dociągania kolejnej strony przycisk jest zablokowany i mówi „ładowanie”", async () => {
    h.follows = [follow("tag", "t1")];
    h.feedPages = [[feedRow("f1")]];
    h.feedHasNext = true;
    h.feedFetchingNext = true;
    chain.setResponse("tags", ok([{ id: "t1", name: "nato", slug: "nato" }]));
    await openFollowed();
    expect(screen.getByRole("button", { name: "readingList.loading" })).toBeDisabled();
  });

  it("gdy nazwy obserwowanych bytów nie przyszły, FEED nadal dowozi wpisy", async () => {
    // Degradacja CZĘŚCIOWA jest tu pożądana: brak nazw nie może zabrać
    // czytelnikowi treści, po którą przyszedł. (Że brak nazw nie zostawia
    // ŻADNEGO śladu, mówi `it.fails` poniżej - to osobna sprawa.)
    h.follows = [follow("author", "a1"), follow("category", "c1"), follow("tag", "t1")];
    h.feedPages = [[feedRow("f1")]];
    chain.setResponse("categories", fail("permission denied for table categories", "42501"));
    chain.setResponse("tags", fail("permission denied for table tags", "42501"));
    chain.setResponse("profiles", fail("permission denied for table profiles", "42501"));
    const view = await mount();
    await selectTab("Obserwowane");
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
    expect(screen.getByRole("link", { name: /Wpis f1/ })).toBeTruthy();
  });

  it("domyślna etykieta chipa jest NIEOSIĄGALNA z publicznego API", () => {
    // `molecules/FollowChips.tsx` linia 41 ma podwójny zapas:
    //   `chip.label ?? t(chip.fallbackKey ?? "readingList.anonymousAuthor")`.
    // Drugiego `??` NIE DA SIĘ wywołać przez trasę i nie farmujemy go sztucznym
    // renderem molekuły z wymyślonym propsem. Jedynym producentem chipów jest
    // atom `buildFollowChips`, a on ustawia `fallbackKey` na KAŻDYM chipie
    // autora - i tylko chip autora może mieć `label: null` (kategoria spada na
    // `name_pl`, tag zawsze dostaje `#name`). Ten test USTALA ten niezmiennik:
    // dopóki jest prawdziwy, domyślna etykieta w molekule jest kodem martwym,
    // a nie luką w pokryciu.
    const chips = buildFollowChips(
      {
        authors: [{ id: "a1", display_name: null, avatar_url: null, slug: null }],
        cats: [{ id: "c1", name_pl: "Gospodarka", name_en: "", slug: "gospodarka" }],
        tags: [{ id: "t1", name: "nato", slug: "nato" }],
      },
      "en",
    );
    const bezNazwy = chips.filter((chip) => chip.label === null);
    expect(bezNazwy).toHaveLength(1);
    expect(bezNazwy.every((chip) => typeof chip.fallbackKey === "string")).toBe(true);
  });

  // ODMOWA BAZY GUBI CHIPY BEZ ŚLADU (defekt zachowania).
  //
  // PLIK: src/components/readingList/organisms/FollowedSection.tsx, linie 59-84
  //       (`queryFn` zapytania `followed-entities`).
  // MECHANIZM: trzy odczyty w `Promise.all` czytają WYŁĄCZNIE `.data`
  //   (`cats.data ?? []`, `tags.data ?? []`, `authors.data ?? []`, linia 83).
  //   Pole `error` z PostgREST nie jest w ogóle sprawdzane, więc odmowa bazy
  //   daje pustą tablicę - tak samo jak brak wierszy. `buildFollowChips`
  //   dostaje zero źródeł, a `FollowChips` przy pustej liście zwraca `null`
  //   (`molecules/FollowChips.tsx`, linia 33).
  // KONSEKWENCJA DLA UŻYTKOWNIKA: czytelnik, który OBSERWUJE autorów i tematy,
  //   widzi zakładkę bez ani jednego chipa - czyli komunikat „nie obserwujesz
  //   niczego", którego nikt nie napisał. Traci przy tym jedyne miejsce, w którym
  //   może przestać obserwować byt jednym kliknięciem, i nie dowiaduje się, że
  //   coś zawiodło.
  // DLACZEGO NAPRAWA JEST DECYZJĄ DLA CZŁOWIEKA: te trzy odczyty są CZĘŚCIOWE
  //   z natury (kategorie mogą wejść, autorzy nie), więc trzeba wybrać kontrakt:
  //   rzucić na pierwszym błędzie (feed zostaje, chipy znikają z komunikatem),
  //   pokazać chipy, które się udały, i ostrzeżenie o resztcie, czy wyświetlić
  //   identyfikator jako etykietę zapasową. Każdy wariant zmienia to, co
  //   czytelnik widzi.
  it.fails(
    "odmowa bazy przy nazwach obserwowanych bytów nie może udawać braku obserwacji",
    async () => {
      h.follows = [follow("category", "c1")];
      h.feedPages = [[]];
      chain.setResponse("categories", fail("permission denied for table categories", "42501"));
      await openFollowed();
      await waitFor(() => expect(chain.chainsFor("categories").length).toBeGreaterThan(0));
      expect(screen.getByText("readingList.yourFollows")).toBeTruthy();
    },
  );
});

describe("/reading-list - REKOMENDACJE: trzy rozłączne stany", () => {
  async function openRecommended() {
    await mount();
    await selectTab("Rekomendowane dla Ciebie");
  }

  it("AWARIA RPC mówi o niej wprost i daje jedyną akcję, która ma sens", async () => {
    // Zlanie awarii z pustką powiedziałoby czytelnikowi, że system nie ma dla
    // niego propozycji - kiedy w rzeczywistości nie zdołał zapytać.
    h.user = { id: "u1" };
    h.recommendedError = new Error("get_recommended_posts_v2 padło");
    await openRecommended();
    expect(screen.getByText("readingList.recommendedError")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "readingList.retry" }));
    });
    expect(h.recommendedRefetches).toBe(1);
    expect(screen.queryByText("readingList.recommendedEmpty")).toBeNull();
  });

  it("BRAK DANYCH to „ładowanie rekomendacji”, a nie pustka", async () => {
    h.user = { id: "u1" };
    h.recommended = undefined;
    await openRecommended();
    expect(screen.getByText("readingList.loadingRecommendations")).toBeTruthy();
    expect(screen.queryByText("readingList.recommendedEmpty")).toBeNull();
  });

  it("PUSTA lista zaprasza do obserwowania kategorii", async () => {
    h.user = { id: "u1" };
    h.recommended = [];
    await openRecommended();
    expect(screen.getByText("readingList.recommendedEmpty")).toBeTruthy();
  });

  it("rekomendacje działają TAKŻE dla gościa i niosą powód wyświetlenia", async () => {
    h.allowGuests = true;
    h.recommended = [feedRow("r1", { reasons: ["history"] })];
    await openRecommended();
    expect(screen.getByRole("link", { name: /Wpis r1/ })).toHaveAttribute("href", "/post/r1");
    expect(screen.getByText("readingList.reasons.history")).toBeTruthy();
    expect(screen.getByText("Zajawka r1")).toBeTruthy();
  });

  it("limit rekomendacji pochodzi z ustawień, a jego brak spada na 9", async () => {
    h.user = { id: "u1" };
    h.recommended = [];
    h.recommendedPerPage = 4;
    await openRecommended();
    expect(h.recommendedLimits.at(-1)).toBe(4);

    cleanup();
    h.recommendedPerPage = undefined;
    h.recommendedLimits = [];
    await openRecommended();
    expect(h.recommendedLimits.at(-1)).toBe(9);
  });
});

describe("/reading-list - zakładki jako nawigacja", () => {
  it("nagłówek i opis sekcji zmieniają się razem z zakładką", async () => {
    // Etykieta i nagłówek to teksty REDAKCYJNE z panelu personalizacji, więc
    // nie przechodzą przez i18n - i muszą się zgadzać z wybraną zakładką.
    h.user = { id: "u1" };
    h.recommended = [];
    await mount();
    expect(
      screen.getByRole("heading", { level: 1, name: "Twoja lista do przeczytania" }),
    ).toBeTruthy();
    await selectTab("Rekomendowane dla Ciebie");
    expect(
      screen.getByRole("heading", { level: 1, name: "Rekomendowane dla Ciebie" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Wybrane na podstawie Twoich zainteresowań i historii czytania."),
    ).toBeTruthy();
  });

  it("liczba kolumn siatki pochodzi z ustawień administratora", async () => {
    h.user = { id: "u1" };
    h.columns = 4;
    h.bookmarks = [bookmark("post", "p1")];
    chain.setResponse("posts", ok([postRow("p1")]));
    const view = await mount();
    await screen.findByRole("link", { name: /Zapisany p1/ });
    expect(view.container.querySelector(".lg\\:grid-cols-4")).not.toBeNull();
  });
});

describe("/reading-list - dostępność", () => {
  it("widok gościa nie ma naruszeń dostępności", async () => {
    h.allowGuests = true;
    h.recommended = [];
    window.localStorage.setItem(
      GUEST_SAVED_ARTICLES_KEY.key,
      JSON.stringify([{ url: "/post/a", title: "A", savedAt: 1755000000000 }]),
    );
    const view = await mount();
    expect(summarize(await axeViolations(view.container))).toBe("");
  });

  // NARUSZENIE DOSTĘPNOŚCI ZGŁOSZONE, NIE NAPRAWIONE.
  //
  // NARUSZENIE: `heading-order` (1 węzeł) - kolejność nagłówków przeskakuje
  //   z poziomu 1 na 3.
  // PLIKI I LINIE: `src/routes/reading-list.tsx` linia 90 renderuje jedyny `h1`
  //   strony (nagłówek sekcji z ustawień personalizacji), a karty wpisów
  //   `src/components/readingList/molecules/ReadingListPostCard.tsx` linia 60
  //   oraz nadlinia zapisanych stron
  //   `src/components/readingList/molecules/SavedPagesList.tsx` linia 42
  //   renderują `h3`. Między nimi NIE MA żadnego `h2`.
  // KONSEKWENCJA DLA UŻYTKOWNIKA: czytnik ekranu buduje z nagłówków spis treści
  //   strony. Przeskok 1 -> 3 sugeruje pominięty poziom, więc użytkownik
  //   nawigujący klawiszem nagłówków słyszy „nagłówek poziomu 3" bez sekcji,
  //   do której miałby należeć - i nie wie, czy przegapił blok treści.
  //   Zakładka OBSERWOWANE tego problemu NIE MA, bo `FollowChips` renderuje
  //   `h2` („Obserwujesz") i domyka drabinkę - czyli ta sama strona jest
  //   dostępna w jednej zakładce, a niedostępna w drugiej.
  // DLACZEGO NAPRAWA JEST DECYZJĄ DLA CZŁOWIEKA: trzeba wybrać, CO jest tu
  //   poziomem drugim. Albo karty schodzą na `h4`/`h3` pod nowym, widocznym
  //   `h2` sekcji (zmiana układu strony, którą widzi każdy czytelnik), albo
  //   `h2` jest ukryty klasą `sr-only` (zmiana wyłącznie dla czytników ekranu,
  //   ale dodaje niewidzialny tekst do słownika), albo karty przestają używać
  //   nagłówków (zmiana semantyki karty używanej w trzech zakładkach). To
  //   decyzja o strukturze dokumentu, nie refaktor pod test.
  it.fails("widok zalogowanego z danymi nie ma naruszeń dostępności", async () => {
    h.user = { id: "u1" };
    h.bookmarks = [bookmark("post", "p1"), bookmark("page", "s1")];
    chain.setResponse("posts", ok([postRow("p1", "https://cdn.example/okladka.jpg")]));
    chain.setResponse(
      "pages",
      ok([{ id: "s1", slug: "o-nas", title_pl: "O nas", title_en: "About" }]),
    );
    rpc.setData("page_full_path", "/o-nas");
    const view = await mount();
    await screen.findByRole("link", { name: /Zapisany p1/ });
    expect(summarize(await axeViolations(view.container))).toBe("");
  });

  it("zakładka OBSERWOWANE z chipami nie ma naruszeń dostępności", async () => {
    h.user = { id: "u1" };
    h.follows = [follow("author", "a1")];
    h.feedPages = [[feedRow("f1", { reasons: ["author"] })]];
    chain.setResponse(
      "profiles",
      ok([
        {
          id: "a1",
          display_name: "Anna Nowak",
          avatar_url: "https://cdn/a.png",
          slug: "anna-nowak",
        },
      ]),
    );
    const view = await mount();
    await selectTab("Obserwowane");
    await screen.findByRole("link", { name: "Anna Nowak" });
    expect(summarize(await axeViolations(view.container))).toBe("");
  });
});
