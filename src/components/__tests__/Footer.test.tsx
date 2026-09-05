/**
 * <Footer /> - stopka publiczna renderowana pod każdą stroną serwisu.
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to).
 *  1. DOKUMENT ALBO WBUDOWANA DOMYŚLNA STOPKA. Gdy `site_settings.footer` nie
 *     niesie `builder_data` (świeża instalacja, uszkodzony wiersz, jeszcze
 *     trwający odczyt), stopka renderuje `defaultDocFor("footer")`, a NIE pustą
 *     dziurę - to jest warunek stabilności HTML-u SSR i braku przeskoku układu
 *     po hydratacji.
 *  2. CHROME STOPKI JAKO DANE WALIDOWANE. `FooterChromeSchema.safeParse`
 *     stoi między ustawieniami a widokiem: wartość spoza enumu (albo próg
 *     poza zakresem) NIE może wywrócić strony - stopka wraca wtedy do
 *     kompletu wartości domyślnych.
 *  3. TRYB ZWIĘZŁY (`compact`) - jedna listwa z prawami autorskimi, bez
 *     dokumentu buildera i bez przycisku powrotu na górę.
 *  4. POMIAR KLIKNIĘĆ W FAZIE PRZECHWYTYWANIA. Stopka nie ma własnych linków -
 *     nasłuchuje kliknięć na całym drzewie i mapuje `href` na kanoniczną grupę
 *     z `FOOTER_LINKS` (editorial / legal / community / ... / unknown), rozpoznaje
 *     link zewnętrzny i pomija kotwice, `mailto:` oraz `tel:`. Tak samo działa
 *     nasłuch `submit` dla formularza newslettera. To jest CAŁA logika własna
 *     tego pliku, więc każdy jej wariant ma osobny przypadek.
 *  5. DWUJĘZYCZNOŚĆ mierzona słownikiem i mapą linków, nie kopią napisu:
 *     szablon praw autorskich PL/EN z podstawieniem `{year}` oraz etykiety
 *     linków prawnych z `footerNavigation`.
 *
 * CO JEST ZAATRAPOWANE I DLACZEGO.
 *  * `@/lib/analytics/footerTracking` - GRANICA DANYCH i granica RODO naraz.
 *    Prawdziwe wejście woła `track()` (własny beacon) i `window.gtag`, czyli
 *    wychodzi do sieci; test ma dowodzić, CO stopka zgłasza, a nie tego, czy
 *    beacon doleciał (to ma własny plik). Atrapa zapisuje ładunki.
 *  * `BuilderRenderer` - zastąpiony fixture'em DOM (linki, formularze), bo
 *    przedmiotem dowodu jest nasłuch stopki, a nie renderer widżetów. Fixture
 *    daje przy okazji kształty, których prawdziwy dokument domyślny nie ma
 *    (link zewnętrzny, `tel:`, formularz nienewsletterowy).
 *  * `react-i18next` - atrapa Z PRAWDZIWYM `t` (`@/test/i18nReal`). Fabryka
 *    `vi.mock` jest synchroniczna i nic nie importuje - skrót
 *    `reactI18nextMock()` zakleszcza plik (`@/test/i18nReal` -> `@/lib/i18n` ->
 *    `react-i18next`).
 *  * `@/lib/i18n/localeRuntime` - `currentLang()` jest izomorficzny i w teście
 *    rozstrzyga się na gałąź serwerową (zawsze "pl"), więc wariant EN bez
 *    podmiany byłby pustą asercją.
 *  * `@tanstack/react-router` - prawdziwy moduł z `Link` podmienionym na
 *    wspólny `RouterLinkStub` (bez `RouterProvider` prawdziwy `Link` rzuca).
 *
 * CO ZOSTAJE PRAWDZIWE: React, `useQuery` na PRAWDZIWYM `QueryClient`
 * z zasianym cache, `resolveSetting`, `FooterChromeSchema`, `defaultDocFor`,
 * `resolveCopyright`, `footerLinksByGroup`/`labelFor`, `CopyrightBar`
 * i `BackToTop`.
 *
 * ZNALEZISKA (stan istniejący, przypięty niżej - naprawa ma być widoczna jako
 * zmiana testu, nie cicha zmiana zachowania):
 *  * Gałąź `isLoading ? defaultDocFor("footer") : defaultDocFor("footer")`
 *    (Footer.tsx:42-44) ma OBA ramiona identyczne - stan ładowania nie różni
 *    się niczym od stanu po nieudanym odczycie. Test pokazuje jeden skutek dla
 *    obu dróg.
 *  * Gałąź `if (!doc?.sections?.length)` (Footer.tsx:92) jest NIEOSIĄGALNA:
 *    `doc` jest albo niepustym dokumentem z ustawień, albo dokumentem
 *    domyślnym, który sekcje ma zawsze. Sam przycisk "na górę" bez stopki nie
 *    pokaże się więc nigdy - dlatego nie ma na to przypadku (nie da się go
 *    napisać uczciwie).
 *
 * RODO: żadnych prawdziwych osób ani adresów - fixture używa example.com
 * i nazw zmyślonych.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode } from "@/lib/builder/types";
import type { FooterClickPayload } from "@/lib/analytics/footerTracking";

type Lang = "pl" | "en";

const h = vi.hoisted(() => ({
  /** Prawdziwy `getFixedT(lang)`, wstrzykiwany poniżej (fabryka nic nie importuje). */
  t: null as null | ((lang: "pl" | "en") => unknown),
  lang: "pl" as "pl" | "en",
  linkEvents: [] as unknown[],
  newsletterEvents: [] as { status: string; meta?: Record<string, unknown> }[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: h.t?.(h.lang),
    i18n: { language: h.lang, on: () => {}, off: () => {} },
    ready: true,
  }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

