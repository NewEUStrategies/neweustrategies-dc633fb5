// Naturalne rozmiary plików logo dla `theme_options.logo.intrinsic`.
//
// Panel Opcji motywu woła to przy KAŻDYM "Zapisz" (i przy przywróceniu rewizji)
// i zapisuje wynik w tym samym upsercie co warianty logo. Publiczny render
// (pasek mobilny, pasek czytania, widget obrazu w trybie logo) szuka potem
// rozmiaru po adresie pliku i dokłada `<img>` atrybuty `width`/`height`.
//
// LISTA OPISUJE LOGO, KTÓRE ZOSTANIE W WIERSZU, a nie dokument wysłany do
// zapisu. Zapis ustawień scala dokument z bieżącym wierszem (`deepMerge` w
// `useSettings`) i żadnego klucza nie usuwa, ale tablicę - czyli tę listę -
// zastępuje w całości. Wariant, którego wysyłany dokument nie niesie (rewizja
// sprzed jego dodania), zostaje więc na stronie; lista liczona z samego
// dokumentu zabierała mu atrybuty do kolejnego "Zapisz".
// `measureSavedLogoIntrinsic` mierzy zestaw po scaleniu.
import { deepMerge } from "@/lib/deepMerge";
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
 * - Plik BEZ WŁASNEJ PROPORCJI (`noRatio` pomiaru, np. SVG bez `viewBox`) nie
 *   dostaje wpisu i TRACI wpis zapisany wcześniej: to nie chwilowa porażka,
 *   tylko wiadomość, że stary rozmiar był zastępczy (albo plik podmieniono pod
 *   tym samym adresem) i jego atrybuty zmieniają kształt logo.
 * - Wpisy adresów, których żaden wariant już nie używa, znikają: lista jest
 *   budowana od nowa i przy zapisie zastępuje poprzednią w całości.
 * - Adres `data:` jest pomijany: byłby w ustawieniach (a przez nie w każdym
 *   dokumencie HTML) zapisany drugi raz jako klucz, a obraz osadzony w adresie
 *   i tak nie czeka na sieć.
 * - `storedEntries` to lista z bieżącego wiersza: przy nieudanym pomiarze ma
 *   pierwszeństwo przed `logo.intrinsic` (jest nowsza niż lista przywracanej
 *   rewizji), a `logo.intrinsic` zostaje zapasem.
 */
export async function measureLogoIntrinsic(
  logo: LogoDraft | null | undefined,
  storedEntries?: unknown,
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
    const { size, noRatio } = measured[index];
    const previous = noRatio
      ? undefined
      : (findIntrinsicSize(storedEntries, url) ?? findIntrinsicSize(logo?.intrinsic, url));
    const kept = size || (previous ? formatIntrinsicSize(previous.width, previous.height) : "");
    if (kept) entries.push([url, kept]);
  });
  return entries;
}

/**
 * Lista rozmiarów dla logo, które zapis ZOSTAWI w wierszu: `next` (gałąź `logo`
 * wysyłanego dokumentu) scalone na wierzchu `stored` (gałąź `logo` bieżącego
 * wiersza) tą samą funkcją, której używa zapis ustawień. Wariant obecny tylko
 * w wierszu jest więc mierzony, wariant nadpisany przez `next` - nie.
 *
 * `stored` to wiersz, jaki zna panel (wczytany albo po własnym ostatnim
 * zapisie). Jeśli ktoś zmienił go równolegle, zestaw może się różnić od
 * zapisanego - wtedy brakuje najwyżej wpisu (znacznik bez atrybutów do
 * kolejnego "Zapisz"), nigdy nie powstaje wpis dla złego pliku, bo kluczem
 * jest adres.
 */
export function measureSavedLogoIntrinsic(
  next: LogoDraft | null | undefined,
  stored: LogoDraft | null | undefined,
): Promise<IntrinsicSizeEntry[]> {
  return measureLogoIntrinsic(deepMerge<LogoDraft>(stored ?? {}, next), stored?.intrinsic);
}
