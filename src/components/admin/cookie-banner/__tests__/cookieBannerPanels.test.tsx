// Sekcje panelu `/admin/settings/cookie-banner`, które do tego pliku stały na
// ZERZE: branding (logo + odnośniki) i skaner „Wykryte elementy". Trasa
// (`adminSettingsRoutes.test.tsx`) montuje je jako zaślepki.
//
// PRZEDMIOT DOWODU:
//   * każda zmiana pola trafia do WŁAŚCIWEGO pola konfiguracji, a pozostałe
//     zostają nietknięte (sekcja dostaje i oddaje cały obiekt);
//   * NAPRAWA: rozmiar kafla logo jest trzymany w zakresie 24-72 px, który
//     panel obiecuje - wcześniej „500" zapisywało się i rysowało na każdej stronie;
//   * skaner pokazuje tylko niepuste kategorie, oznacza elementy „auto"
//     i skanuje ponownie na żądanie;
//   * OBA JĘZYKI INTERFEJSU: do 2026-10-02 panel był w całości po polsku, także
//     przy interfejsie angielskim - etykiety, kategorie i opis celu z rejestru
//     idą teraz za `i18n.language`;
//   * LINKOWANIE: przy każdym odnośniku panel pokazuje adres, pod który
//     poprowadzi on w wersji PL i EN banera (`bannerLinkHref`), i ostrzega
//     przed adresem, którego baner nie pokaże.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/lib/i18n";

vi.mock("@/components/admin/CoverImagePicker", () => ({
  CoverImagePicker: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.currentTarget.value)} />
  ),
}));

import { CookieBannerBrandingSection } from "@/components/admin/cookie-banner/CookieBannerBrandingSection";
import { DetectedElementsPanel } from "@/components/admin/cookie-banner/DetectedElementsPanel";
import {
  COOKIE_BANNER_LOGO_DEFAULTS,
  clampCookieBannerLogoSize,
  type CookieBannerLink,
  type CookieBannerLogo,
} from "@/lib/cookieBanner/config";

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(`adminCookieBanner.${key}`, options);

/**
 * Czysta przeglądarka dla skanera. `i18n.changeLanguage` zapisuje wybór języka
 * (magazyn / cookie detektora), a skaner liczy KAŻDY klucz - więc po zmianie
 * języka trzeba wyczyścić wszystkie trzy źródła, inaczej licznik niesie szum.
 */
