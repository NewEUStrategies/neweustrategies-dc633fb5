// EKSPORT RYSUNKU DO PLIKU - z naszego SVG, nie z płótna ECharts.
//
// DLACZEGO TO NIE JEST `svg.outerHTML`. Silnik maluje TOKENAMI: `fill` znacznika
// to `var(--chart-3-inner)`, a wartość tej zmiennej mieszka w arkuszu strony.
// Wycięty SVG traci dostęp do arkusza, więc zserializowany „tak jak jest"
// otwiera się jako rysunek CZARNY ALBO PUSTY - i to jest defekt, którego nie
// widać w kodzie: plik powstaje, pobiera się, ma poprawny rozmiar, a treści nie
// ma. Dlatego przed serializacją WKLEJAMY OBLICZONĄ FARBĘ w atrybuty
// prezentacyjne: to jedyny zapis, który niesie się poza stronę.
//
// CO WKLEJAMY, a czego nie. Wyłącznie własności, które decydują o wyglądzie
// znacznika (farba, obrys, krycie, typografia). NIE wklejamy geometrii
// (`x`, `width`, `d`), bo ona już jest w atrybutach, ani układu (`display`,
// `transform` z klas), bo to zmieniłoby rysunek zamiast go odwzorować.
//
// KOLEJNOŚĆ MA ZNACZENIE: klonujemy, potem czytamy styl z ORYGINAŁU (klon nie
// jest w drzewie, więc `getComputedStyle` nie ma dla niego czego policzyć)
// i zapisujemy w klonie.

/**
 * Własności, które niosą wygląd znacznika.
 *
 * `stroke-dasharray` jest tu, choć rusztowanie jest ciągłe: kreskowanie zostało
 * w JEDNYM miejscu - w teksturze strefy prognozy - i pominięcie go zabierałoby
 * eksportowi jeden z trzech nośników odróżnienia prognozy od pomiaru.
 */
const FARBA = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
] as const;

/** Czy napis jest wartością, której nie ma sensu wklejać. */
function pusta(value: string): boolean {
  return value === "" || value === "auto" || value === "normal";
}

/**
 * Kopia rysunku z farbą WKLEJONĄ w atrybuty i bez odwołań do arkusza.
 *
 * Klasy i `style` znikają razem z nimi: zostawione wskazywałyby na reguły,
 * których w pliku nie ma, a przy otwarciu w przeglądarce mogłyby trafić na
 * CUDZY arkusz o tych samych nazwach klas.
 */
export function svgZWklejonaFarba(zrodlo: SVGSVGElement): SVGSVGElement {
  const klon = zrodlo.cloneNode(true) as SVGSVGElement;
  const widok = zrodlo.ownerDocument.defaultView;
  const oryginaly = [zrodlo, ...zrodlo.querySelectorAll("*")];
  const kopie = [klon, ...klon.querySelectorAll("*")];
  for (let i = 0; i < oryginaly.length && i < kopie.length; i++) {
    const el = oryginaly[i];
    const kopia = kopie[i];
    if (widok !== null) {
      const styl = widok.getComputedStyle(el);
      for (const nazwa of FARBA) {
        const value = styl.getPropertyValue(nazwa).trim();
        // `var()` niezrozumiane przez przeglądarkę wraca tu jako pusty napis
        // albo jako samo `var(...)` - jedno i drugie jest bezużyteczne poza
        // stroną, więc nie wklejamy go w miejsce atrybutu, który MOŻE już
        // nieść wartość dosłowną.
        if (pusta(value) || value.includes("var(")) continue;
        kopia.setAttribute(nazwa, value);
      }
    }
    kopia.removeAttribute("class");
    kopia.removeAttribute("style");
  }
  klon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return klon;
}

