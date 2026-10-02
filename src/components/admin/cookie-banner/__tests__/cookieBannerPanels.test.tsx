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
//     i skanuje ponownie na żądanie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

afterEach(() => cleanup());

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
    fireEvent.change(screen.getByLabelText("Logo - tryb ciemny"), {
      target: { value: "https://cdn.example.com/d.svg" },
    });
    expect(onLogoChange).toHaveBeenLastCalledWith({
      ...LOGO,
      dark: "https://cdn.example.com/d.svg",
    });
    fireEvent.change(screen.getByLabelText("Logo - tryb jasny"), { target: { value: "" } });
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
    fireEvent.change(first.getByPlaceholderText("Etykieta PL"), {
      target: { value: "Ciasteczka" },
    });
    expect(onLinksChange).toHaveBeenLastCalledWith([{ ...LINK, label_pl: "Ciasteczka" }, other]);
    fireEvent.change(first.getByPlaceholderText("Label EN"), {
      target: { value: "Cookie policy" },
    });
    expect(onLinksChange).toHaveBeenLastCalledWith([{ ...LINK, label_en: "Cookie policy" }, other]);
    fireEvent.change(first.getByPlaceholderText("/cookies"), { target: { value: "/polityka" } });
    expect(onLinksChange).toHaveBeenLastCalledWith([{ ...LINK, url: "/polityka" }, other]);

    fireEvent.click(
      within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Usuń" }),
    );
    expect(onLinksChange).toHaveBeenLastCalledWith([LINK]);
  });

  it("„Dodaj odnośnik” dokleja pusty wiersz z nowym identyfikatorem", () => {
    const { onLinksChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj odnośnik" }));
    const [links] = onLinksChange.mock.lastCall as [CookieBannerLink[]];
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual(LINK);
    expect(links[1]).toMatchObject({ url: "", label_pl: "", label_en: "" });
    expect(links[1].id).toMatch(/^lnk_[a-z0-9]+$/);
  });

  it("bez odnośników - informacja, że dokumenty obowiązkowe są pokazywane zawsze", () => {
    setup([]);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Polityka Prywatności i Zasady przetwarzania danych/),
    ).toBeInTheDocument();
  });

  it("domyślny rozmiar kafla to 36 px", () => {
    expect(COOKIE_BANNER_LOGO_DEFAULTS.size).toBe(36);
  });
});

describe("DetectedElementsPanel - skaner przeglądarki", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("pokazuje liczbę przeskanowanych kluczy i tylko NIEPUSTE kategorie", () => {
    render(<DetectedElementsPanel />);
    expect(screen.getByText(/Skan przeglądarki: 0 kluczy/)).toBeInTheDocument();
    // Rejestr ma wpisy niezbędne, więc ta kategoria jest zawsze obecna.
    expect(screen.getByText("Niezbędne")).toBeInTheDocument();
  });

  it("element spoza rejestru jest oznaczony „auto” z wykrytym kluczem; „Skanuj ponownie” widzi nowe klucze", () => {
    render(<DetectedElementsPanel />);
    expect(screen.queryByText("auto")).not.toBeInTheDocument();

    localStorage.setItem("nes.preferences", "{}");
    fireEvent.click(screen.getByRole("button", { name: "Skanuj ponownie" }));

    expect(screen.getByText(/Skan przeglądarki: 1 kluczy/)).toBeInTheDocument();
    const badge = screen.getByText("auto");
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
    const necessary = screen.getByText("Niezbędne").closest("div.border") as HTMLElement;
    const firstRow = within(necessary).getAllByRole("row")[1];
    expect(within(firstRow).getAllByRole("cell")[3].textContent).toBe("-");
  });
});
