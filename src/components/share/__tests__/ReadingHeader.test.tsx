// CO DOWODZI TEN PLIK
//   1. BRAMKA UJAWNIENIA PASKA - jedyny mechanizm, od którego zależy, czy
//      czytelnik ma na wpisie JAKIKOLWIEK chrome. Przypięte są OBIE drogi:
//      przejęcie od paska serwisu przez `IntersectionObserver` (obecny
//      `[data-site-header]`) i zapas pikselowy `showAfter` (brak paska
//      serwisu), a także `pinned`, które ujawnia pasek od pierwszej klatki i
//      NIE tworzy obserwatora. Wraz z nimi: guard na pustej liście wpisów
//      obserwatora, wygrana OSTATNIEGO wpisu, rozłączenie obserwatora przy
//      odmontowaniu oraz to, że ukryty pasek jest `aria-hidden` + `inert`
//      (klawiatura nie wchodzi w niewidoczne UI - axe: aria-hidden-focus).
//   2. UKRYCIE PASKA ZAMYKA OTWARTE MENU KONTA. Bez tego menu zostaje
//      rozwinięte w niewidocznym pasku i po ponownym ujawnieniu wyskakuje
//      użytkownikowi bez jego udziału.
//   3. ROZWIĄZANIE JĘZYKA (`pl`, `en`, `en-GB` przez `startsWith`, pusty
//      napis i BRAK języka - gałąź `?? "pl"`): każdy napis powłoki dostaje
//      JAWNE `lng` zgodne z rozwiązanym językiem, i ten sam język idzie do
//      widgetu wyszukiwania oraz do przycisku zapisu. Asercje na KLUCZACH.
//   4. STAN SESJI: gość dostaje `login` + `register` i ZERO `logout`;
//      zalogowany dostaje menu konta (`profile`, `bookmarks`, `settings`,
//      `logout`), a `logout` woła `signOut` DOKŁADNIE raz. Zamykanie menu
//      wszystkimi trzema drogami: Escape, kliknięcie poza menu, wybór pozycji
//      (kliknięcie WEWNĄTRZ menu go nie zamyka).
//   5. ŁAŃCUCH NAZWY WYŚWIETLANEJ - KAŻDE ramię osobno: `display_name` ->
//      `first_name + last_name` (i wariant z samym imieniem) -> człon lokalny
//      e-maila -> ostateczny spadek na pusty napis (inicjały `?`). To łańcuch
//      `||`, w którym pomyłka pokazuje czytelnikowi cudzy albo pusty identyfikator.
//   6. `useHasMounted`: przed zamontowaniem (render SSR) pasek NIE renderuje
//      stanu zależnego od przeglądarki - nawet z sesją pokazuje `login`/
//      `register` i kieruje mobilną ikonę konta na `/login`; po zamontowaniu
//      przełącza się na menu konta i `/profile`.
//   7. `centerLogo` x `hideLeftLogo` - wszystkie CZTERY kombinacje, bo te dwa
//      propy istnieją wyłącznie po to, by landing (np. /quiz) nie miał
//      podwójnego logo. Do tego cały łańcuch wyboru logotypu poziomego
//      (jasny/ciemny, `mobile` -> `main` -> warianty przeciwnego motywu) i
//      spadek na wordmark tekstowy przy braku ustawienia.
//   8. TYTUŁ: podany jedzie po kluczu `share.header.reading`; pusty NIE chowa
//      wiersza „aktualnie czytasz" - to DEFEKT, przypięty `it.fails` obok
//      zielonego testu stanu faktycznego.
//   9. `entityId`/`entityType` przekazane do `SaveArticleButton` (z domyślnym
//      `post`), a brak `entityId` = brak przycisku zapisu w pasku.
//  10. Klaster mobilny: lupa i hamburger emitują zdarzenia okna, na których
//      stoi SearchOverlay i drawer - bez nich po scrollu na wpisie nie ma ani
//      szukania, ani menu.
//  11. `axeViolations()` = [] dla gościa, dla zalogowanego i dla ROZWINIĘTEGO
//      menu konta.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   * `e2e/seo.spec.ts` (15 testów, kontrakt bajtowy na żywym SSR) - ANI JEDNA
//     asercja tego pliku nie dotyczy HTTP, nagłówków ani `<head>`. Tamten plik
//     dowodzi tras i bajtów: „sitemap.xml is a sitemapindex pointing at shard
//     files", „every sitemap listed in the index resolves to a urlset", „an
//     unknown sitemap shard is a 404, not an empty urlset", „sitemap-index.xml
//     redirects to the canonical index", „llms.txt is text/plain and lists
//     sections", „rss.xml returns a well-formed feed", „robots.txt comes from
//     the ROUTE, not a static file in public/", „robots.txt exposes crawl
//     policy", „robots.txt is served by the route, not by a static asset",
//     „content feeds respond for the tracker and live coverage", „podcast feed
//     is auto-discoverable from the podcast pages", „HTML sitemap /sitemap
//     renders navigable page", „head contract on ${path}" (parametryzowany),
//     „Q&A session emits QAPage or breadcrumb JSON-LD" oraz „/admin/seo is
//     auth-gated (redirects to /auth or /login)". Powłoka czytania nie jest tam
//     montowana ani sprawdzana - a tu ZERO wyjść do sieci.
//   * WNĘTRZE ATRAP: `SearchButtonWidget`, `LangSwitcherDropdown`,
//     `LangReelSwitcher`, `SaveArticleButton`, `ThemeToggle`,
//     `NotificationsBell`, `ChatBell` mają własnych właścicieli i własne testy.
//     Atrapy potwierdzają WYŁĄCZNIE przekazane propy - to jedyny kontrakt,
//     który należy do paska.
//   * `useHasMounted`, `rafThrottle`, `useHeaderProfile`, `useSiteSetting`,
//     `useAuth` są atrapami: tu liczy się REAKCJA paska na ich wynik, nie ich
//     własne zachowanie (klient Supabase nie jest nawet ładowany).
//   * POSTĘP CZYTANIA (`Math.min(1, Math.max(0, pct))`) NIE jest powierzchnią
//     tego komponentu - pasek czytania nie liczy żadnego postępu. Pierścień i
//     paski postępu żyją w `src/components/share/FloatingShareBar.tsx`
//     (`setProgress` w efekcie scrolla), więc klamry zakresu i stan „brak
//     treści do liczenia" należą do testu TAMTEGO pliku; dublowanie ich tutaj
//     przypinałoby zachowanie, którego `ReadingHeader.tsx` nie ma.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import type { BookmarkEntityType } from "@/hooks/useBookmarks";