vi.mock("@/lib/i18n/localeRuntime", () => ({
  currentLang: () => h.lang,
  setClientLang: () => {},
}));

vi.mock("@/lib/analytics/footerTracking", () => ({
  trackFooterLink: (payload: unknown) => {
    h.linkEvents.push(payload);
  },
  trackFooterNewsletterSubmit: (status: string, meta?: Record<string, unknown>) => {
    h.newsletterEvents.push({ status, meta });
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { ...actual, Link: RouterLinkStub };
});

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ doc, lang }: { doc: BuilderDocument; lang: string }) => (
    <div data-testid="builder" data-lang={lang} data-sections={String(doc.sections.length)}>
      <a href="/analizy">Analizy</a>
      <a href="/regulamin">Regulamin</a>
      <a href="/dolacz-do-newslettera">Zapisz się na newsletter</a>
      <a href="/sciezka-spoza-rejestru">Poza rejestrem</a>
      <a href="https://example.com/partner">Partner zewnętrzny</a>
      <a href="#kotwica">Kotwica</a>
      <a href="mailto:redakcja@example.com">Napisz do nas</a>
      <a href="tel:+480000000">Zadzwoń</a>
      <a href="/bez-widocznego-tekstu" aria-label="link bez tekstu">
        <span />
      </a>
      <span data-testid="nie-link">zwykły tekst</span>
      <form id="footer-newsletter" onSubmit={(event) => event.preventDefault()}>
        <input type="email" aria-label="adres e-mail" />
        <button type="submit">Zapisz mnie</button>
      </form>
      <form data-newsletter-form="" onSubmit={(event) => event.preventDefault()}>
        <input type="text" aria-label="e-mail bez typu" />
        <button type="submit">Zapisz mnie (wariant)</button>
      </form>
      <form id="wyszukiwarka-stopki" onSubmit={(event) => event.preventDefault()}>
        <input type="text" aria-label="fraza" />
        <button type="submit">Szukaj</button>
      </form>
    </div>
  ),
}));

import { realT } from "@/test/i18nReal";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { defaultDocFor } from "@/lib/builder/chromeDefaults";
import { FOOTER_LINKS } from "@/lib/seo/footerNavigation";
import { Footer } from "@/components/Footer";

h.t = (lang: Lang) => realT(lang);

function dict(lang: Lang, key: string): string {
  const value = String(realT(lang)(key));
  if (value === key) {
    throw new Error(
      `Klucz i18n "${key}" (${lang}) nie ma tłumaczenia - i18next zwrócił sam klucz. ` +
        "Asercja na tej wartości mierzyłaby echo klucza, nie słownik.",
    );
  }
  return value;
}

const section = (id: string): SectionNode => ({ id, kind: "section", children: [] });

const doc = (count: number): BuilderDocument => ({
  version: 1,
  sections: Array.from({ length: count }, (_, i) => section(`sec-${i}`)),
});

type SettingsSeed = Record<string, unknown>;

