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
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import type { ConsentState } from "@/lib/ads/consent";
import { requestOverlaySlot, __resetOverlayCoordinator } from "@/lib/overlayCoordinator";

const h = vi.hoisted(() => ({
  state: null as ConsentState | null,
  save: vi.fn(),
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  logo: { current: "https://cdn.example.com/mark.svg" as string },
}));

vi.mock("@/lib/ads/consent", () => ({
  OPEN_PREFS_EVENT: "consent-open-preferences",
  consumeOpenPrefsRequest: () => false,
  useConsent: () => ({
    state: h.state,
    decided: !!h.state,
    mounted: true,
    save: h.save,
    acceptAll: h.acceptAll,
    rejectAll: h.rejectAll,
    clear: vi.fn(),
  }),
  useGpcSignal: () => ({ active: false, source: "none" as const }),
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

const PL = COOKIE_BANNER_DEFAULTS.copy.pl;
const EN = COOKIE_BANNER_DEFAULTS.copy.en;

beforeEach(async () => {
  h.state = null;
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
    expect(screen.getByRole("button", { name: `${PL.showVendors} 4` })).toBeInTheDocument();
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