/** Wiersz profilu, jaki pasek czyta z `useHeaderProfile`. */
interface HeaderProfileProbe {
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/** Propy, które pasek przekazuje atrapie `SaveArticleButton`. */
interface SaveProbeProps {
  title: string;
  lang: "pl" | "en";
  entityId?: string;
  entityType?: BookmarkEntityType;
  className?: string;
}

/** Propy widgetu wyszukiwania - pasek składa je z rozwiązanego języka. */
interface SearchProbeProps {
  label: string;
  heading: string;
  mode: string;
  lang: "pl" | "en";
  limit: number;
  liveResults: boolean;
  height: number;
  radius: number;
  fontSize: number;
}

/** Ustawienia Branding -> Logo, z których liczony jest logotyp poziomy. */
interface LogoSettings {
  logo?: { main?: string; main_dark?: string; mobile?: string; mobile_dark?: string };
}

const h = vi.hoisted(() => ({
  /**
   * `i18n.language` z instancji. `undefined` to stan PRZED inicjalizacją
   * i18next - jedyny, w którym wchodzi gałąź `?? "pl"` w pasku.
   */
  language: "pl" as string | undefined,
  mounted: true,
  session: null as { access_token: string } | null,
  user: null as { id: string; email?: string } | null,
  signOut: vi.fn<() => Promise<void>>(),
  profile: null as HeaderProfileProbe | null,
  /** Identyfikator, z jakim pasek pyta o profil nagłówka. */
  profileUserId: "nie-wywolano" as string | null | undefined,
  /** Klucz ustawień, po który sięga pasek (kontrakt z warstwą ustawień). */
  settingKey: "" as string,
  theme: "light" as "light" | "dark",
  themeSettings: {} as LogoSettings,
  save: null as SaveProbeProps | null,
  search: null as SearchProbeProps | null,
  reelLabel: null as string | null,
  reelClassName: null as string | null,
  dropdownLabel: null as string | null,
  notificationsWidth: 0,
  chatWidth: 0,
}));

// Atrapa i18n. `translateKey` pochodzi z `@/test/i18nStub` - fabryka `vi.mock`
// NIE MOŻE importować modułu produkcyjnego dochodzącego do `react-i18next`.
// Sam obiekt `i18n` budujemy tutaj, a nie przez `reactI18nextStub()`, z jednego
// powodu: `language` musi UMIEĆ być `undefined`, bo tylko wtedy wykonuje się
// gałąź `?? "pl"`. Poza tym kontrakt jest identyczny: jeden STABILNY obiekt
// `i18n` z getterem na `language`.
vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  const i18n = {
    get language(): string | undefined {
      return h.language;
    },
    t: translateKey,
  };
  return {
    useTranslation: () => ({ t: translateKey, i18n }),
    initReactI18next: { type: "3rdParty", init: () => {} },
    Trans: (props: { children?: unknown }) => props.children ?? null,
  };
});

// Słownik powłoki wchodzi do paska jako efekt uboczny importu; w teście nie ma
// czego rejestrować, a realny moduł ciągnąłby rdzeń i18n.
vi.mock("@/lib/i18n-share", () => ({}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, user: h.user, signOut: h.signOut }),
}));

vi.mock("@/lib/profile/useHeaderProfile", () => ({
  useHeaderProfile: (userId: string | null | undefined) => {
    h.profileUserId = userId;
    return { data: h.profile };
  },
}));

vi.mock("@/hooks/useHasMounted", () => ({ useHasMounted: () => h.mounted }));

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: (key: string) => {
    h.settingKey = key;
    return h.themeSettings;
  },
}));

vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ theme: h.theme, toggle: () => {} }),
}));

vi.mock("@/components/atoms/ThemeToggle", () => ({
  ThemeToggle: ({ className }: { className?: string }) => (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label="atrapa: przełącznik motywu"
      className={className}
    />
  ),
}));

vi.mock("@/components/atoms/SaveArticleButton", () => ({
  SaveArticleButton: (props: SaveProbeProps) => {
    h.save = props;
    return <button type="button" data-testid="save-article" aria-label="atrapa: zapisz" />;
  },
}));