function wrap(client: QueryClient, ui: ReactNode): ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

/**
 * `seed === null` = ustawienia jeszcze nie przyjechały. Zapytanie jest wtedy
 * WYŁĄCZONE (`enabled: false`), a nie tylko puste - inaczej `useQuery` poszedłby
 * do prawdziwego Supabase, czyli test wyszedłby do sieci.
 */
function renderFooter(seed: SettingsSeed | null, props: { compact?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: seed !== null } },
  });
  if (seed) client.setQueryData(siteSettingsQueryOptions.queryKey, seed);
  return { ...render(wrap(client, <Footer {...props} />)), client };
}

const footerEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>("footer[data-site-footer]");
  if (!el) throw new Error("Brak elementu <footer data-site-footer> w drzewie.");
  return el;
};

const lastLinkEvent = (): FooterClickPayload => {
  const last = h.linkEvents.at(-1);
  if (!last) throw new Error("Nie zgłoszono żadnego kliknięcia w stopce.");
  return last as FooterClickPayload;
};

beforeEach(() => {
  h.lang = "pl";
  h.linkEvents.length = 0;
  h.newsletterEvents.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --- Dokument stopki ---------------------------------------------------------

describe("Footer - dokument i stan pusty", () => {
  it("bez zapisanego dokumentu renderuje wbudowaną stopkę domyślną, a nie pustkę", () => {
    renderFooter({});

    const expected = defaultDocFor("footer").sections.length;
    expect(expected).toBeGreaterThan(0);
    expect(screen.getByTestId("builder")).toHaveAttribute("data-sections", String(expected));
    expect(footerEl()).toBeInTheDocument();
  });

  it("w trakcie odczytu ustawień pokazuje dokładnie ten sam dokument domyślny, bez ruchu w sieci", () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("test nie ma prawa iść do sieci")));
    vi.stubGlobal("fetch", fetchSpy);

    renderFooter(null);

    expect(screen.getByTestId("builder")).toHaveAttribute(
      "data-sections",
      String(defaultDocFor("footer").sections.length),
    );
    // Dowód dla wyłączonego zapytania: prawdziwe `queryFn` idzie do Supabase,
    // więc gdyby `enabled: false` nie działało, ten szpieg by to zobaczył.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dokument z ustawień wygrywa z domyślnym", () => {
    renderFooter({ footer: { builder_data: doc(3) } });

    expect(screen.getByTestId("builder")).toHaveAttribute("data-sections", "3");
  });

  it("dokument z zerową liczbą sekcji jest traktowany jak brak dokumentu", () => {
    renderFooter({ footer: { builder_data: doc(0) } });

    expect(screen.getByTestId("builder")).toHaveAttribute(
      "data-sections",
      String(defaultDocFor("footer").sections.length),
    );
  });

  it("tryb zwięzły pokazuje wyłącznie listwę praw autorskich", () => {
    renderFooter({ footer: { builder_data: doc(2) } }, { compact: true });

    expect(screen.queryByTestId("builder")).toBeNull();
    expect(document.querySelector("footer[data-site-footer]")).toBeNull();
    expect(document.querySelector("footer")).not.toBeNull();
    expect(screen.queryByRole("button", { name: dict("pl", "footer.back_to_top") })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Informacje prawne" })).toBeInTheDocument();
  });
});

// --- Chrome stopki -----------------------------------------------------------

