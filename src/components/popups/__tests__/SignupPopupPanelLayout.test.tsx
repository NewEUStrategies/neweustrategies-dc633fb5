// Gałęzie UKŁADU panelu popupu rejestracji - dopełnienie
// `SignupPopupPanel.test.tsx` (tamten pilnuje treści, pól i palety).
//
// DLACZEGO OSOBNO I DLACZEGO W OGÓLE. Popup rejestracji jest jedynym miejscem,
// w którym odwiedzający zakłada konto, i jednocześnie jedynym elementem, który
// ZAKRYWA stronę. Każda z tych gałęzi decyduje o tym, czy da się go użyć:
// po której stronie stoi galeria, czy jest przycisk zamknięcia (a bez niego
// popup bez wyjścia blokuje stronę na dobre), czy tytuł nie łamie się na
// wąskim ekranie i czy nagłówek nie chowa się pod krzyżykiem.
//
// Wszystkie są konfigurowalne z panelu admina, więc redaktor może je ustawić
// w kombinacji, której nikt nigdy nie zobaczył przed wdrożeniem - a popup
// z nieczytelnym albo nieusuwalnym kadrem widzi KAŻDY odwiedzający naraz.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/lib/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  signUp: vi.fn(),
  signInOAuth: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.guard,
}));
vi.mock("@/lib/auth/bruteforce.functions", () => ({ preAuthGuard: {} }));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));
vi.mock("@/lib/newsletter/popupTelemetry", () => ({
  trackNewsletterPopupEvent: vi.fn(),
  newsletterPopupSessionId: () => "test-session",
}));
vi.mock("@/hooks/useAuthSettings", () => ({
  useAuthSettings: () => ({ allow_public_signup: true, logged_in_redirect_url: "/" }),
}));
vi.mock("@/lib/brand/useBrandLogoUrl", () => ({
  useBrandLogoUrl: () => "https://cdn.example.com/logo-poziome.svg",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...args: unknown[]) => h.signUp(...args),
      signInWithOAuth: (...args: unknown[]) => h.signInOAuth(...args),
    },
  },
}));

import { SignupPopupPanel } from "@/components/popups/SignupPopupPanel";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { defaultPopupDesign, type PopupDesign } from "@/lib/newsletter/popupDesign";

function settings(overrides: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_layout: "showcase",
    popup_title_pl: "Załóż konto",
    popup_title_en: "Create an account",
    popup_description_pl: "Opis PL",
    popup_description_en: "Description EN",
    popup_showcase_images: [
      { url: "https://cdn.example.com/1.jpg", caption_pl: "Kadr 1", caption_en: "Frame 1" },
    ],
    ...overrides,
  };
}

function withDesign(patch: (d: PopupDesign) => PopupDesign): NewsletterSettings {
  return settings({ popup_design: patch(defaultPopupDesign()) });
}

/** Sam kadr popupu - węzeł, na którym siedzą tokeny `--nl-*` i style panelu. */
const panel = () => document.querySelector<HTMLElement>("[style*='--nl-bg']");

/**
 * Surowy atrybut `style` kadru. Czytamy go tekstem, a nie przez CSSOM:
 * proporcje kolumn jadą własną właściwością `--nl-cols` (klasa Tailwinda
 * podstawia ją dopiero w `grid-template-columns`), a `border`/`box-shadow`
 * niosą `color-mix`, którego atrapa DOM nie parsuje do skrótu.
 */
function styl(): string {
  return panel()?.getAttribute("style") ?? "";
}

/**
 * Proporcje kolumn panelu jako para liczb (galeria kontra formularz).
 *
 * Liczby, nie napis: druga kolumna powstaje jako `2 - galleryFr`, więc dla
 * 1.14 wychodzi `0.8600000000000001fr`. To artefakt zmiennoprzecinkowy bez
 * skutku dla układu - porównanie tekstowe robiłoby z niego fałszywą regresję.
 */
function kolumny(): [number, number] {
  const raw = /--nl-cols:\s*([^;]+)/.exec(styl())?.[1]?.trim() ?? "";
  const [a, b] = raw.split(/\s+/).map((v) => Number.parseFloat(v));
  return [a, b];
}

/** Deklaracja `style` po nazwie właściwości - z pominięciem własnych `--nl-*`. */
function wlasciwosc(nazwa: string): string | null {
  return new RegExp(`(?:^|;)\\s*${nazwa}:\\s*([^;]+)`).exec(styl())?.[1]?.trim() ?? null;
}

