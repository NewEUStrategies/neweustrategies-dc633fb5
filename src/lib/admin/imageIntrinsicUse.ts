// Czy publiczny renderer widgetu obrazu UŻYJE rozmiaru zapisanego w treści
// (`srcIntrinsic` / `srcDarkIntrinsic`).
//
// WYŁĄCZNIE KOD PANELU. Edytor obrazu pyta o to, zanim zmierzy plik i zapisze
// rozmiar po samym ZAZNACZENIU widgetu: zapis przechodzi przez historię
// buildera (krok "cofnij", wyczyszczony stos "ponów") i autozapis, więc nie
// może dotyczyć wartości, którą renderer i tak odrzuca - obrazu w ramce albo
// widgetu, którego własny plik zastępuje logo motywu.
//
// To LUSTRO funkcji `sizeOf` z `mediaWidgets.tsx` (i wyboru adresów powyżej
// niej), a nie druga definicja reguły: renderer zostaje nietknięty, bo mieszka
// w chunku wejściowym. Zgodność obu pilnuje test parytetu
// (`imageIntrinsicUse.parity.test.tsx`), który renderuje prawdziwy `ImageWidget`
// na siatce treści i ustawień motywu - zmiana renderera bez zmiany tutaj go
// oblewa.
import { altMarksLogo } from "@/lib/builder/logoAlt";
import { findIntrinsicSize } from "@/lib/media/intrinsicSize";
import { safeImageUrl } from "@/lib/sanitizePure";

/** Slot pliku widgetu obrazu. */
export type ImageFileSlot = "src" | "srcDark";
export const IMAGE_FILE_SLOTS: readonly ImageFileSlot[] = ["src", "srcDark"];

/** Dla każdego slotu: czy renderer sięgnie po rozmiar zapisany dla jego pliku. */
export type IntrinsicSlotUse = Record<ImageFileSlot, boolean>;

/** Odczyt klucza treści widgetu (edytor nakłada tu zapisy jeszcze nieoddane propsem). */
export type ContentReader = (key: string) => unknown;

/** `theme_options.logo` - surowy JSON ustawień, jak w rendererze. */
export type SiteLogoSettings = Record<string, unknown> | null | undefined;

/** Języki, w których renderer rysuje widget (`Lang` w `widget-view/frame`). */
const RENDER_LANGS = ["pl", "en"] as const;

/**
 * Slot jest "w użyciu", gdy w KTÓRYMKOLWIEK języku strony renderer narysuje
 * jego plik bez ramki i weźmie rozmiar z treści widgetu:
 *  - "Proporcje" są puste albo "auto" (obraz w ramce nie dostaje atrybutów),
 *  - adres slotu przechodzi `safeImageUrl` i realnie trafia do `src` - nie
 *    zastępuje go logo motywu ("Użyj logo witryny" albo alt ze słowem "logo"
 *    przy skonfigurowanym logo),
 *  - `theme_options.logo.intrinsic` nie ma poprawnego wpisu dla tego adresu
 *    (wpis motywu ma w rendererze pierwszeństwo),
 *  - dla slotu ciemnego: jego adres jest inny niż adres slotu jasnego (przy
 *    tym samym adresie renderer czyta tylko `srcIntrinsic`).
 * Motyw strony (jasny/ciemny) nie ma znaczenia: para rysuje oba pliki, a
 * pojedynczy obraz ma w obu motywach ten sam adres.
 */
export function intrinsicSlotUse(read: ContentReader, logo: SiteLogoSettings): IntrinsicSlotUse {
  const use: IntrinsicSlotUse = { src: false, srcDark: false };
  const text = (key: string): string => {
    const value = read(key);
    return typeof value === "string" ? value : "";
  };

  const ratio = text("ratio");
  if (ratio && ratio !== "auto") return use;

  const rawSrc = safeImageUrl(text("src"));
  const rawSrcDark = safeImageUrl(text("srcDark"));
  if (!rawSrc && !rawSrcDark) return use;

  // Jak `useSiteLogo(variant)` renderera.
  const siteLogoVariant = text("useSiteLogo");
  const variant = siteLogoVariant || "main";
  const logoMap = (logo ?? {}) as Record<string, string | undefined>;
  const main = safeImageUrl(logoMap.main ?? "");
  const mainDark = safeImageUrl(logoMap.main_dark ?? "");
  const siteLight = safeImageUrl(logoMap[variant] ?? "") || main;
  const siteDark = safeImageUrl(logoMap[`${variant}_dark`] ?? "") || mainDark || main;

  for (const lang of RENDER_LANGS) {
    const alt = text(`alt_${lang}`) || text("alt_pl");
    const wantsSiteLogo = siteLogoVariant !== "" || altMarksLogo(alt);
    const src = wantsSiteLogo ? siteLight || rawSrc : rawSrc;
    const srcDark = wantsSiteLogo ? siteDark || rawSrcDark || siteLight || rawSrc : rawSrcDark;
    // `lightSrc` i `darkSrc` renderera.
    for (const url of [src || srcDark, srcDark || src]) {
      if (!url || findIntrinsicSize(logoMap.intrinsic, url)) continue;
      if (url === rawSrc) use.src = true;
      else if (url === rawSrcDark) use.srcDark = true;
    }
  }
  return use;
}
