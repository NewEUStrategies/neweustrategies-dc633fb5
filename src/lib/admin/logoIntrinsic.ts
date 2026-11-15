// Naturalne rozmiary plików logo dla `theme_options.logo.intrinsic`.
//
// Panel Opcji motywu woła to przy KAŻDYM "Zapisz" (i przy przywróceniu rewizji)
// i zapisuje wynik w tym samym upsercie co warianty logo. Publiczny render
// (pasek mobilny, pasek czytania, widget obrazu w trybie logo) szuka potem
// rozmiaru po adresie pliku i dokłada `<img>` atrybuty `width`/`height`.
import {
  findIntrinsicSize,
  formatIntrinsicSize,
  type IntrinsicSizeEntry,
} from "@/lib/media/intrinsicSize";
import { measureIntrinsicSize } from "@/lib/media/measureIntrinsicSize";

/**
 * Warianty renderowane na stronie jako `<img>` bez ramki. Logo organizacji,
 * ikony paska bocznego i zakładek (favicon, ekran główny) nie są tu mierzone:
 * nie trafiają do znaczników, którym brakuje `width`/`height`.
 */
export const PUBLIC_LOGO_KEYS = [
  "main",
  "main_dark",
  "mobile",
  "mobile_dark",
  "transparent",
  "transparent_dark",
] as const;

type LogoDraft = Partial<Record<(typeof PUBLIC_LOGO_KEYS)[number], unknown>> & {
  intrinsic?: unknown;
};

/**
 * Lista par `[adres, "WxH"]` dla różnych adresów sześciu wariantów, w
 * kolejności `PUBLIC_LOGO_KEYS`.
 *
 * - Adres jest kluczem DOKŁADNIE w postaci zapisanej w polu wariantu - tak
 *   porównują go renderery.
 * - Nieudany pomiar (plik chwilowo niedostępny) zostawia poprawny rozmiar
 *   zapisany wcześniej dla TEGO SAMEGO adresu; adres bez pomiaru i bez
 *   wcześniejszego wpisu jest pomijany (render zostaje bez atrybutów).
 * - Wpisy adresów, których żaden wariant już nie używa, znikają: lista jest
 *   budowana od nowa i przy zapisie zastępuje poprzednią w całości.
 * - Adres `data:` jest pomijany: byłby w ustawieniach (a przez nie w każdym
 *   dokumencie HTML) zapisany drugi raz jako klucz, a obraz osadzony w adresie
 *   i tak nie czeka na sieć.
 */
export async function measureLogoIntrinsic(
  logo: LogoDraft | null | undefined,
): Promise<IntrinsicSizeEntry[]> {
  const urls: string[] = [];
  for (const key of PUBLIC_LOGO_KEYS) {
    const url = logo?.[key];
    if (typeof url === "string" && url && !url.startsWith("data:") && !urls.includes(url)) {
      urls.push(url);
    }
  }
  const measured = await Promise.all(urls.map((url) => measureIntrinsicSize(url)));
  const entries: IntrinsicSizeEntry[] = [];
  urls.forEach((url, index) => {
    const previous = findIntrinsicSize(logo?.intrinsic, url);
    const size =
      measured[index] || (previous ? formatIntrinsicSize(previous.width, previous.height) : "");
    if (size) entries.push([url, size]);
  });
  return entries;
}