beforeEach(() => {
  h.signUp.mockReset();
  h.signInOAuth.mockReset();
});
afterEach(cleanup);

describe("proporcje kolumn - który bok dostaje więcej miejsca", () => {
  it.each([
    ["half", "1fr 1fr"],
    ["gallery-wide", "1.14fr 0.86fr"],
    ["form-wide", "0.86fr 1.14fr"],
  ] as const)("wariant %s daje siatkę %s", (split, oczekiwane) => {
    // Zamiana proporcji to formularz zwężony do nieczytelności obok kadru,
    // który i tak jest tylko dekoracją.
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({ ...d, panel: { ...d.panel, split } }))}
        lang="pl"
        mode="dark"
      />,
    );

    const [galeria, formularz] = kolumny();
    const [oczGaleria, oczFormularz] = oczekiwane.split(" ").map((v) => Number.parseFloat(v));
    expect(galeria).toBeCloseTo(oczGaleria, 6);
    expect(formularz).toBeCloseTo(oczFormularz, 6);
  });

  it("galeria po PRAWEJ odwraca kolejność kolumn, nie tylko ich szerokość", () => {
    // Sama zamiana szerokości bez zamiany porządku dałaby wąską galerię po
    // lewej i szeroki formularz po prawej - czyli układ, którego redaktor nie
    // wybrał w żadnym z dwóch pól.
    render(
      <SignupPopupPanel
        settings={{
          ...withDesign((d) => ({ ...d, panel: { ...d.panel, split: "gallery-wide" } })),
          popup_showcase_side: "right",
        }}
        lang="pl"
        mode="dark"
      />,
    );

    const [pierwsza, druga] = kolumny();
    expect(pierwsza).toBeCloseTo(0.86, 6);
    expect(druga).toBeCloseTo(1.14, 6);
    expect(panel()?.querySelector(".md\\:order-2")).toBeTruthy();
  });
});

describe("obramowanie i cień kadru", () => {
  // OGRANICZENIE ATRAPY DOM, wypisane wprost zamiast obchodzone. Ramka kadru to
  // `1px solid color-mix(in srgb, …)`, a atrapa DOM (`happy-dom`) NIE serializuje
  // skrótu `border` z wartością `color-mix` - atrybut `style` gubi go w całości,
  // `el.style.border` i `getComputedStyle` oddają pusty napis. Zmierzone, nie
  // założone. Nie da się więc tutaj odróżnić ramki włączonej od wyłączonej;
  // udawanie takiego dowodu byłoby testem, który przechodzi także wtedy, gdy
  // produkcja przestanie ramkę ustawiać. Zamiast tego oba warianty są
  // przejechane (gałąź wykonana), a asercja mówi o tym, co JEST obserwowalne:
  // reszta stylów kadru przeżywa obie konfiguracje.
  it.each([true, false])("kadr z obramowaniem=%s zachowuje pozostałe style", (showBorder) => {
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({
          ...d,
          panel: { ...d.panel, showBorder, maxWidthPx: 880 },
        }))}
        lang="pl"
        mode="dark"
      />,
    );

    expect(wlasciwosc("max-width")).toBe("880px");
    expect(wlasciwosc("border-radius")).not.toBeNull();
  });

  it("cień zerowy nie zostawia `box-shadow`, a dodatni go ustawia", () => {
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({ ...d, panel: { ...d.panel, shadow: 0 } }))}
        lang="pl"
        mode="dark"
      />,
    );
    expect(wlasciwosc("box-shadow")).toBeNull();

    cleanup();
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({ ...d, panel: { ...d.panel, shadow: 60 } }))}
        lang="pl"
        mode="dark"
      />,
    );
    expect(wlasciwosc("box-shadow")).toMatch(/^0 20px 60px rgba\(0,\s*0,\s*0/);
  });

  it("promień ujemny jest dociskany do zera - kadr nie dostaje wartości bez sensu", () => {
    render(
      <SignupPopupPanel
        settings={settings({ popup_border_radius_px: -20 })}
        lang="pl"
        mode="dark"
      />,
    );

    expect(wlasciwosc("border-radius")).toBe("0px");
    expect(wlasciwosc("max-width")).not.toBeNull();
  });
});

