// Regresja banera cookie - kompaktowej karty i jej panelu preferencji.
// Pilnuje rzeczy, które łatwo zepsuć przy zmianie wyglądu:
//  1. odrzucenie jest tak samo dostępne jak akceptacja (przycisk + „X”),
//  2. „X” ODRZUCA, a nie zamyka po cichu (wytyczne CNIL) - i ma inną etykietę
//     niż przycisk odrzucenia, żeby czytnik ekranu nie czytał dwóch takich samych,
//  3. panel „Dostosuj” ma cztery kategorie, niezbędne są zablokowane,
//     a „Zapisz wybrane” zapisuje dokładnie zaznaczony zestaw,
//  4. teksty idą z konfiguracji w wersji PL/EN (bez hardkodów w komponencie),
//  5. w kaflu ikony ląduje logo marki, a bez logo - zapasowa ikona.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";

import type { ConsentState } from "@/lib/ads/consent";
import { requestOverlaySlot, __resetOverlayCoordinator } from "@/lib/overlayCoordinator";

const h = vi.hoisted(() => ({
  state: null as ConsentState | null,
  save: vi.fn(),
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  logo: { current: "https://cdn.example.com/mark.svg" as string },
  /** `useConsent().mounted` - przejęcie powłoki (P1.3) startuje z `false`. */
  mounted: true,
  gpc: { active: false, source: "none" as "none" | "navigator" },
}));

vi.mock("@/lib/ads/consent", () => ({
  OPEN_PREFS_EVENT: "consent-open-preferences",
  consumeOpenPrefsRequest: () => false,
  useConsent: () => ({
    state: h.state,
    decided: h.mounted ? !!h.state : true,
    mounted: h.mounted,
    save: h.save,
    acceptAll: h.acceptAll,
    rejectAll: h.rejectAll,
    clear: vi.fn(),
  }),
  useGpcSignal: () => h.gpc,
}));

// Ustawienia witryny: baner bierze domyślne wartości (klucz -> `defaults`),
// logo podstawiamy pod `theme_options` (jedyne źródło znaku marki), a stronę
// polityki pod `privacy` - bez slugu komponent celowo renderuje sam tekst.
vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: <T,>(key: string, defaults: T): T => {
    if (key === "theme_options") {
      return {
        logo: {
          main: "",
          main_dark: "",
          mobile: h.logo.current,
          mobile_dark: "",
          transparent: "",
          transparent_dark: "",
          sidebar_expanded: "",
          sidebar_expanded_dark: "",
        },
      } as T;
    }
    if (key === "privacy") {
      return { privacy_page_slug: "polityka-prywatnosci", cookie_banner: true } as T;
    }
    return defaults;
  },
}));

vi.mock("@/components/ThemeProvider", () => ({ useTheme: () => ({ theme: "light" }) }));

import i18n from "@/lib/i18n";
import { ConsentBanner } from "@/components/ConsentBanner";
import { COOKIE_BANNER_DEFAULTS } from "@/lib/cookieBanner/config";
import { REGISTRY_BY_CATEGORY } from "@/lib/cookieBanner/registry";

const PL = COOKIE_BANNER_DEFAULTS.copy.pl;
const EN = COOKIE_BANNER_DEFAULTS.copy.en;

beforeEach(async () => {
  h.state = null;
  h.mounted = true;
  h.gpc = { active: false, source: "none" };
  __resetOverlayCoordinator();
  h.logo.current = "https://cdn.example.com/mark.svg";
  h.save.mockClear();
  h.acceptAll.mockClear();
  h.rejectAll.mockClear();
  await i18n.changeLanguage("pl");
});

afterEach(() => {
  cleanup();
  __resetOverlayCoordinator();
  vi.useRealTimers();
});

const openPrefs = () => fireEvent.click(screen.getByRole("button", { name: PL.customize }));