/** Rysunek jako samodzielny plik SVG. */
export function svgDoPliku(zrodlo: SVGSVGElement): Blob {
  const klon = svgZWklejonaFarba(zrodlo);
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${klon.outerHTML}`], {
    type: "image/svg+xml;charset=utf-8",
  });
}

/**
 * Jeden wpis KLUCZA dołączanego do zrzutu.
 *
 * PO CO KLUCZ W OGÓLE JEDZIE DO PLIKU. Rysunek silnika to samo `<svg>`;
 * legenda serii i tabela klucza tarczy są obok niego ZWYKŁYM HTML-em, więc
 * zrzut zrobiony z samego węzła rysunku wypuszcza obrazek, na którym serie
 * różnią się kolorem, a nic nie mówi, która jest która - i pierścień
 * z bezimiennymi wycinkami. Na ekranie ta informacja jest, w pliku jej nie
 * było: to była regresja wobec eksportu z kanwy, która legendę malowała
 * razem z rysunkiem.
 */
export interface WpisKlucza {
  /** Nazwa serii albo kategorii - to, czego czytelnik szuka przy kolorze. */
  label: string;
  /** Kolor PRÓBKI (wypełnienie kwadratu). */
  color: string;
  /** Kolor NAPISU. Osobny, bo próbka i napis mają różne progi kontrastu. */
  textColor: string;
}

/** Geometria paska klucza w pikselach CSS, przed przemnożeniem przez `scale`. */
const KLUCZ = {
  wysWiersza: 18,
  probka: 10,
  odstepProbki: 6,
  odstepWpisow: 18,
  marginesY: 10,
  marginesX: 12,
  font: 12,
} as const;

/** Rozkład wpisów klucza na wiersze - zachłannie, z zawijaniem do szerokości. */
function rozlozKlucz(
  ctx: CanvasRenderingContext2D,
  klucz: readonly WpisKlucza[],
  dostepna: number,
): WpisKlucza[][] {
  const wiersze: WpisKlucza[][] = [];
  let biezacy: WpisKlucza[] = [];
  let x = 0;
  for (const wpis of klucz) {
    const szer =
      KLUCZ.probka + KLUCZ.odstepProbki + ctx.measureText(wpis.label).width + KLUCZ.odstepWpisow;
    // Pierwszy wpis wiersza wchodzi ZAWSZE, choćby sam nie mieścił się
    // w szerokości: wiersz pusty nie pokazałby go wcale, a przycięty napis
    // wciąż niesie początek nazwy.
    if (biezacy.length > 0 && x + szer > dostepna) {
      wiersze.push(biezacy);
      biezacy = [];
      x = 0;
    }
    biezacy.push(wpis);
    x += szer;
  }
  if (biezacy.length > 0) wiersze.push(biezacy);
  return wiersze;
}

/**
 * Rysunek jako PNG.
 *
 * TŁO JEST OBOWIĄZKOWE i to nie jest ozdoba: PNG z przezroczystym tłem wklejony
 * do dokumentu o ciemnym tle pokazuje ciemny tusz na ciemnym - czyli nic.
 * Wywołujący podaje kolor płyty, bo tylko on wie, na czym rysunek stoi.
 *
 * `scale` to gęstość pikseli: dwójka daje plik czytelny po wklejeniu do
 * prezentacji, gdzie rysunek bywa skalowany w górę.
 *
 * `klucz` DOKLEJA pasek nazw pod rysunkiem - patrz `WpisKlucza`. Pusta lista
 * znaczy „ten rodzaj nie ma klucza" (jedna seria, histogram, mapa cieplna)
 * i wtedy plik ma dokładnie wymiary rysunku.
 */
export async function svgDoPng(
  zrodlo: SVGSVGElement,
  {
    background,
    scale = 2,
    klucz = [],
  }: { background: string; scale?: number; klucz?: readonly WpisKlucza[] },
): Promise<Blob> {
  const klon = svgZWklejonaFarba(zrodlo);
  const szer = Math.max(1, Math.round(zrodlo.getBoundingClientRect().width || 720));
  const wys = Math.max(1, Math.round(zrodlo.getBoundingClientRect().height || 320));
  const rodzina =
    zrodlo.ownerDocument.defaultView?.getComputedStyle(zrodlo).fontFamily || "sans-serif";
  const czcionka = `${KLUCZ.font}px ${rodzina}`;
  const url = URL.createObjectURL(
    new Blob([klon.outerHTML], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const obraz = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("nie da się wczytać rysunku"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = szer * scale;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("brak kontekstu 2d");

    // ROZKŁAD PRZED USTALENIEM WYSOKOŚCI: dopiero on mówi, ile wierszy zajmie
    // klucz. Zapis `canvas.height` czyści płótno i resetuje stan kontekstu,
    // więc czcionkę ustawiamy dwa razy - raz do pomiaru, raz do rysowania.
    ctx.font = czcionka;
    const wiersze =
      klucz.length === 0 ? [] : rozlozKlucz(ctx, klucz, Math.max(1, szer - 2 * KLUCZ.marginesX));
    const wysKlucza =
      wiersze.length === 0 ? 0 : wiersze.length * KLUCZ.wysWiersza + 2 * KLUCZ.marginesY;

    canvas.height = (wys + wysKlucza) * scale;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(obraz, 0, 0, szer * scale, wys * scale);

    if (wiersze.length > 0) {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.font = czcionka;
      ctx.textBaseline = "middle";
      let y = wys + KLUCZ.marginesY + KLUCZ.wysWiersza / 2;
      for (const wiersz of wiersze) {
        let x = KLUCZ.marginesX;
        for (const wpis of wiersz) {
          ctx.fillStyle = wpis.color;
          ctx.fillRect(x, y - KLUCZ.probka / 2, KLUCZ.probka, KLUCZ.probka);
          x += KLUCZ.probka + KLUCZ.odstepProbki;
          ctx.fillStyle = wpis.textColor;
          ctx.fillText(wpis.label, x, y);
          x += ctx.measureText(wpis.label).width + KLUCZ.odstepWpisow;
        }
        y += KLUCZ.wysWiersza;
      }
      ctx.restore();
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error("płótno nie oddało pliku"));
        else resolve(blob);
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
