// PARYTET: `intrinsicSlotUse` (panel) = to, co REALNIE robi `ImageWidget`.
//
// SKĄD TEN PLIK. Edytor obrazu mierzy plik i zapisuje jego rozmiar po samym
// zaznaczeniu widgetu tylko wtedy, gdy publiczny renderer tej wartości użyje -
// inaczej kliknięcie w obraz w ramce albo w logo dokładało krok "cofnij" bez
// widocznego skutku i uruchamiało autozapis. Warunek "renderer użyje" żyje w
// panelu jako lustro `sizeOf` z `mediaWidgets.tsx` (renderer mieszka w chunku
// wejściowym i zostaje nietknięty), więc bez tego testu oba mogłyby się
// rozjechać po cichu.
//
// JAK TO JEST SPRAWDZANE. Każda treść z siatki dostaje dwa rozmiary-znaczniki
// (`111x11` dla `srcIntrinsic`, `222x22` dla `srcDarkIntrinsic`) i jest
// renderowana prawdziwym `ImageWidget` po stronie serwera, w obu językach i obu
// motywach. Slot jest "użyty", gdy jego znacznik pojawił się w atrybutach
// `width`/`height` w którymkolwiek z tych renderów - i dokładnie to ma
// odpowiedzieć `intrinsicSlotUse`. Wpisy listy motywu mają inny rozmiar
// (`333x33`), więc nie da się ich pomylić ze znacznikami treści.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WidgetContent } from "@/lib/builder/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Ustawienia są zasiane w cache'u - klient bazy nie ma prawa zostać wywołany.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      throw new Error("render obrazu nie może odpytywać bazy");
    },
  },
}));

import { ImageWidget } from "@/components/builder/organisms/widget-view/mediaWidgets";
import { intrinsicSlotUse, type IntrinsicSlotUse } from "@/lib/admin/imageIntrinsicUse";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";

const PHOTO = "https://neweuropeanstrategies.com/media/widgets/panel.jpg";
const PHOTO_DARK = "https://neweuropeanstrategies.com/media/widgets/panel-dark.jpg";
const SITE_LIGHT = "https://neweuropeanstrategies.com/media/theme/logo/nes-light.svg";
const SITE_DARK = "https://neweuropeanstrategies.com/media/theme/logo/nes-dark.svg";
const SITE_MOBILE = "https://neweuropeanstrategies.com/media/theme/logo/nes-mobile.svg";

const SRC_MARK = 'width="111" height="11"';
const DARK_MARK = 'width="222" height="22"';

type Logo = Record<string, unknown> | null | undefined;

/** Realny render serwera; zwraca, które znaczniki rozmiaru trafiły do HTML-u. */
function rendererUse(content: WidgetContent, logo: Logo): IntrinsicSlotUse {
  const use: IntrinsicSlotUse = { src: false, srcDark: false };
  for (const lang of ["pl", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(
        siteSettingsQueryOptions.queryKey,
        logo === undefined ? {} : { theme_options: { logo } },
      );
      const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <ImageWidget c={content} lang={lang} theme={theme} editable={false} />
        </QueryClientProvider>,
      );
      if (html.includes(SRC_MARK)) use.src = true;
      if (html.includes(DARK_MARK)) use.srcDark = true;
    }
  }
  return use;
}

const RATIOS: ReadonlyArray<WidgetContent> = [
  {},
  { ratio: "auto" },
  { ratio: "" },
  { ratio: "16/9" },
  { ratio: "1/1" },
];

const FILES: ReadonlyArray<WidgetContent> = [
  {},
  { src: PHOTO },
  { srcDark: PHOTO_DARK },
  { src: PHOTO, srcDark: PHOTO_DARK },
  { src: PHOTO, srcDark: PHOTO },
  // Adres odrzucany przez `safeImageUrl` - renderer go nie rysuje.
  { src: "javascript:alert(1)", srcDark: PHOTO_DARK },
  // Własny plik widgetu to ten sam adres co logo motywu.
  { src: SITE_LIGHT, srcDark: SITE_DARK },
];

const SITE_LOGO_CHOICES: ReadonlyArray<WidgetContent> = [
  {},
  { useSiteLogo: "" },
  { useSiteLogo: "main" },
  { useSiteLogo: "mobile" },
];

const ALTS: ReadonlyArray<WidgetContent> = [
  {},
  { alt_pl: "Panel dyskusyjny" },
  { alt_pl: "Logo" },
  // Heurystyka "logo" zależy od języka strony: po polsku logo, po angielsku nie.
  { alt_pl: "Logo", alt_en: "Brand mark" },
  { alt_pl: "Zdjęcie panelu", alt_en: "Logo" },
  // "analogowy" to nie całe słowo "logo".
  { alt_pl: "Zegar analogowy" },
];