vi.mock("@/components/builder/organisms/widget-view/SearchButtonWidget", () => ({
  SearchButtonWidget: (props: SearchProbeProps) => {
    h.search = props;
    return <div data-testid="search-widget" className="builder-search-widget" />;
  },
}));

vi.mock("@/components/builder/organisms/widget-view/chromeWidgets", () => ({
  LangSwitcherDropdown: ({ label }: { label: string }) => {
    h.dropdownLabel = label;
    return <div data-testid="lang-dropdown">{label}</div>;
  },
}));

vi.mock("@/components/atoms/LangReelSwitcher", () => ({
  LangReelSwitcher: ({ label, className }: { label: string; className?: string }) => {
    h.reelLabel = label;
    h.reelClassName = className ?? null;
    return (
      <div data-testid="lang-reel" className={className}>
        {label}
      </div>
    );
  },
}));

vi.mock("@/components/notifications/NotificationsBell", () => ({
  NotificationsBell: ({ panelWidth }: { panelWidth: number }) => {
    h.notificationsWidth = panelWidth;
    return <div data-testid="bell-notifications" />;
  },
}));

vi.mock("@/components/chat/ChatBell", () => ({
  ChatBell: ({ panelWidth }: { panelWidth: number }) => {
    h.chatWidth = panelWidth;
    return <div data-testid="bell-chat" />;
  },
}));

import { ReadingHeader } from "@/components/share/ReadingHeader";

const TITLE = "Rada UE przyjęła mandat negocjacyjny";

/** Wpis obserwatora w kształcie, jaki pasek FAKTYCZNIE czyta. */
interface IoEntryProbe {
  isIntersecting: boolean;
}

type IoCallbackProbe = (entries: IoEntryProbe[]) => void;

/**
 * Atrapa `IntersectionObserver`. happy-dom nie ma silnika układu, więc realny
 * obserwator nigdy nie odpaliłby callbacku - a właśnie ten callback jest tu
 * całą treścią zachowania (przejęcie chrome'u od paska serwisu). Atrapa
 * odwzorowuje dokładnie to, na czym stoją asercje: KTO jest obserwowany, kiedy
 * leci callback i czy `disconnect()` doszedł.
 */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets: Element[] = [];
  disconnected = 0;
  private readonly cb: IoCallbackProbe;
  readonly options?: { threshold?: number };

  constructor(cb: IoCallbackProbe, options?: { threshold?: number }) {
    this.cb = cb;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected += 1;
  }

  takeRecords(): IoEntryProbe[] {
    return [];
  }

  /** Emituje przecięcia w kolejności - pasek czyta OSTATNI wpis. */
  emit(...values: boolean[]): void {
    act(() => {
      this.cb(values.map((isIntersecting) => ({ isIntersecting })));
    });
  }
}

/** Jedyny obserwator utworzony przez pasek (asercja: dokładnie jeden). */
function observer(): FakeIntersectionObserver {
  const [first, ...rest] = FakeIntersectionObserver.instances;
  if (!first) throw new Error("pasek nie utworzył IntersectionObserver");
  if (rest.length > 0) throw new Error("pasek utworzył więcej niż jeden obserwator");
  return first;
}

/** Pasek serwisu, od którego powłoka czytania przejmuje chrome. */
function mountSiteHeader(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-site-header", "");
  document.body.appendChild(el);
  return el;
}

function setScrollY(value: number): void {
  Object.defineProperty(window, "scrollY", { configurable: true, value });
}

function bar(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-reading-header]");
  if (!el) throw new Error("pasek czytania nie jest w DOM");
  return el;
}

/** Ujawniony = poza drzewem dostępności NIE jest i nie ma `inert`. */
function revealed(): boolean {
  return bar().getAttribute("aria-hidden") === "false" && !bar().hasAttribute("inert");
}

interface HeaderOverrides {
  title?: string;
  showAfter?: number;
  entityId?: string;
  entityType?: BookmarkEntityType;
  pinned?: boolean;
  centerLogo?: boolean;
  hideLeftLogo?: boolean;
}

function header(o: HeaderOverrides = {}) {
  return (
    <ReadingHeader
      title={o.title ?? TITLE}
      showAfter={o.showAfter}
      entityId={o.entityId}
      entityType={o.entityType}
      pinned={o.pinned}
      centerLogo={o.centerLogo}
      hideLeftLogo={o.hideLeftLogo}
    />
  );
}

/**
 * Render bez providera zapytań: wszystkie hooki danych paska
 * (`useAuth`, `useHeaderProfile`, `useSiteSetting`) są atrapami, więc żadne
 * `useQuery` nie wchodzi do drzewa - klient Supabase nie jest nawet ładowany.
 */
function renderHeader(o: HeaderOverrides = {}) {
  return render(header(o));
}

/** Zalogowany czytelnik - sesja + użytkownik w jednym miejscu. */
function signIn(email?: string): void {
  h.session = { access_token: "token-testowy" };
  h.user = { id: "user-1", email };
}

/**
 * Przycisk menu konta. Rozróżnia go `aria-haspopup="menu"`, a NIE nazwa: pasek
 * daje ten sam klucz `share.header.menu` także mobilnemu hamburgerowi, więc
 * zapytanie po samej nazwie trafiałoby w dwa przyciski (oba są w DOM - który
 * klaster widać, decyduje wyłącznie CSS, którego happy-dom nie liczy).
 */
