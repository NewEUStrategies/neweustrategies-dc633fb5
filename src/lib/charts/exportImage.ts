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
//
// KOLOR W PLIKU JEST PRZENOŚNY: każdy atrybut koloru wychodzi jako `#rrggbb`
// albo `rgba()` (`exportColor.ts`). Przeglądarka oddaje styl obliczony
// w zapisie, który sama rozumie (`oklab(...)`, `color(srgb ...)`), a plik
// otwierają też programy, które tych zapisów nie znają - i malują wtedy
// wypełnienie domyślne, czyli czerń.
import { normalizujKolor, type OdczytZmiennej } from "./exportColor";

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

/**
 * Własności STOPNIA GRADIENTU - osobno, bo dotyczą wyłącznie `<stop>`.
 *
 * Bez nich eksport gubił gradienty w sposób trudny do zauważenia na małym
 * podglądzie i kosztowny na dużym. `stop-color` jedzie w znaczniku jako
 * `var(--chart-N-deep)`, a `stop-opacity` pola pod linią siedzi w `style`,
 * które ta funkcja zdejmuje razem z klasami. W pliku zostawał więc stopień
 * bez koloru (czerń domyślna) i bez krycia (pełne 1) - czyli pole pod linią
 * wychodziło z eksportu jako SOLIDNA PŁACHTA zasłaniająca własną linię.
 *
 * Lista jest oddzielna, a nie doklejona do FARBA, bo `getComputedStyle` zwróci
 * wartość początkową tych własności dla KAŻDEGO elementu rysunku i bez tego
 * warunku eksport dopisywałby `stop-color` do ścieżek, tekstów i prostokątów,
 * gdzie nie znaczą nic.
 */
const FARBA_STOPNIA = ["stop-color", "stop-opacity"] as const;

/** Atrybuty niosące KOLOR - te przechodzą przez `normalizujKolor`. */
const KOLOR = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"] as const;

/**
 * Atrybuty farby, w których po wklejeniu został jeszcze zapis z odwołaniem do
 * arkusza (`var(`) albo funkcją koloru - poza stroną nic nie znaczą, więc
 * znikają, zamiast zostać w pliku jako zapis, którego nikt nie odczyta.
 */
const ZAPIS_ARKUSZA = /var\(|color-mix\(|color\(|oklab\(|oklch\(/i;

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
    let zmienna: OdczytZmiennej | undefined;
    if (widok !== null) {
      const styl = widok.getComputedStyle(el);
      zmienna = (nazwa) => styl.getPropertyValue(nazwa);
      const nazwy = el.tagName.toLowerCase() === "stop" ? [...FARBA, ...FARBA_STOPNIA] : [...FARBA];
      for (const nazwa of nazwy) {
        const value = styl.getPropertyValue(nazwa).trim();
        // `var()` niezrozumiane przez przeglądarkę wraca tu jako pusty napis
        // albo jako samo `var(...)` - jedno i drugie jest bezużyteczne poza
        // stroną, więc nie wklejamy go w miejsce atrybutu, który MOŻE już
        // nieść wartość dosłowną.
        if (pusta(value) || value.includes("var(")) continue;
        kopia.setAttribute(nazwa, value);
      }
    }
    // KOLOR NA ZAPIS PRZENOŚNY. Wartość z atrybutu (wklejona albo zastana)
    // idzie przez `normalizujKolor`; `var()` rozwiązuje się zmiennymi
    // obliczonego stylu ORYGINAŁU. Kolor nierozwiązywalny znika - atrybut
    // z `var()` i tak nie znaczyłby w pliku nic.
    for (const nazwa of KOLOR) {
      const wartosc = kopia.getAttribute(nazwa);
      if (wartosc === null) continue;
      const kolor = normalizujKolor(wartosc, zmienna);
      if (kolor === null) kopia.removeAttribute(nazwa);
      else kopia.setAttribute(nazwa, kolor);
    }
    for (const nazwa of [...FARBA, ...FARBA_STOPNIA]) {
      const wartosc = kopia.getAttribute(nazwa);
      if (wartosc !== null && ZAPIS_ARKUSZA.test(wartosc)) kopia.removeAttribute(nazwa);
    }
    kopia.removeAttribute("class");
    kopia.removeAttribute("style");
  }
  klon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return klon;
}

/**
 * Rysunek jako samodzielny plik SVG - Z TŁEM I FONTEM.
 *
 * Tło jest prostokątem pod rysunkiem, nie stylem: SVG bez tła wklejony do
 * dokumentu o innym kolorze pokazuje tusz motywu na obcej płycie (jasne
 * etykiety ciemnego motywu na białej stronie znikają). Rodzina fontu idzie
 * atrybutem na korzeniu, bo każdy `<text>` ją dziedziczy, a arkusza strony
 * w pliku już nie ma.
 */
export function svgDoPliku(
  zrodlo: SVGSVGElement,
  opcje: { background?: string; fontFamily?: string } = {},
): Blob {
  const klon = svgZWklejonaFarba(zrodlo);
  const doc = zrodlo.ownerDocument;
  const szer = Math.max(1, Math.round(zrodlo.getBoundingClientRect().width || 720));
  const wys = Math.max(1, Math.round(zrodlo.getBoundingClientRect().height || 320));
  if (!klon.getAttribute("viewBox")) klon.setAttribute("viewBox", `0 0 ${szer} ${wys}`);
  if (opcje.fontFamily) klon.setAttribute("font-family", opcje.fontFamily);
  // Tło też w zapisie przenośnym - płyta motywu jasnego to `oklch(1 0 0)`.
  const background = opcje.background ? (normalizujKolor(opcje.background) ?? "#ffffff") : null;
  if (background !== null) {
    const tlo = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    tlo.setAttribute("x", "0");
    tlo.setAttribute("y", "0");
    tlo.setAttribute("width", "100%");
    tlo.setAttribute("height", "100%");
    tlo.setAttribute("fill", background);
    klon.insertBefore(tlo, klon.firstChild);
  }
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${klon.outerHTML}`], {
    type: "image/svg+xml;charset=utf-8",
  });
}

/**
 * Pobranie pliku przez tymczasowy link. Adres obiektu jest zwalniany
 * z opóźnieniem - część przeglądarek zaczyna pobieranie asynchronicznie
 * i natychmiastowe zwolnienie dawało pusty plik.
 */
export function pobierzPlik(nazwa: string, blob: Blob): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazwa;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Bezpieczna nazwa pliku z tytułu wykresu („CTR spada" -> „ctr-spada"). */
export function nazwaPliku(tytul: string, zapas = "wykres"): string {
  const base = tytul
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base === "" ? zapas : base;
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
    ctx.fillStyle = normalizujKolor(background) ?? background;
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