const THEME_LOGOS: ReadonlyArray<Logo> = [
  undefined,
  null,
  {},
  { main: SITE_LIGHT },
  { main: SITE_LIGHT, main_dark: SITE_DARK },
  { main_dark: SITE_DARK },
  { mobile: SITE_MOBILE },
  { main: SITE_LIGHT, mobile: SITE_MOBILE, mobile_dark: SITE_DARK },
  // Adres z `javascript:` nie jest logo - renderer wraca do własnego pliku.
  { main: "javascript:alert(1)" },
  // Wpis listy motywu dla adresu własnego pliku widgetu ma pierwszeństwo...
  {
    intrinsic: [
      [PHOTO, "333x33"],
      [SITE_DARK, "333x33"],
    ],
  },
  // ...ale tylko poprawny: uszkodzony rozmiar i lista innego kształtu nie liczą się.
  { main: SITE_LIGHT, intrinsic: [[PHOTO_DARK, "0x0"]] },
  { intrinsic: { [PHOTO]: "333x33" } },
];

interface Case {
  content: WidgetContent;
  logo: Logo;
}

const CASES: Case[] = [];
for (const ratio of RATIOS)
  for (const files of FILES)
    for (const choice of SITE_LOGO_CHOICES)
      for (const alt of ALTS)
        for (const logo of THEME_LOGOS)
          CASES.push({
            content: {
              ...ratio,
              ...files,
              ...choice,
              ...alt,
              srcIntrinsic: "111x11",
              srcDarkIntrinsic: "222x22",
            },
            logo,
          });

describe("intrinsicSlotUse - parytet z rendererem widgetu obrazu", () => {
  it(`odpowiada dokładnie tak, jak renderuje ImageWidget (${CASES.length} przypadków)`, () => {
    const mismatches: Array<Case & { panel: IntrinsicSlotUse; renderer: IntrinsicSlotUse }> = [];
    const seen = { src: [0, 0], srcDark: [0, 0] };

    for (const testCase of CASES) {
      const panel = intrinsicSlotUse((key) => testCase.content[key], testCase.logo);
      const renderer = rendererUse(testCase.content, testCase.logo);
      seen.src[Number(renderer.src)] += 1;
      seen.srcDark[Number(renderer.srcDark)] += 1;
      if (panel.src !== renderer.src || panel.srcDark !== renderer.srcDark) {
        mismatches.push({ ...testCase, panel, renderer });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(mismatches).toHaveLength(0);
    // Siatka naprawdę rozróżnia: każdy slot bywa użyty i bywa pominięty, więc
    // predykat zawsze-prawda albo zawsze-fałsz nie przejdzie.
    for (const [unused, used] of [seen.src, seen.srcDark]) {
      expect(unused).toBeGreaterThan(100);
      expect(used).toBeGreaterThan(100);
    }
  });
});

describe("intrinsicSlotUse - przypadki nazwane", () => {
  const use = (content: WidgetContent, logo?: Logo) =>
    intrinsicSlotUse((key) => content[key], logo);

  it('obraz bez ramki z własnym plikiem (brak "Proporcji" albo "auto"): rozmiar jest używany', () => {
    expect(use({ src: PHOTO })).toEqual({ src: true, srcDark: false });
    expect(use({ src: PHOTO, ratio: "auto" })).toEqual({ src: true, srcDark: false });
    expect(use({ src: PHOTO, srcDark: PHOTO_DARK })).toEqual({ src: true, srcDark: true });
  });

  it("obraz w ramce: rozmiar żadnego slotu nie jest używany", () => {
    expect(use({ src: PHOTO, srcDark: PHOTO_DARK, ratio: "16/9" })).toEqual({
      src: false,
      srcDark: false,
    });
  });

  it("własny plik zastąpiony logo motywu: rozmiar z treści nie jest używany", () => {
    const logo = { main: SITE_LIGHT };
    expect(use({ src: PHOTO, useSiteLogo: "main" }, logo)).toEqual({ src: false, srcDark: false });
    expect(use({ src: PHOTO, alt_pl: "Logo" }, logo)).toEqual({ src: false, srcDark: false });
  });

  it('"Użyj logo witryny" bez logo w Opcjach motywu: renderer rysuje własny plik', () => {
    expect(use({ src: PHOTO, useSiteLogo: "main" }, {})).toEqual({ src: true, srcDark: false });
  });

  it("alt ze słowem logo tylko w jednym języku: własny plik jest rysowany w drugim", () => {
    const logo = { main: SITE_LIGHT };
    expect(use({ src: PHOTO, alt_pl: "Logo", alt_en: "Brand mark" }, logo)).toEqual({
      src: true,
      srcDark: false,
    });
  });

  it("ten sam adres w obu slotach: renderer czyta tylko `srcIntrinsic`", () => {
    expect(use({ src: PHOTO, srcDark: PHOTO })).toEqual({ src: true, srcDark: false });
  });

  it("wpis listy motywu dla adresu własnego pliku ma pierwszeństwo przed treścią", () => {
    expect(use({ src: PHOTO }, { intrinsic: [[PHOTO, "333x33"]] })).toEqual({
      src: false,
      srcDark: false,
    });
  });

  it("pusty widget i adres odrzucany przez `safeImageUrl`: nic do użycia", () => {
    expect(use({})).toEqual({ src: false, srcDark: false });
    expect(use({ src: "javascript:alert(1)" })).toEqual({ src: false, srcDark: false });
  });
});