function menuButton(): HTMLElement {
  const el = bar().querySelector<HTMLElement>('button[aria-haspopup="menu"]');
  if (!el) throw new Error("brak przycisku menu konta");
  return el;
}

/** Hamburger klastra mobilnego - drugi konsument klucza `menu`. */
function hamburgerButton(): HTMLElement {
  const el = bar().querySelector<HTMLElement>('button[title="share.header.menu(lng=pl)"]');
  if (!el) throw new Error("brak hamburgera klastra mobilnego");
  return el;
}

beforeEach(() => {
  h.language = "pl";
  h.mounted = true;
  h.session = null;
  h.user = null;
  h.signOut.mockReset();
  h.signOut.mockResolvedValue(undefined);
  h.profile = null;
  h.profileUserId = "nie-wywolano";
  h.settingKey = "";
  h.theme = "light";
  h.themeSettings = {};
  h.save = null;
  h.search = null;
  h.reelLabel = null;
  h.reelClassName = null;
  h.dropdownLabel = null;
  h.notificationsWidth = 0;
  h.chatWidth = 0;
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  setScrollY(0);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll("[data-site-header]").forEach((el) => el.remove());
  setScrollY(0);
});

describe("ReadingHeader - bramka ujawnienia paska", () => {
  it("pinned: pasek jest widoczny od PIERWSZEJ klatki i nie zakłada obserwatora", () => {
    renderHeader({ pinned: true });

    // Bez `waitFor` - stan początkowy `useState(pinned)` musi już być odsłonięty,
    // bo /quiz nie ma innego chrome'u niż ten pasek.
    expect(revealed()).toBe(true);
    expect(bar().className).toContain("opacity-100");
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("pinned wygrywa nawet przy obecnym pasku serwisu (żadnej obserwacji)", () => {
    mountSiteHeader();
    renderHeader({ pinned: true });

    expect(revealed()).toBe(true);
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it("bez paska serwisu i poniżej progu 320 px pasek jest ukryty i WYJĘTY z fokusu", async () => {
    setScrollY(10);
    renderHeader();

    await waitFor(() => expect(bar().getAttribute("aria-hidden")).toBe("true"));
    expect(bar().hasAttribute("inert")).toBe(true);
    expect(bar().className).toContain("pointer-events-none");
    // Ukryty pasek nie istnieje dla klawiatury ani dla czytnika ekranu.
    expect(screen.queryByRole("link", { name: "share.header.login(lng=pl)" })).toBeNull();
  });

  it("powyżej domyślnego progu 320 px pasek się ujawnia", async () => {
    setScrollY(400);
    renderHeader();

    await waitFor(() => expect(revealed()).toBe(true));
    expect(screen.getByRole("link", { name: /share\.header\.login/ })).toBeInTheDocument();
  });

  it("własny showAfter ZASTĘPUJE domyślne 320 px", async () => {
    setScrollY(400);
    renderHeader({ showAfter: 800 });

    await waitFor(() => expect(bar().getAttribute("aria-hidden")).toBe("true"));

    setScrollY(900);
    fireEvent.scroll(window);
    await waitFor(() => expect(revealed()).toBe(true));
  });

  it("obecny pasek serwisu przełącza na obserwatora, a próg pikselowy NIE jest czytany", async () => {
    const siteHeader = mountSiteHeader();
    // Przewinięcie daleko za próg: gdyby pasek liczył piksele, byłby widoczny.
    setScrollY(5000);
    renderHeader();

    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1));
    expect(observer().targets).toEqual([siteHeader]);
    expect(observer().options?.threshold).toBe(0);
    expect(bar().getAttribute("aria-hidden")).toBe("true");

    // Pasek serwisu wyjechał z ekranu -> powłoka czytania przejmuje chrome.
    observer().emit(false);
    expect(revealed()).toBe(true);

    // Wrócił -> powłoka się chowa, żeby nie było dwóch pasków naraz.
    observer().emit(true);
    expect(revealed()).toBe(false);
  });

  it("pusta lista wpisów obserwatora nie zmienia stanu i nie wywala paska", async () => {
    mountSiteHeader();
    renderHeader();
    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1));

    observer().emit();

    expect(bar().getAttribute("aria-hidden")).toBe("true");
  });

  it("liczy się OSTATNI wpis obserwatora, nie pierwszy", async () => {
    mountSiteHeader();
    renderHeader();
    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1));

    observer().emit(true, false);

    expect(revealed()).toBe(true);
  });

  it("odmontowanie rozłącza obserwatora (brak wycieku po opuszczeniu wpisu)", async () => {
    mountSiteHeader();
    const view = renderHeader();
    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1));
    const io = observer();

    view.unmount();

    expect(io.disconnected).toBe(1);
  });

  it("ukrycie paska ZAMYKA otwarte menu konta", async () => {
    signIn("anna@example.test");
    mountSiteHeader();
    renderHeader();
    await waitFor(() => expect(FakeIntersectionObserver.instances).toHaveLength(1));
    observer().emit(false);

    fireEvent.click(menuButton());
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Pasek serwisu wrócił - powłoka się chowa razem z rozwiniętym menu.
    observer().emit(true);
    // Ponowne ujawnienie: menu NIE może wyskoczyć bez udziału użytkownika.
    observer().emit(false);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("ReadingHeader - język interfejsu", () => {
  const CASES: Array<{ language: string | undefined; expected: "pl" | "en"; opis: string }> = [
    { language: "pl", expected: "pl", opis: "polski" },
    { language: "en", expected: "en", opis: "angielski" },
    { language: "en-GB", expected: "en", opis: "angielski regionalny (startsWith)" },
    { language: "", expected: "pl", opis: "pusty napis" },
    { language: undefined, expected: "pl", opis: "brak języka (i18n przed inicjalizacją)" },
  ];

  it.each(CASES)(
    "$opis -> lng=$expected we WSZYSTKICH napisach powłoki",
    ({ language, expected }) => {
      h.language = language;
      renderHeader({ pinned: true, entityId: "post-1" });

      expect(h.search?.label).toBe(`share.header.search(lng=${expected})`);
      expect(h.search?.heading).toBe(`share.header.search(lng=${expected})`);
      expect(h.search?.lang).toBe(expected);
      expect(h.reelLabel).toBe(`share.header.lang(lng=${expected})`);
      expect(h.dropdownLabel).toBe(`share.header.lang(lng=${expected})`);
      expect(h.save?.lang).toBe(expected);
      expect(bar().querySelector("[data-reading-label]")?.textContent).toBe(
        `share.header.reading(lng=${expected}):`,
      );
      expect(
        screen.getByRole("link", { name: `share.header.login(lng=${expected})` }),
      ).toBeInTheDocument();
    },
  );

  it("pozostałe propy widgetu wyszukiwania są kontraktem paska, nie przypadkiem", () => {
    renderHeader({ pinned: true });

    expect(h.search).toMatchObject({
      mode: "dropdown",
      liveResults: true,
      limit: 8,
      height: 24,
      radius: 6,
      fontSize: 11,
    });
  });
});

describe("ReadingHeader - stan sesji", () => {
  it("gość dostaje login i register, a wylogowania NIE MA", () => {
    renderHeader({ pinned: true });

    expect(screen.getByRole("link", { name: "share.header.login(lng=pl)" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "share.header.register(lng=pl)" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.queryByRole("button", { name: "share.header.logout(lng=pl)" })).toBeNull();
    expect(bar().querySelector('button[aria-haspopup="menu"]')).toBeNull();
    // Bez sesji nie ma po co pytać o profil nagłówka.
    expect(h.profileUserId).toBeUndefined();
  });

  it("gościa mobilna ikona konta prowadzi na /login", () => {
    renderHeader({ pinned: true });

    expect(screen.getByRole("link", { name: "share.header.profile(lng=pl)" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("zalogowany dostaje menu konta z profilem, zapisanymi, ustawieniami i wylogowaniem", () => {
    signIn("anna@example.test");
    h.profile = {
      first_name: "Anna",
      last_name: "Nowak",
      display_name: null,
      avatar_url: null,
    };
    renderHeader({ pinned: true });

    expect(h.profileUserId).toBe("user-1");
    expect(screen.queryByRole("link", { name: "share.header.login(lng=pl)" })).toBeNull();

    fireEvent.click(menuButton());
    const menu = within(screen.getByRole("menu"));

    expect(menu.getByRole("menuitem", { name: /share\.header\.profile/ })).toHaveAttribute(
      "href",
      "/profile",
    );
    expect(menu.getByRole("menuitem", { name: /share\.header\.bookmarks/ })).toHaveAttribute(
      "href",
      "/profile/bookmarks",
    );
    expect(menu.getByRole("menuitem", { name: /share\.header\.settings/ })).toHaveAttribute(
      "href",
      "/profile/edit",
    );
    expect(menu.getByRole("menuitem", { name: /share\.header\.logout/ })).toBeInTheDocument();
    expect(menu.getByText("anna@example.test")).toBeInTheDocument();
  });

  it("wylogowanie woła signOut DOKŁADNIE raz i zamyka menu", () => {
    signIn("anna@example.test");
    renderHeader({ pinned: true });
    fireEvent.click(menuButton());

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: /share\.header\.logout/ }),
    );

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("brak e-maila w sesji = brak wiersza z adresem w nagłówku menu", () => {
    signIn(undefined);
    h.profile = {
      first_name: null,
      last_name: null,
      display_name: "Redakcja",
      avatar_url: null,
    };
    renderHeader({ pinned: true });

    fireEvent.click(menuButton());
    const menu = screen.getByRole("menu");

    expect(within(menu).getByText("Redakcja")).toBeInTheDocument();
    expect(menu.querySelectorAll("p")).toHaveLength(1);
  });

  it("zalogowanemu mobilna ikona konta prowadzi na /profile", () => {
    signIn("anna@example.test");
    renderHeader({ pinned: true });

    expect(screen.getByRole("link", { name: "share.header.profile(lng=pl)" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});

describe("ReadingHeader - zamykanie menu konta", () => {
  beforeEach(() => {
    signIn("anna@example.test");
  });

  it("przycisk menu przełącza rozwinięcie w obie strony", () => {
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape zamyka menu, inny klawisz go NIE zamyka", () => {
    renderHeader({ pinned: true });
    fireEvent.click(menuButton());

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("kliknięcie POZA menu zamyka, kliknięcie WEWNĄTRZ zostawia otwarte", () => {
    renderHeader({ pinned: true });
    fireEvent.click(menuButton());

    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // KAŻDA pozycja zamyka menu osobno: wisząca lista po przejściu na inną trasę
  // przykrywałaby treść wpisu, a pasek jest tu jedynym chrome'em.
  it.each(["profile", "bookmarks", "settings"])("wybór pozycji %s zamyka menu", (key) => {
    renderHeader({ pinned: true });
    fireEvent.click(menuButton());

    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: `share.header.${key}(lng=pl)`,
      }),
    );

    expect(screen.queryByRole("menu")).toBeNull();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("nazwa dostępna przycisku konta idzie z klucza `menu` - tego samego, co hamburger", () => {
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("aria-label", "share.header.menu(lng=pl)");
    // Ten sam klucz w dwóch klastrach to stan FAKTYCZNY paska: hamburger
    // (mobilny) i konto (desktop) są oba w DOM, a rozdziela je tylko CSS.
    expect(bar().querySelectorAll('[aria-label="share.header.menu(lng=pl)"]')).toHaveLength(2);
    expect(hamburgerButton()).not.toBe(menuButton());
  });
});

describe("ReadingHeader - łańcuch nazwy wyświetlanej", () => {
  beforeEach(() => {
    signIn("anna.nowak@example.test");
  });

  it("ramię 1: display_name wygrywa z imieniem, nazwiskiem i e-mailem", () => {
    h.profile = {
      first_name: "Anna",
      last_name: "Nowak",
      display_name: "Redaktor Naczelna",
      avatar_url: null,
    };
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("title", "Redaktor Naczelna");
    expect(within(menuButton()).getByText("Redaktor Naczelna")).toBeInTheDocument();
    expect(within(menuButton()).getByText("RN")).toBeInTheDocument();
  });

  it("ramię 2: brak display_name -> imię i nazwisko", () => {
    h.profile = { first_name: "Anna", last_name: "Nowak", display_name: null, avatar_url: null };
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("title", "Anna Nowak");
    expect(within(menuButton()).getByText("AN")).toBeInTheDocument();
  });

  it("ramię 2 z samym imieniem: puste nazwisko nie zostawia wiszącej spacji", () => {
    h.profile = { first_name: "Anna", last_name: null, display_name: null, avatar_url: null };
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("title", "Anna");
    expect(within(menuButton()).getByText("A")).toBeInTheDocument();
  });

  it("ramię 3: brak profilu -> człon lokalny e-maila", () => {
    h.profile = null;
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("title", "anna.nowak");
    expect(within(menuButton()).getByText("A")).toBeInTheDocument();
  });

  it("ramię 4 (ostateczny spadek): brak profilu i brak e-maila -> pusta nazwa, inicjał ?", () => {
    signIn(undefined);
    h.profile = null;
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("title", "");
    expect(within(menuButton()).getByText("?")).toBeInTheDocument();
  });

  it("profil z PUSTYMI polami spada do e-maila (puste napisy są falsy w łańcuchu)", () => {
    h.profile = { first_name: "", last_name: "", display_name: "", avatar_url: null };
    renderHeader({ pinned: true });

    expect(menuButton()).toHaveAttribute("title", "anna.nowak");
  });

  it("avatar zastępuje inicjały w przycisku menu i w mobilnej ikonie konta", () => {
    h.profile = {
      first_name: "Anna",
      last_name: "Nowak",
      display_name: null,
      avatar_url: "https://cdn.test/avatar.png",
    };
    renderHeader({ pinned: true });

    expect(within(menuButton()).queryByText("AN")).toBeNull();
    const avatars = bar().querySelectorAll<HTMLImageElement>(
      'img[src="https://cdn.test/avatar.png"]',
    );
    // Dwa miejsca: przycisk menu (desktop) i ikona konta (klaster mobilny).
    expect(avatars).toHaveLength(2);
    avatars.forEach((img) => expect(img.getAttribute("alt")).toBe(""));
  });
});

describe("ReadingHeader - przed zamontowaniem (render SSR)", () => {
  it("z sesją, ale przed montażem pasek renderuje stan GOŚCIA", () => {
    signIn("anna@example.test");
    h.mounted = false;
    renderHeader({ pinned: true });

    expect(screen.getByRole("link", { name: "share.header.login(lng=pl)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "share.header.register(lng=pl)" })).toBeInTheDocument();
    expect(bar().querySelector('button[aria-haspopup="menu"]')).toBeNull();
    // Mobilna ikona konta celuje w /login - inaczej pierwsza klatka po
    // hydratacji różniłaby się od HTML-a z serwera.
    expect(screen.getByRole("link", { name: "share.header.profile(lng=pl)" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("po zamontowaniu ten sam pasek przechodzi na menu konta i /profile", () => {
    signIn("anna@example.test");
    h.mounted = false;
    const view = renderHeader({ pinned: true });

    h.mounted = true;
    view.rerender(header({ pinned: true }));

    expect(screen.queryByRole("link", { name: "share.header.login(lng=pl)" })).toBeNull();
    expect(menuButton()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "share.header.profile(lng=pl)" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});

describe("ReadingHeader - logo: centerLogo x hideLeftLogo", () => {
  const LOGO_NAME = "New European Strategies";

  const leftLogo = () => bar().querySelector(`a[data-reading-icon][aria-label="${LOGO_NAME}"]`);
  const centerLogoEl = () =>
    bar().querySelector(`a[data-reading-title][aria-label="${LOGO_NAME}"]`);

  const COMBOS: Array<{
    centerLogo: boolean;
    hideLeftLogo: boolean;
    left: boolean;
    center: boolean;
  }> = [
    { centerLogo: false, hideLeftLogo: false, left: true, center: false },
    { centerLogo: true, hideLeftLogo: false, left: true, center: true },
    { centerLogo: false, hideLeftLogo: true, left: false, center: false },
    { centerLogo: true, hideLeftLogo: true, left: false, center: true },
  ];

  it.each(COMBOS)(
    "centerLogo=$centerLogo, hideLeftLogo=$hideLeftLogo -> lewa=$left, środek=$center",
    ({ centerLogo, hideLeftLogo, left, center }) => {
      renderHeader({ pinned: true, centerLogo, hideLeftLogo });

      expect(leftLogo() !== null).toBe(left);
      expect(centerLogoEl() !== null).toBe(center);
      // Para propów istnieje po to, by /quiz nie miał DWÓCH logotypów.
      const total = bar().querySelectorAll(`a[aria-label="${LOGO_NAME}"]`);
      expect(total.length).toBe(Number(left) + Number(center));
    },
  );

  it("kombinacja z /quiz (centerLogo + hideLeftLogo) daje DOKŁADNIE jedno logo", () => {
    renderHeader({ pinned: true, centerLogo: true, hideLeftLogo: true });

    expect(bar().querySelectorAll(`a[aria-label="${LOGO_NAME}"]`)).toHaveLength(1);
    expect(centerLogoEl()).toHaveAttribute("href", "/");
  });

  it("bez ustawienia logotypu obie kolumny pokazują wordmark tekstowy", () => {
    h.themeSettings = {};
    renderHeader({ pinned: true, centerLogo: true });

    expect(h.settingKey).toBe("theme_options");
    expect(bar().querySelectorAll("img")).toHaveLength(0);
    expect(leftLogo()?.textContent).toBe(LOGO_NAME);
    expect(centerLogoEl()?.textContent).toBe(LOGO_NAME);
  });

  const CHAIN: Array<{
    theme: "light" | "dark";
    logo: NonNullable<LogoSettings["logo"]>;
    expected: string;
    opis: string;
  }> = [
    {
      theme: "light",
      logo: { mobile: "m.png", main: "M.png", mobile_dark: "md.png", main_dark: "Md.png" },
      expected: "m.png",
      opis: "jasny: mobile wygrywa",
    },
    {
      theme: "light",
      logo: { main: "M.png", mobile_dark: "md.png" },
      expected: "M.png",
      opis: "jasny: brak mobile -> main",
    },
    {
      theme: "light",
      logo: { mobile_dark: "md.png", main_dark: "Md.png" },
      expected: "md.png",
      opis: "jasny: same warianty ciemne -> mobile_dark",
    },
    {
      theme: "light",
      logo: { main_dark: "Md.png" },
      expected: "Md.png",
      opis: "jasny: ostatnie ogniwo main_dark",
    },
    {
      theme: "dark",
      logo: { mobile: "m.png", main: "M.png", mobile_dark: "md.png", main_dark: "Md.png" },
      expected: "md.png",
      opis: "ciemny: mobile_dark wygrywa",
    },
    {
      theme: "dark",
      logo: { main_dark: "Md.png", mobile: "m.png" },
      expected: "Md.png",
      opis: "ciemny: brak mobile_dark -> main_dark",
    },
    {
      theme: "dark",
      logo: { mobile: "m.png", main: "M.png" },
      expected: "m.png",
      opis: "ciemny: same warianty jasne -> mobile",
    },
    {
      theme: "dark",
      logo: { main: "M.png" },
      expected: "M.png",
      opis: "ciemny: ostatnie ogniwo main",
    },
  ];

  it.each(CHAIN)("łańcuch logotypu, $opis", ({ theme, logo, expected }) => {
    h.theme = theme;
    h.themeSettings = { logo };
    renderHeader({ pinned: true });

    expect(leftLogo()?.querySelector("img")).toHaveAttribute("src", expected);
  });

  it("motyw ciemny bez ŻADNEGO wariantu logotypu spada na wordmark tekstowy", () => {
    h.theme = "dark";
    h.themeSettings = { logo: {} };
    renderHeader({ pinned: true });

    expect(bar().querySelectorAll("img")).toHaveLength(0);
    expect(leftLogo()?.textContent).toBe(LOGO_NAME);
  });

  it("centerLogo pokazuje w środkowej kolumnie OBRAZ logotypu, nie napis", () => {
    h.themeSettings = { logo: { mobile: "center.png" } };
    renderHeader({ pinned: true, centerLogo: true, hideLeftLogo: true });

    const img = centerLogoEl()?.querySelector("img");
    expect(img).toHaveAttribute("src", "center.png");
    // Dekoracyjne: nazwa marki jest już w `aria-label` linku, więc `alt` musi
    // zostać pusty - inaczej czytnik ekranu czyta ją dwa razy.
    expect(img).toHaveAttribute("alt", "");
    expect(centerLogoEl()?.textContent).toBe("");
  });

  it("puste napisy w ustawieniach nie wygrywają w łańcuchu logotypu", () => {
    h.theme = "light";
    h.themeSettings = { logo: { mobile: "", main: "M.png" } };
    renderHeader({ pinned: true });

    expect(leftLogo()?.querySelector("img")).toHaveAttribute("src", "M.png");
  });
});

describe('ReadingHeader - wiersz „aktualnie czytasz"', () => {
  it("tytuł jedzie po kluczu share.header.reading i trafia też do atrybutu title", () => {
    renderHeader({ pinned: true });

    expect(bar().querySelector("[data-reading-label]")?.textContent).toBe(
      "share.header.reading(lng=pl):",
    );
    const titleEl = bar().querySelector("[data-reading-title]");
    expect(titleEl?.textContent).toBe(TITLE);
    expect(titleEl).toHaveAttribute("title", TITLE);
  });

  it("centerLogo zdejmuje etykietę i tytuł ze środkowej kolumny", () => {
    renderHeader({ pinned: true, centerLogo: true });

    expect(bar().querySelector("[data-reading-label]")).toBeNull();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  // DEFEKT: pusty tytuł NIE chowa wiersza „aktualnie czytasz". Konsekwencja dla
  // użytkownika: na powierzchni bez tytułu (pasek montowany z pustym propem)
  // czytelnik widzi wiszącą etykietę „aktualnie czytasz:" bez żadnej treści po
  // niej, a czytnik ekranu odczytuje zapowiedź, po której nic nie następuje.
  // Środkowa kolumna zajmuje wtedy miejsce, nie wnosząc informacji.
  it.fails('DEFEKT: pusty tytuł powinien schować cały wiersz „aktualnie czytasz"', () => {
    renderHeader({ pinned: true, title: "" });

    expect(bar().querySelector("[data-reading-label]")).toBeNull();
    expect(bar().querySelector("[data-reading-title]")).toBeNull();
  });

  it("stan FAKTYCZNY: pusty tytuł zostawia etykietę i pusty tytuł (przypięcie do naprawy)", () => {
    renderHeader({ pinned: true, title: "" });

    expect(bar().querySelector("[data-reading-label]")?.textContent).toBe(
      "share.header.reading(lng=pl):",
    );
    const titleEl = bar().querySelector("[data-reading-title]");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toBe("");
    expect(titleEl).toHaveAttribute("title", "");
  });
});

describe("ReadingHeader - zapisz na później", () => {
  it("entityId i entityType idą do atomu zapisu razem z tytułem i językiem", () => {
    h.language = "en";
    renderHeader({ pinned: true, entityId: "page-7", entityType: "page" });

    expect(h.save).toMatchObject({
      title: TITLE,
      lang: "en",
      entityId: "page-7",
      entityType: "page",
    });
    expect(screen.getByTestId("save-article")).toBeInTheDocument();
  });

  it('bez entityType atom dostaje domyślne „post"', () => {
    renderHeader({ pinned: true, entityId: "post-1" });

    expect(h.save?.entityType).toBe("post");
  });

  it("bez entityId przycisku zapisu w pasku NIE MA", () => {
    renderHeader({ pinned: true });

    expect(screen.queryByTestId("save-article")).toBeNull();
    expect(h.save).toBeNull();
  });
});

describe("ReadingHeader - klaster mobilny i widgety poboczne", () => {
  it("lupa emituje neus:open-mobile-search, hamburger neus:open-mobile-menu", () => {
    const seen: string[] = [];
    const onSearch = () => seen.push("search");
    const onMenu = () => seen.push("menu");
    window.addEventListener("neus:open-mobile-search", onSearch);
    window.addEventListener("neus:open-mobile-menu", onMenu);
    try {
      renderHeader({ pinned: true });

      fireEvent.click(screen.getByRole("button", { name: "share.header.search(lng=pl)" }));
      fireEvent.click(hamburgerButton());
    } finally {
      window.removeEventListener("neus:open-mobile-search", onSearch);
      window.removeEventListener("neus:open-mobile-menu", onMenu);
    }

    expect(seen).toEqual(["search", "menu"]);
  });

  it("przełącznik języka w klastrze mobilnym dostaje etykietę i obniżoną wysokość", () => {
    renderHeader({ pinned: true });

    expect(h.reelLabel).toBe("share.header.lang(lng=pl)");
    expect(h.reelClassName).toBe("[--ls-h:28px]");
  });

  it("dzwonki dostają szerokości paneli, na których stoi ich układ", () => {
    renderHeader({ pinned: true });

    expect(h.notificationsWidth).toBe(280);
    expect(h.chatWidth).toBe(300);
  });
});

describe("ReadingHeader - dostępność", () => {
  it("gość: zero naruszeń axe", async () => {
    const { container } = renderHeader({ pinned: true, entityId: "post-1" });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zalogowany ze zwiniętym menu: zero naruszeń axe", async () => {
    signIn("anna@example.test");
    h.profile = {
      first_name: "Anna",
      last_name: "Nowak",
      display_name: null,
      avatar_url: "https://cdn.test/avatar.png",
    };
    const { container } = renderHeader({ pinned: true, entityId: "post-1" });

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zalogowany z ROZWINIĘTYM menu konta: zero naruszeń axe", async () => {
    signIn("anna@example.test");
    const { container } = renderHeader({ pinned: true });
    fireEvent.click(menuButton());

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