describe("ConsentBanner - kompaktowa karta", () => {
  it("pokazuje tytuł, obie polityki i równorzędne akcje zgody", () => {
    render(<ConsentBanner />);

    expect(screen.getByRole("dialog", { name: PL.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: PL.policyLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zasady przetwarzania danych" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PL.acceptAll })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PL.rejectAll })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PL.customize })).toBeInTheDocument();
  });

  it("„Akceptuj wszystkie” zapisuje pełną zgodę", () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: PL.acceptAll }));
    expect(h.acceptAll).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });

  it("„X” jest odrzuceniem, a jego etykieta różni się od przycisku odrzucenia", () => {
    render(<ConsentBanner />);

    const close = screen.getByRole("button", { name: `Zamknij (${PL.rejectAll})` });
    fireEvent.click(close);

    expect(h.rejectAll).toHaveBeenCalledTimes(1);
    expect(h.acceptAll).not.toHaveBeenCalled();
  });

  it("renderuje logo marki w kaflu ikony", () => {
    const { container } = render(<ConsentBanner />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn.example.com/mark.svg");
  });

  it("bez skonfigurowanego logo pokazuje zapasową ikonę zamiast pustej ramki", () => {
    h.logo.current = "";
    const { container } = render(<ConsentBanner />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("po angielsku bierze angielską wersję treści", async () => {
    await i18n.changeLanguage("en");
    render(<ConsentBanner />);

    expect(screen.getByRole("button", { name: EN.acceptAll })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: EN.rejectAll })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data Processing Terms" })).toBeInTheDocument();
  });
});

describe("ConsentBanner - panel preferencji", () => {
  it("rozwija cztery kategorie, a niezbędne zostają zablokowane i zaznaczone", () => {
    render(<ConsentBanner />);
    openPrefs();

    expect(screen.getAllByRole("checkbox")).toHaveLength(4);

    const necessary = screen.getByRole("checkbox", { name: PL.categoryNecessary });
    expect(necessary).toBeDisabled();
    expect(necessary).toHaveAttribute("aria-checked", "true");

    const analytics = screen.getByRole("checkbox", { name: PL.categoryAnalytics });
    expect(analytics).toBeEnabled();
    expect(analytics).toHaveAttribute("aria-checked", "false");
  });

  it("zapisuje dokładnie zaznaczony zestaw kategorii", () => {
    render(<ConsentBanner />);
    openPrefs();

    fireEvent.click(screen.getByRole("checkbox", { name: PL.categoryAnalytics }));
    fireEvent.click(screen.getByRole("button", { name: PL.saveSelection }));

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledWith({
      necessary: true,
      functional: false,
      analytics: true,
      marketing: false,
    });
  });

  it("„Anuluj” zwija panel i porzuca niezapisane zmiany", () => {
    render(<ConsentBanner />);
    openPrefs();

    fireEvent.click(screen.getByRole("checkbox", { name: PL.categoryMarketing }));
    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(h.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();

    openPrefs();
    expect(screen.getByRole("checkbox", { name: PL.categoryMarketing })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("„Szczegóły i podmioty” otwierają modal z tabelą podmiotów", () => {
    render(<ConsentBanner />);
    openPrefs();

    fireEvent.click(screen.getByRole("button", { name: PL.showDetails }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Jeden przycisk podmiotów na kategorię, w kolejności kart: niezbędne,
    // funkcjonalne, analityczne, marketingowe. Liczba w nazwie to liczba pozycji
    // rejestru kategorii - zapytanie po samej liczbie było dwuznaczne, odkąd
    // marketing (lejek reklam, pomiar sponsorów) ma tyle pozycji co niezbędne.
    const vendorButtons = screen.getAllByRole("button", {
      name: (name) => name.startsWith(PL.showVendors),
    });
    expect(vendorButtons).toHaveLength(4);
    (["necessary", "functional", "analytics", "marketing"] as const).forEach((cat, i) => {
      expect(vendorButtons[i]).toHaveAccessibleName(
        `${PL.showVendors} ${REGISTRY_BY_CATEGORY[cat].length}`,
      );
    });
  });
});

describe("ConsentBanner: integration with the real overlay queue", () => {
  it("zgłasza stan nawet wtedy, gdy nic nie rysuje - i to ono zwalnia kolejkę", async () => {
    vi.useFakeTimers();
    // Powracający czytelnik: decyzja zapadła wcześniej, więc karta zgód nie
    // renderuje NICZEGO. Mimo to jej efekt musi zgłosić stan koordynatorowi -
    // koordynator wstrzymuje nakładki marketingowe do PIERWSZEGO zgłoszenia
    // baneru, więc bez tego popup czekałby w kolejce do końca sesji.
    h.state = {
      version: 2,
      ts: Date.now(),
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
    };
    const opened = vi.fn();
    void requestOverlaySlot("waiting-popup", { marketing: true }).then(opened);
    await act(async () => {
      await Promise.resolve();
    });
    expect(opened).not.toHaveBeenCalled();

    const { container } = render(<ConsentBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container).toBeEmptyDOMElement();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "applies marketing=%s before releasing a waiting popup",
    async (granted) => {
      vi.useFakeTimers();
      const view = render(<ConsentBanner />);
      const opened = vi.fn();
      void requestOverlaySlot("waiting-popup", { marketing: true }).then(opened);
      await act(async () => {
        await Promise.resolve();
      });
      expect(opened).not.toHaveBeenCalled();
      h.state = {
        version: 2,
        ts: Date.now(),
        categories: {
          necessary: true,
          functional: granted,
          analytics: granted,
          marketing: granted,
        },
      };
      view.rerender(<ConsentBanner />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(opened).toHaveBeenCalledTimes(granted ? 1 : 0);
    },
  );
});

it("waits for the consent exit animation before opening the next popup", async () => {
  vi.useFakeTimers();
  render(<ConsentBanner />);
  const opened = vi.fn();
  void requestOverlaySlot("after-animation", { marketing: true }).then(opened);
  h.acceptAll.mockImplementationOnce(() => {
    h.state = {
      version: 2,
      ts: Date.now(),
      categories: {
        necessary: true,
        functional: true,
        analytics: true,
        marketing: true,
      },
    };
  });
  fireEvent.click(screen.getByRole("button", { name: PL.acceptAll }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(opened).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(opened).toHaveBeenCalledTimes(1);
});

describe("ConsentBanner - dodatkowe odnośniki z panelu idą za językiem banera", () => {
  // NAPRAWA 2026-10-02. Odnośnik z panelu szedł do `href` dosłownie: baner po
  // angielsku prowadził z „/cookies" na POLSKĄ stronę, choć polityka i zasady
  // przetwarzania tuż obok mają prefiks języka. `javascript:` z panelu
  // trafiał do banera każdego odwiedzającego.
  const withLinks = {
    ...COOKIE_BANNER_DEFAULTS,
    links: [
      { id: "lnk_a", url: "/cookies", label_pl: "Pliki cookie", label_en: "Cookie policy" },
      { id: "lnk_b", url: "https://example.org/rodo", label_pl: "RODO", label_en: "" },
      { id: "lnk_c", url: "javascript:alert(1)", label_pl: "Zły", label_en: "Bad" },
      { id: "lnk_d", url: "/regulamin", label_pl: "", label_en: "" },
    ],
  };

  it("PL: ścieżka bez prefiksu, adres zewnętrzny bez zmian, niedozwolony i bez etykiety - pominięte", () => {
    render(<ConsentBanner configOverride={withLinks} />);
    expect(screen.getByRole("link", { name: "Pliki cookie" })).toHaveAttribute("href", "/cookies");
    expect(screen.getByRole("link", { name: "RODO" })).toHaveAttribute(
      "href",
      "https://example.org/rodo",
    );
    expect(screen.queryByRole("link", { name: "Zły" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('a[href="/regulamin"]')).toBeNull();
  });

  it("EN: ścieżka wewnętrzna dostaje /en, etykieta EN, brak EN = etykieta PL", async () => {
    await i18n.changeLanguage("en");
    render(<ConsentBanner configOverride={withLinks} />);
    expect(screen.getByRole("link", { name: "Cookie policy" })).toHaveAttribute(
      "href",
      "/en/cookies",
    );
    // Polityka prywatności obok ma ten sam prefiks - teraz cały wiersz jest spójny.
    expect(screen.getByRole("link", { name: EN.policyLabel })).toHaveAttribute(
      "href",
      "/en/polityka-prywatnosci",
    );
    expect(screen.getByRole("link", { name: "RODO" })).toHaveAttribute(
      "href",
      "https://example.org/rodo",
    );
    expect(screen.queryByRole("link", { name: "Bad" })).not.toBeInTheDocument();
    await i18n.changeLanguage("pl");
  });
});

describe("ConsentBanner - puste pole treści z panelu", () => {
  it("wyczyszczony przycisk dostaje brzmienie domyślne zamiast pustej nazwy", () => {
    const cleared = {
      ...COOKIE_BANNER_DEFAULTS,
      copy: { ...COOKIE_BANNER_DEFAULTS.copy, pl: { ...PL, acceptAll: "", title: " " } },
    };
    render(<ConsentBanner configOverride={cleared} />);
    expect(screen.getByRole("button", { name: PL.acceptAll })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: PL.title })).toBeInTheDocument();
  });
});

// MODAL „SZCZEGÓŁY I PODMIOTY" I PONOWNE OTWARCIE PREFERENCJI. Dotąd test
// otwierał modal i liczył przyciski podmiotów - żadna z trzech decyzji w stopce
// modala, rozwinięcie tabeli podmiotów ani przełącznik kategorii W MODALU nie
// miały wywołania. A to jest jedyna droga do zmiany zgody PO decyzji (link
// „Ustawienia cookies" w stopce strony), czyli połowa kontraktu RODO: zgodę
// musi dać się wycofać tak samo łatwo, jak ją wyrażono.
describe("ConsentBanner - modal szczegółów: decyzje i podmioty", () => {
  const openDetails = () => {
    openPrefs();
    fireEvent.click(screen.getByRole("button", { name: PL.showDetails }));
    return screen.getByRole("dialog");
  };

  it("tabela podmiotów kategorii rozwija się i zwija, z nazwą, stroną, celem i okresem", () => {
    render(<ConsentBanner />);
    openDetails();
    const toggle = screen.getAllByRole("button", {
      name: (name) => name.startsWith(PL.showVendors),
    })[2];
    if (!toggle) throw new Error("brak przycisku podmiotów analityki");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByRole("row");
    // Nagłówek + jeden wiersz na pozycję rejestru analityki.
    expect(rows).toHaveLength(REGISTRY_BY_CATEGORY.analytics.length + 1);

    fireEvent.click(screen.getByRole("button", { name: (n) => n.startsWith(PL.hideVendors) }));
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("przełącznik kategorii W MODALU i „Zapisz wybrane” zapisują ten zestaw", () => {
    render(<ConsentBanner />);
    const dialog = openDetails();
    const marketing = within(dialog).getByRole("checkbox", { name: PL.categoryMarketing });
    fireEvent.click(marketing);
    fireEvent.click(within(dialog).getByRole("button", { name: PL.saveSelection }));
    expect(h.save).toHaveBeenCalledWith({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: true,
    });
  });

  it("„Odrzuć wszystkie” w modalu odrzuca, „Akceptuj wszystkie” - akceptuje", () => {
    const { unmount } = render(<ConsentBanner />);
    let dialog = openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: PL.rejectAll }));
    expect(h.rejectAll).toHaveBeenCalledTimes(1);
    unmount();

    render(<ConsentBanner />);
    dialog = openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: PL.acceptAll }));
    expect(h.acceptAll).toHaveBeenCalledTimes(1);
  });

  it("PO decyzji: zdarzenie z linku w stopce otwiera modal, a Escape i tło go zamykają", () => {
    h.state = {
      version: 1,
      ts: 0,
      categories: { necessary: true, functional: true, analytics: true, marketing: false },
    };
    render(<ConsentBanner />);
    // Decyzja zapadła - baner milczy.
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("consent-open-preferences"));
    });
    const dialog = screen.getByRole("dialog");
    // Modal startuje od ZAPISANEJ decyzji, nie od pustego szkicu.
    expect(within(dialog).getByRole("checkbox", { name: PL.categoryAnalytics })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Zamknij" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event("consent-open-preferences"));
    });
    // Tłem jest sam element `role="dialog"` (pełnoekranowa warstwa); klik
    // w kartę wewnątrz NIE zamyka - przerywa propagację.
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(within(backdrop).getByRole("heading", { name: PL.title }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("przełącznik języka w banerze zmienia język treści", async () => {
    render(
      <ConsentBanner configOverride={{ ...COOKIE_BANNER_DEFAULTS, languageSwitcher: true }} />,
    );
    const group = screen.getByRole("group", { name: "PL / EN" });
    // Klik w język bieżący nic nie robi.
    fireEvent.click(within(group).getByRole("button", { name: "PL" }));
    expect(i18n.language).toBe("pl");

    await act(async () => {
      fireEvent.click(within(group).getByRole("button", { name: "EN" }));
    });
    expect(screen.getByRole("button", { name: EN.acceptAll })).toBeInTheDocument();
    await i18n.changeLanguage("pl");
  });

  it("logo, które się nie wczytało, ustępuje zapasowej ikonie", () => {
    const { container } = render(<ConsentBanner />);
    const img = container.querySelector("img");
    if (!img) throw new Error("brak logo");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

// PRZEJĘCIE POWŁOKI SSR (P1.3). Korzeń montuje baner po pierwszej interakcji
// w miejsce statycznej powłoki - ten sam markup (`ConsentCompactCard`), więc
// podmiana ma być niewidoczna: karta od PIERWSZEGO renderu (bez przebiegu
// `mounted === false`), bez animacji wejścia, z odtworzoną intencją i fokusem.
describe("ConsentBanner - przejęcie powłoki SSR (P1.3)", () => {
  it("pokazuje kartę od pierwszego renderu, choć `useConsent` jeszcze nie zamontowany", () => {
    h.mounted = false;
    const onReady = vi.fn();
    render(<ConsentBanner takeover={{ intent: null, focus: null }} onReady={onReady} />);
    expect(screen.getByRole("dialog", { name: PL.title })).toBeInTheDocument();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("kontrola: bez przejęcia pierwszy render przed montażem nadal nic nie rysuje", () => {
    h.mounted = false;
    const { container } = render(<ConsentBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("decyzja zapisana już w powłoce: baner niczego nie rysuje, tylko zgłasza stan", async () => {
    h.mounted = false;
    h.state = {
      version: 2,
      ts: 1,
      categories: { necessary: true, functional: false, analytics: false, marketing: false },
    };
    const opened = vi.fn();
    void requestOverlaySlot("waiting", { marketing: false }).then(opened);
    const { container } = render(<ConsentBanner takeover={{ intent: null, focus: null }} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("intencja „Dostosuj” z powłoki rozwija panel preferencji od razu", () => {
    h.mounted = false;
    render(<ConsentBanner takeover={{ intent: "customize", focus: "customize" }} />);
    const customize = screen.getByRole("button", { name: PL.customize });
    expect(customize).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(document.activeElement).toBe(customize);
  });

  it.each(["reject", "accept", "close"] as const)(
    "fokus z kontrolki powłoki `%s` przechodzi na tę samą kontrolkę banera",
    (action) => {
      h.mounted = false;
      render(<ConsentBanner takeover={{ intent: null, focus: action }} />);
      const active = document.activeElement;
      expect(active?.getAttribute("data-consent-action")).toBe(action);
      expect(active?.closest('[role="dialog"]')).not.toBeNull();
    },
  );

  it("intencja języka z powłoki przełącza język banera", async () => {
    h.mounted = false;
    render(<ConsentBanner takeover={{ intent: "lang-en", focus: null }} />);
    expect(await screen.findByRole("dialog", { name: EN.title })).toBeInTheDocument();
  });

  it("pokazanie BEZ animacji wejścia (F8), wyjście po decyzji nadal animowane", () => {
    h.mounted = false;
    const { container } = render(<ConsentBanner takeover={{ intent: null, focus: null }} />);
    expect(container.innerHTML).not.toMatch(/animate-in|slide-in-from/);
    fireEvent.click(screen.getByRole("button", { name: PL.rejectAll }));
    expect(container.innerHTML).toMatch(/animate-out/);
  });

  it("GPC przy przejęciu: zgłoszenie koordynatorowi zaklamrowane - marketing bez slotu", async () => {
    h.mounted = false;
    h.gpc = { active: true, source: "navigator" };
    h.state = {
      version: 2,
      ts: 1,
      categories: { necessary: true, functional: true, analytics: true, marketing: true },
    };
    const opened = vi.fn();
    void requestOverlaySlot("marketing-popup", { marketing: true }).then(opened);
    render(<ConsentBanner takeover={{ intent: null, focus: null }} />);
    await act(async () => {
      await Promise.resolve();
    });
    // Zgoda marketingowa zapisana, ale sygnał GPC bez świadomego override'u:
    // nakładka marketingowa NIE może dostać slotu.
    expect(opened).not.toHaveBeenCalled();
  });
});