function resetBrowserStorage(): void {
  localStorage.clear();
  sessionStorage.clear();
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("clampCookieBannerLogoSize - zakres kafla logo (NAPRAWA)", () => {
  it.each([
    [36, 36],
    [24, 24],
    [72, 72],
    [10, 24],
    [500, 72],
    [47.6, 48],
    ["60", 60],
    ["", 36],
    ["abc", 36],
    [0, 36],
    [-5, 36],
    [null, 36],
    [undefined, 36],
    [Number.POSITIVE_INFINITY, 36],
  ])("%s -> %s", (input, expected) => {
    expect(clampCookieBannerLogoSize(input)).toBe(expected);
  });
});

describe("CookieBannerBrandingSection", () => {
  const LOGO: CookieBannerLogo = { light: "https://cdn.example.com/l.svg", dark: "", size: 40 };
  const LINK: CookieBannerLink = {
    id: "lnk_a",
    url: "/cookies",
    label_pl: "Cookies",
    label_en: "Cookies EN",
  };

  function setup(links: CookieBannerLink[] = [LINK]) {
    const onLogoChange = vi.fn();
    const onLinksChange = vi.fn();
    render(
      <CookieBannerBrandingSection
        logo={LOGO}
        links={links}
        onLogoChange={onLogoChange}
        onLinksChange={onLinksChange}
      />,
    );
    return { onLogoChange, onLinksChange };
  }

  it("wariant jasny i ciemny zmieniają TYLKO swoje pole", () => {
    const { onLogoChange } = setup();
    fireEvent.change(screen.getByLabelText(t("branding.logoDark")), {
      target: { value: "https://cdn.example.com/d.svg" },
    });
    expect(onLogoChange).toHaveBeenLastCalledWith({
      ...LOGO,
      dark: "https://cdn.example.com/d.svg",
    });
    fireEvent.change(screen.getByLabelText(t("branding.logoLight")), { target: { value: "" } });
    expect(onLogoChange).toHaveBeenLastCalledWith({ ...LOGO, light: "" });
  });

  it("rozmiar: wpisywanie przechodzi bez klamry, opuszczenie pola klamruje do 24-72", () => {
    // Pole jest kontrolowane, więc test trzyma stan jak trasa panelu.
    const seen: CookieBannerLogo[] = [];
    function Harness() {
      const [logo, setLogo] = useState<CookieBannerLogo>(LOGO);
      return (
        <CookieBannerBrandingSection
          logo={logo}
          links={[]}
          onLogoChange={(next) => {
            seen.push(next);
            setLogo(next);
          }}
          onLinksChange={() => {}}
        />
      );
    }
    render(<Harness />);
    const size = screen.getByRole("spinbutton");
    expect(size).toHaveValue(40);
    // Pośredni znak „4" (w drodze do „48") NIE może zostać przestawiony na 24.
    fireEvent.change(size, { target: { value: "4" } });
    expect(seen.at(-1)).toEqual({ ...LOGO, size: 4 });
    fireEvent.change(size, { target: { value: "" } });
    expect(seen.at(-1)).toEqual({ ...LOGO, size: 36 });

    fireEvent.change(size, { target: { value: "500" } });
    fireEvent.blur(size);
    expect(seen.at(-1)).toEqual({ ...LOGO, size: 72 });
    expect(size).toHaveValue(72);
  });

  it("odnośnik: każde z trzech pól zmienia tylko siebie, „Usuń” zdejmuje właściwy wiersz", () => {
    const other: CookieBannerLink = { ...LINK, id: "lnk_b", url: "/regulamin" };
    const { onLinksChange } = setup([LINK, other]);
    const first = within(screen.getAllByRole("listitem")[0]);
    fireEvent.change(first.getByLabelText(t("branding.labelPl")), {
      target: { value: "Ciasteczka" },
    });
    expect(onLinksChange).toHaveBeenLastCalledWith([{ ...LINK, label_pl: "Ciasteczka" }, other]);
    fireEvent.change(first.getByLabelText(t("branding.labelEn")), {
      target: { value: "Cookie policy" },
    });
    expect(onLinksChange).toHaveBeenLastCalledWith([{ ...LINK, label_en: "Cookie policy" }, other]);
    fireEvent.change(first.getByLabelText(t("branding.urlLabel")), {
      target: { value: "/polityka" },
    });
    expect(onLinksChange).toHaveBeenLastCalledWith([{ ...LINK, url: "/polityka" }, other]);

    fireEvent.click(
      within(screen.getAllByRole("listitem")[1]).getByRole("button", {
        name: t("branding.remove"),
      }),
    );
    expect(onLinksChange).toHaveBeenLastCalledWith([LINK]);
  });

  it("„Dodaj odnośnik” dokleja pusty wiersz z nowym identyfikatorem", () => {
    const { onLinksChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: t("branding.addLink") }));
    const [links] = onLinksChange.mock.lastCall as [CookieBannerLink[]];
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual(LINK);
    expect(links[1]).toMatchObject({ url: "", label_pl: "", label_en: "" });
    expect(links[1].id).toMatch(/^lnk_[a-z0-9]+$/);
  });

  it("bez odnośników - informacja, że dokumenty obowiązkowe są pokazywane zawsze, z linkiem do ich ustawień", () => {
    setup([]);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Polityka Prywatności i Zasady przetwarzania danych/),
    ).toBeInTheDocument();
    // Stronę polityki, którą linkuje baner, ustawia się w ustawieniach
    // prywatności - panel prowadzi tam wprost, zamiast kazać jej szukać.
    expect(screen.getByRole("link", { name: t("branding.privacySettingsLink") })).toHaveAttribute(
      "href",
      "/admin/settings/privacy",
    );
  });

  it("LINKOWANIE: przy odnośniku widać adres w wersji PL i EN banera", () => {
    setup([
      LINK,
      { ...LINK, id: "lnk_b", url: "https://example.org/regulamin" },
      { ...LINK, id: "lnk_c", url: "/en/rodo#prawa" },
    ]);
    const items = screen.getAllByRole("listitem");
    expect(
      within(items[0]).getByText(t("branding.resolved", { pl: "/cookies", en: "/en/cookies" })),
    ).toBeInTheDocument();
    // Adres zewnętrzny nie dostaje prefiksu języka.
    expect(
      within(items[1]).getByText(
        t("branding.resolved", {
          pl: "https://example.org/regulamin",
          en: "https://example.org/regulamin",
        }),
      ),
    ).toBeInTheDocument();
    // Ścieżka już z prefiksem jest sprowadzana do języka banera; kotwica zostaje.
    expect(
      within(items[2]).getByText(
        t("branding.resolved", { pl: "/rodo#prawa", en: "/en/rodo#prawa" }),
      ),
    ).toBeInTheDocument();
    // Podgląd adresu jest opisem pola adresu (czytnik ekranu go odczyta).
    const url = within(items[0]).getByLabelText(t("branding.urlLabel"));
    expect(url.getAttribute("aria-describedby")).toBe("lnk_a-resolved");
    expect(url).not.toHaveAttribute("aria-invalid");
  });

  it("LINKOWANIE: adres, którego baner nie pokaże, jest oznaczony jako błędny", () => {
    setup([
      { ...LINK, url: "javascript:alert(1)" },
      { ...LINK, id: "lnk_b", url: "" },
    ]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(t("branding.invalidUrl"))).toBeInTheDocument();
    expect(within(items[0]).getByLabelText(t("branding.urlLabel"))).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Puste pole w trakcie wpisywania nie jest jeszcze błędem.
    expect(within(items[1]).queryByText(t("branding.invalidUrl"))).not.toBeInTheDocument();
    expect(within(items[1]).getByLabelText(t("branding.urlLabel"))).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("JĘZYK INTERFEJSU: przy angielskim interfejsie sekcja jest po angielsku", async () => {
    await i18n.changeLanguage("en");
    setup();
    expect(screen.getByRole("heading", { name: "Banner logo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Links in the banner" })).toBeInTheDocument();
    expect(screen.getByLabelText("Logo - dark mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label (English)")).toHaveValue("Cookies EN");
    // Ani jednego polskiego napisu panelu.
    expect(document.body.textContent).not.toMatch(/Odnośniki|Dodaj|Usuń|Logo banera|Rozmiar/);
  });

  it("domyślny rozmiar kafla to 36 px", () => {
    expect(COOKIE_BANNER_LOGO_DEFAULTS.size).toBe(36);
  });
});