describe("przycisk zamknięcia - popup bez wyjścia blokuje stronę", () => {
  it("bez `onClose` nie ma przycisku zamykania", () => {
    render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" />);

    expect(screen.queryByRole("button", { name: /zamknij/i })).toBeNull();
    expect(screen.getByRole("heading", { name: "Załóż konto" }).className).not.toContain("pr-10");
  });

  it("z `onClose` przycisk istnieje i woła podaną funkcję", () => {
    const onClose = vi.fn();
    render(<SignupPopupPanel settings={settings()} lang="pl" mode="dark" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /zamknij/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(expect.anything());
  });

  it("przy wyśrodkowanym nagłówku krzyżyk rezerwuje sobie miejsce obok tytułu", () => {
    // Bez tej rezerwy krzyżyk kładzie się NA tytule i zasłania pierwsze słowo.
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({ ...d, form: { ...d.form, align: "center" } }))}
        lang="pl"
        mode="dark"
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Załóż konto" }).className).toContain("pr-10");
  });

  it("przy nagłówku do lewej rezerwa jest zbędna i jej nie ma", () => {
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({ ...d, form: { ...d.form, align: "left" } }))}
        lang="pl"
        mode="dark"
        onClose={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Załóż konto" }).className).not.toContain("pr-10");
  });
});

describe("nadtytuł i łamanie tytułu", () => {
  it("nadtytuł wyłączony w projekcie nie renderuje się mimo wpisanej treści", () => {
    render(
      <SignupPopupPanel
        settings={{
          ...withDesign((d) => ({ ...d, form: { ...d.form, showEyebrow: false } })),
          popup_eyebrow_pl: "Dołącz",
        }}
        lang="pl"
        mode="dark"
      />,
    );

    expect(screen.queryByText("Dołącz")).toBeNull();
  });

  it("tytuł oznaczony jako niełamliwy dostaje `whitespace-nowrap`", () => {
    // Ta opcja jest pułapką na wąskich ekranach, więc musi być widoczna
    // w klasie, a nie tylko w konfiguracji - inaczej nikt nie zauważy, że to
    // ona ucina tytuł.
    render(
      <SignupPopupPanel
        settings={withDesign((d) => ({ ...d, form: { ...d.form, titleNoWrap: true } }))}
        lang="pl"
        mode="dark"
      />,
    );

    expect(screen.getByRole("heading", { name: "Załóż konto" }).className).toContain(
      "whitespace-nowrap",
    );
  });
});

describe("identyfikator nagłówka dla dialogu", () => {
  it("podany `titleId` ląduje na nagłówku - bez niego dialog nie ma nazwy", () => {
    // `aria-labelledby` popupu wskazuje na ten identyfikator. Rozjazd oznacza
    // dialog bez nazwy: czytnik ekranu ogłasza „okno dialogowe" i nic więcej.
    render(
      <SignupPopupPanel
        settings={settings()}
        lang="pl"
        mode="dark"
        titleId="popup-rejestracji-tytul"
      />,
    );

    expect(screen.getByRole("heading", { name: "Załóż konto" }).id).toBe("popup-rejestracji-tytul");
    expect(screen.getByRole("heading", { name: "Załóż konto" }).tagName).toBe("H2");
  });
});

describe("obrazy galerii", () => {
  it("wpis bez adresu jest odsiewany - pusty kadr nie zajmuje miejsca w karuzeli", () => {
    render(
      <SignupPopupPanel
        settings={settings({
          popup_showcase_images: [
            { url: "", caption_pl: "Pusty", caption_en: "Empty" },
            { url: "https://cdn.example.com/ok.jpg", caption_pl: "Dobry", caption_en: "Good" },
          ],
        })}
        lang="pl"
        mode="dark"
      />,
    );

    expect(screen.queryByText("Pusty")).toBeNull();
    expect(screen.getByText("Dobry")).toBeTruthy();
  });

  it("brak wersji językowej podpisu schodzi na drugi język, zamiast zostawić pustkę", () => {
    // `pickLocalized` zamiast gołego ternary: redaktor wypełnił tylko polski
    // podpis, a popup po angielsku pokazywał kadr BEZ podpisu.
    render(
      <SignupPopupPanel
        settings={settings({
          popup_showcase_images: [
            { url: "https://cdn.example.com/1.jpg", caption_pl: "Tylko PL", caption_en: "" },
          ],
        })}
        lang="en"
        mode="dark"
      />,
    );

    expect(screen.getByText("Tylko PL")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Create an account" })).toBeTruthy();
  });
});