describe("Footer - chrome walidowany schematem", () => {
  it("przenosi zapisany układ na atrybut stopki", () => {
    renderFooter({ footer: { builder_data: doc(1), chrome: { layout: "dark" } } });

    expect(footerEl()).toHaveAttribute("data-footer-layout", "dark");
  });

  it("układ spoza enumu cofa CAŁY chrome do wartości domyślnych", () => {
    renderFooter({
      footer: {
        builder_data: doc(1),
        chrome: { layout: "kosmiczny", back_to_top: false },
      },
    });

    // Niepoprawny `layout` oblewa parse całego obiektu, więc `back_to_top: false`
    // też przepada - przycisk wraca, bo domyślnie jest włączony.
    expect(footerEl()).toHaveAttribute("data-footer-layout", "default");
    expect(
      screen.getByRole("button", { name: dict("pl", "footer.back_to_top") }),
    ).toBeInTheDocument();
  });

  it("wyłączony przycisk powrotu na górę znika ze stopki", () => {
    renderFooter({ footer: { builder_data: doc(1), chrome: { back_to_top: false } } });

    expect(screen.queryByRole("button", { name: dict("pl", "footer.back_to_top") })).toBeNull();
  });

  it("przycisk powrotu na górę przewija dokument na samą górę", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    renderFooter({ footer: { builder_data: doc(1) } });

    fireEvent.click(screen.getByRole("button", { name: dict("pl", "footer.back_to_top") }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("brak separatora zdejmuje górną krawędź listwy praw autorskich", () => {
    const withSeparator = renderFooter({ footer: { builder_data: doc(1) } });
    expect(footerEl().querySelector(".border-t")).not.toBeNull();
    withSeparator.unmount();

    renderFooter({ footer: { builder_data: doc(1), chrome: { show_separator: false } } });
    expect(footerEl().querySelector(".border-t")).toBeNull();
  });
});

// --- Pomiar kliknięć ---------------------------------------------------------

describe("Footer - zgłaszanie kliknięć w linki", () => {
  beforeEach(() => {
    renderFooter({ footer: { builder_data: doc(1) } });
  });

  it("link z rejestru dostaje swoją kanoniczną grupę i etykietę z treści", () => {
    fireEvent.click(screen.getByText("Analizy"));

    expect(h.linkEvents).toHaveLength(1);
    expect(lastLinkEvent()).toEqual({
      href: "/analizy",
      label: "Analizy",
      group: "editorial",
      external: false,
    });
  });

  it("link prawny trafia do grupy legal", () => {
    // W stopce są DWA linki `/regulamin` (fixture dokumentu i listwa prawna),
    // więc zapytanie jest zawężone do dokumentu buildera.
    fireEvent.click(within(screen.getByTestId("builder")).getByText("Regulamin"));

    expect(lastLinkEvent().group).toBe("legal");
  });

  it("link newslettera trafia do grupy community (rejestr, nie heurystyka nazwy)", () => {
    fireEvent.click(screen.getByText("Zapisz się na newsletter"));

    expect(lastLinkEvent()).toMatchObject({ href: "/dolacz-do-newslettera", group: "community" });
  });

  it("adres spoza rejestru dostaje grupę unknown", () => {
    fireEvent.click(screen.getByText("Poza rejestrem"));

    expect(lastLinkEvent()).toMatchObject({ href: "/sciezka-spoza-rejestru", group: "unknown" });
  });

  it("link na inny host jest oznaczony jako zewnętrzny", () => {
    fireEvent.click(screen.getByText("Partner zewnętrzny"));

    expect(lastLinkEvent()).toMatchObject({
      href: "https://example.com/partner",
      external: true,
      group: "unknown",
    });
  });

  it("kotwica, mailto: i tel: nie są zgłaszane", () => {
    fireEvent.click(screen.getByText("Kotwica"));
    fireEvent.click(screen.getByText("Napisz do nas"));
    fireEvent.click(screen.getByText("Zadzwoń"));

    expect(h.linkEvents).toHaveLength(0);
  });

  it("kliknięcie poza linkiem nie zgłasza niczego", () => {
    fireEvent.click(screen.getByTestId("nie-link"));

    expect(h.linkEvents).toHaveLength(0);
  });

  it("link bez widocznego tekstu zgłasza własny adres jako etykietę", () => {
    fireEvent.click(screen.getByLabelText("link bez tekstu"));

    expect(lastLinkEvent()).toMatchObject({
      href: "/bez-widocznego-tekstu",
      label: "/bez-widocznego-tekstu",
    });
  });

  it("kliknięcie w element WEWNĄTRZ linku zgłasza ten link (closest, nie target)", () => {
    const inner = screen.getByLabelText("link bez tekstu").querySelector("span");
    expect(inner).not.toBeNull();
    if (inner) fireEvent.click(inner);

    expect(lastLinkEvent().href).toBe("/bez-widocznego-tekstu");
  });

  it("rejestr linków stopki nie rozjechał się z fixture'em (grupa faktycznie istnieje)", () => {
    expect(
      FOOTER_LINKS.some((link) => link.href === "/analizy" && link.group === "editorial"),
    ).toBe(true);
  });
});

describe("Footer - zgłaszanie zapisu do newslettera", () => {
  beforeEach(() => {
    renderFooter({ footer: { builder_data: doc(1) } });
  });

  it("formularz z polem e-mail zgłasza zapis razem z identyfikatorem formularza", () => {
    fireEvent.submit(screen.getByLabelText("adres e-mail").closest("form") as HTMLFormElement);

    expect(h.newsletterEvents).toEqual([
      { status: "success", meta: { form_id: "footer-newsletter" } },
    ]);
  });

  it("formularz oznaczony atrybutem data-newsletter-form też się liczy, bez identyfikatora", () => {
    fireEvent.submit(screen.getByLabelText("e-mail bez typu").closest("form") as HTMLFormElement);

    expect(h.newsletterEvents).toEqual([{ status: "success", meta: { form_id: undefined } }]);
  });

  it("inny formularz stopki (wyszukiwarka) nie jest zapisem do newslettera", () => {
    fireEvent.submit(screen.getByLabelText("fraza").closest("form") as HTMLFormElement);

    expect(h.newsletterEvents).toHaveLength(0);
  });
});

describe("Footer - nasłuchy po odmontowaniu", () => {
  it("odmontowana stopka nie zgłasza już kliknięć", () => {
    const view = renderFooter({ footer: { builder_data: doc(1) } });
    const footer = footerEl();
    const link = screen.getByText("Analizy");
    view.unmount();

    // Węzły zostają w pamięci - gdyby nasłuch przeżył odmontowanie, ten klik
    // nadal by go obudził.
    footer.appendChild(link);
    fireEvent.click(link);

    expect(h.linkEvents).toHaveLength(0);
  });
});

// --- Dwujęzyczność -----------------------------------------------------------

describe("Footer - warianty językowe", () => {
  const YEAR = new Date().getFullYear();

  it("wariant PL: szablon praw autorskich i etykiety linków prawnych po polsku", () => {
    h.lang = "pl";
    renderFooter({
      footer: {
        builder_data: doc(1),
        chrome: {
          copyright_pl: "© {year} Instytut Testowy",
          copyright_en: "© {year} Test Institute",
        },
      },
    });

    expect(screen.getByText(`© ${YEAR} Instytut Testowy`)).toBeInTheDocument();
    expect(screen.getByTestId("builder")).toHaveAttribute("data-lang", "pl");
    const legal = screen.getByRole("navigation", { name: "Informacje prawne" });
    expect(within(legal).getByRole("link", { name: "Regulamin" })).toHaveAttribute(
      "href",
      "/regulamin",
    );
  });

  it("wariant EN: ten sam chrome renderuje angielski szablon i angielskie etykiety", () => {
    h.lang = "en";
    renderFooter({
      footer: {
        builder_data: doc(1),
        chrome: {
          copyright_pl: "© {year} Instytut Testowy",
          copyright_en: "© {year} Test Institute",
        },
      },
    });

    expect(screen.getByText(`© ${YEAR} Test Institute`)).toBeInTheDocument();
    expect(screen.getByTestId("builder")).toHaveAttribute("data-lang", "en");
    // Etykieta przycisku powrotu na górę idzie ze SŁOWNIKA (nie z ustawień) -
    // i jest w obu językach inna, więc wariant EN mierzy angielski słownik.
    expect(
      screen.getByRole("button", { name: dict("en", "footer.back_to_top") }),
    ).toBeInTheDocument();
    expect(dict("en", "footer.back_to_top")).not.toBe(dict("pl", "footer.back_to_top"));
    const legal = screen.getByRole("navigation", { name: "Legal" });
    // Etykiety linków prawnych pochodzą z mapy `footerNavigation`, nie z kopii
    // napisu: ten sam href ma inną etykietę niż w wariancie PL.
    const terms = FOOTER_LINKS.find((link) => link.href === "/regulamin");
    expect(terms?.label.en).toBeTruthy();
    if (terms) {
      expect(within(legal).getByRole("link", { name: terms.label.en })).toHaveAttribute(
        "href",
        "/regulamin",
      );
      expect(terms.label.en).not.toBe(terms.label.pl);
    }
  });

  it("pusty szablon z włączonym rokiem daje sam rok, a wyłączony - brak tekstu", () => {
    const withYear = renderFooter({ footer: { builder_data: doc(1) } });
    expect(screen.getByText(`© ${YEAR}`)).toBeInTheDocument();
    withYear.unmount();

    renderFooter({ footer: { builder_data: doc(1), chrome: { show_year: false } } });
    expect(screen.queryByText(`© ${YEAR}`)).toBeNull();
  });
});
