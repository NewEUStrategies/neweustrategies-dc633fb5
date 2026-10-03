// Porównanie GEOMETRII pudełek paska „na czasie" bez silnika układu.
//
// happy-dom (jak jsdom) nie liczy layoutu: `getBoundingClientRect()` zwraca
// zera, więc „rezerwa ma tę samą wysokość, co pasek" nie da się sprawdzić
// liczbą z przeglądarki. Da się natomiast sprawdzić to, z czego ta wysokość
// WYNIKA: klasy pionowe (wysokość, pionowy padding/margines, pozioma krawędź)
// na ramce, na elemencie niosącym wysokość (`[data-tt-band]`) i na wszystkim
// pomiędzy nimi. Dwa pudełka o równych sygnaturach mają równą wysokość przy
// KAŻDYM `root font-size` - o to chodzi w rezerwie, bo repo skaluje rem płynnie.
//
// Bez importów z produkcji: helper ma być neutralnym przyrządem, a nie kopią
// mapowania, które ma sprawdzać.

/** Klasy, które mogą zmienić wysokość pudełka (po zdjęciu prefiksów `lg:` itd.). */
const VERTICAL_CLASS = [
  /^(?:min-|max-)?h-/, // wysokość
  /^-?[pm][tby]?-/, // pionowy padding / margines (`px-`, `mx-` nie łapią się)
  /^border(?:-[tby])?(?:-\d+|-\[[^\]]+\])?$/, // krawędź pozioma, bez kolorów
];

function verticalTokens(el: Element): string[] {
  return Array.from(el.classList)
    .map((token) => token.replace(/^(?:[a-z0-9-]+:)+/, ""))
    .filter((token) => VERTICAL_CLASS.some((re) => re.test(token)))
    .sort();
}

export interface TickerHeightSignature {
  /** Klasy pionowe ramki (u wszystkich wariantów: tylko dolna krawędź). */
  frame: string[];
  /** Klasy pionowe elementów MIĘDZY ramką a pasem (spłaszczone). */
  between: string[];
  /** Klasy pionowe pasa `[data-tt-band]`. */
  band: string[];
  /**
   * Rodzeństwo na ścieżce ramka -> pas, które może zająć miejsce w pionie
   * (wszystko poza `<style>`). Ma być zero - inaczej wysokość nie wynika
   * z samego pasa.
   */
  boxSiblings: number;
}

/** Sygnatura wysokości pudełka paska, rezerwy albo pasa szkieletu. */
export function tickerHeightSignature(frame: Element): TickerHeightSignature {
  const band = frame.querySelector("[data-tt-band]");
  if (!band) throw new Error("brak [data-tt-band] w pudełku paska");
  const between: string[] = [];
  let boxSiblings = 0;
  for (let node: Element | null = band; node && node !== frame; node = node.parentElement) {
    if (node !== band) between.push(...verticalTokens(node));
    const parent = node.parentElement;
    if (!parent) break;
    boxSiblings += Array.from(parent.children).filter(
      (sibling) => sibling !== node && sibling.tagName !== "STYLE",
    ).length;
  }
  return {
    frame: verticalTokens(frame),
    between: between.sort(),
    band: verticalTokens(band),
    boxSiblings,
  };
}

/**
 * Nominalna wysokość klasy Tailwinda (px przy root 16 px) - tylko postaci,
 * których używa pasek: `h-<n>` ze skali (n x 4 px), `h-[<n>px]` i
 * `h-[calc(<a>px+<b>rem)]`. Nieznana postać rzuca, żeby test nie zgadywał.
 */
export function tailwindHeightPx(token: string): number {
  const scale = /^h-(\d+(?:\.\d+)?)$/.exec(token);
  if (scale) return Number(scale[1]) * 4;
  const px = /^h-\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (px) return Number(px[1]);
  const calc = /^h-\[calc\((\d+(?:\.\d+)?)px\+(\d+(?:\.\d+)?)rem\)\]$/.exec(token);
  if (calc) return Number(calc[1]) + Number(calc[2]) * 16;
  throw new Error(`nieobsługiwana klasa wysokości: ${token}`);
}

/** Nominalna wysokość pudełka o danej sygnaturze (pas + dolna krawędź ramki). */
export function signatureHeightPx(signature: TickerHeightSignature): number {
  const heights = signature.band.filter((token) => token.startsWith("h-"));
  if (heights.length !== 1) throw new Error(`pas bez jednej klasy wysokości: ${heights}`);
  const border = signature.frame.filter((token) => /^border(?:-[tby])?$/.test(token)).length;
  return tailwindHeightPx(heights[0]) + border;
}