describe("DetectedElementsPanel - skaner przeglądarki", () => {
  beforeEach(() => resetBrowserStorage());
  afterEach(() => resetBrowserStorage());

  it("pokazuje liczbę przeskanowanych kluczy i tylko NIEPUSTE kategorie", () => {
    render(<DetectedElementsPanel />);
    expect(screen.getByText(t("detected.scanSummary", { count: 0 }))).toBeInTheDocument();
    expect(screen.getByText(/Skan przeglądarki: 0 kluczy/)).toBeInTheDocument();
    // Rejestr ma wpisy niezbędne, więc ta kategoria jest zawsze obecna.
    expect(screen.getByText(t("detected.categories.necessary"))).toBeInTheDocument();
  });

  it("element spoza rejestru jest oznaczony „auto” z wykrytym kluczem; „Skanuj ponownie” widzi nowe klucze", () => {
    render(<DetectedElementsPanel />);
    expect(screen.queryByText(t("detected.autoBadge"))).not.toBeInTheDocument();

    localStorage.setItem("nes.preferences", "{}");
    fireEvent.click(screen.getByRole("button", { name: t("detected.rescan") }));

    // Liczba mnoga po polsku: „1 klucz", nie „1 kluczy".
    expect(screen.getByText(/Skan przeglądarki: 1 klucz /)).toBeInTheDocument();
    const badge = screen.getByText(t("detected.autoBadge"));
    const row = badge.closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    expect(cells[0].textContent).toBe("nes.preferencesauto");
    expect(cells[1].textContent).toBe("localStorage");
    expect(cells[3].textContent).toBe("nes.preferences");
    // NAPRAWA w rejestrze: preferencja to kategoria funkcjonalna, nie marketing.
    const section = row.closest("div.border") as HTMLElement;
    expect(section.textContent).toMatch(/^Funkcjonalne/);
  });

  it("wpis rejestru bez wykrytych kluczy ma kreskę w kolumnie kluczy", () => {
    render(<DetectedElementsPanel />);
    const necessary = screen
      .getByText(t("detected.categories.necessary"))
      .closest("div.border") as HTMLElement;
    const firstRow = within(necessary).getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell")[3].textContent).toBe("-");
  });
});

describe("DetectedElementsPanel - język interfejsu", () => {
  beforeEach(() => resetBrowserStorage());
  afterEach(() => resetBrowserStorage());

  it("przy angielskim interfejsie kategorie, kolumny i CEL z rejestru są po angielsku", async () => {
    await i18n.changeLanguage("en");
    resetBrowserStorage();
    localStorage.setItem("nes.preferences", "{}");
    render(<DetectedElementsPanel />);
    expect(screen.getByRole("heading", { name: "Detected items" })).toBeInTheDocument();
    expect(screen.getByText(/^Browser scan: 1 key /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeInTheDocument();
    expect(screen.getByText("Necessary")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "Purpose" }).length).toBeGreaterThan(0);
    // Opis celu bierze `purpose_en` - wcześniej zawsze `purpose_pl`.
    const row = screen.getByText("auto-detected").closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("cell")[2].textContent).toBe(
      "Automatically detected interface preference stored locally.",
    );
    expect(document.body.textContent).not.toMatch(/Wykryte|Skan przeglądarki|Niezbędne|Cel/);
  });

  it("liczba mnoga EN: 2 keys", async () => {
    await i18n.changeLanguage("en");
    resetBrowserStorage();
    localStorage.setItem("a.pref", "1");
    localStorage.setItem("b.pref", "1");
    render(<DetectedElementsPanel />);
    expect(screen.getByText(/^Browser scan: 2 keys /)).toBeInTheDocument();
  });

  it("liczba mnoga PL: 2 klucze, 5 kluczy", async () => {
    for (const key of ["a.pref", "b.pref"]) localStorage.setItem(key, "1");
    const { unmount } = render(<DetectedElementsPanel />);
    expect(screen.getByText(/Skan przeglądarki: 2 klucze /)).toBeInTheDocument();
    unmount();
    for (const key of ["c.pref", "d.pref", "e.pref"]) localStorage.setItem(key, "1");
    render(<DetectedElementsPanel />);
    expect(screen.getByText(/Skan przeglądarki: 5 kluczy /)).toBeInTheDocument();
  });
});
