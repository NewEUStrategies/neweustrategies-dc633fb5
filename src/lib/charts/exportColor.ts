// KOLOR W PLIKU EKSPORTU - wyłącznie `#rrggbb` albo `rgba()`.
//
// DLACZEGO. Silnik maluje tokenami i mieszankami (`var(--chart-accent)`,
// `color-mix(in oklab, ... 18%, var(--card))`), a przeglądarka oddaje styl
// obliczony w zapisie, który sama rozumie: `oklab(0.72 0.09 0.11)`,
// `color(srgb 0.98 0.58 0.27)`, czasem wprost `color-mix(...)`. Plik SVG
// otwiera jednak nie tylko przeglądarka - edytor grafiki, pakiet biurowy,
// starszy podgląd systemowy. Każdy z nich zna `#rrggbb` i `rgba()`, a mało
// który zna OKLab; nieznany kolor to wypełnienie domyślne, czyli CZARNA plama
// zamiast wycinka. `var(...)` poza stroną nie znaczy w ogóle nic.
//
// Moduł jest czysty (bez DOM): dostaje napis i - dla `var()` - funkcję, która
// czyta wartość zmiennej z obliczonego stylu oryginału.

/** Kolor jako sRGB (0..1, z gammą) i krycie 0..1. */
type Rgba = [number, number, number, number];

/** Funkcja odczytu zmiennej CSS (`--chart-accent` -> `#fa9346`). */
export type OdczytZmiennej = (nazwa: string) => string;

/** Głębokość zagnieżdżenia `var()`/`color-mix()`, po której przestajemy szukać. */
const MAX_GLEBOKOSC = 12;

const NAZWANE: Readonly<Record<string, Rgba>> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function doLiniowego(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function zLiniowego(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** OKLab -> sRGB z gammą (Björn Ottosson), kanały przycięte do gamutu. */
function zOklab(l: number, a: number, b: number): [number, number, number] {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    zLiniowego(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    zLiniowego(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    zLiniowego(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

/** sRGB z gammą -> OKLab. */
function doOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = doLiniowego(r);
  const lg = doLiniowego(g);
  const lb = doLiniowego(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Liniowy Display P3 -> liniowy sRGB. */
function p3DoSrgb(r: number, g: number, b: number): [number, number, number] {
  return [
    zLiniowego(1.2249401 * r - 0.2249404 * g),
    zLiniowego(-0.0420569 * r + 1.0420571 * g),
    zLiniowego(-0.0196376 * r - 0.0786361 * g + 1.0982735 * b),
  ];
}

/** Indeks nawiasu domykającego ten, który otwiera się na pozycji `start`. */
function domkniecie(s: string, start: number): number {
  let poziom = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "(") poziom++;
    else if (s[i] === ")") {
      poziom--;
      if (poziom === 0) return i;
    }
  }
  return -1;
}

/** Podział po przecinkach NAJWYŻSZEGO poziomu (przecinek w nawiasie zostaje). */
function poPrzecinkach(s: string): string[] {
  const out: string[] = [];
  let poziom = 0;
  let od = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") poziom++;
    else if (s[i] === ")") poziom--;
    else if (s[i] === "," && poziom === 0) {
      out.push(s.slice(od, i).trim());
      od = i + 1;
    }
  }
  out.push(s.slice(od).trim());
  return out;
}

/** Podział po spacjach najwyższego poziomu. */
function poSpacjach(s: string): string[] {
  const out: string[] = [];
  let poziom = 0;
  let biezacy = "";
  for (const z of s) {
    if (z === "(") poziom++;
    if (z === ")") poziom--;
    if (/\s/.test(z) && poziom === 0) {
      if (biezacy !== "") out.push(biezacy);
      biezacy = "";
    } else biezacy += z;
  }
  if (biezacy !== "") out.push(biezacy);
  return out;
}

/**
 * Podstawia każde `var(--x[, zapas])` wartością zmiennej (albo zapasem).
 * `null`, gdy zmiennej nie da się rozwiązać - kolor z dziurą nie jest kolorem.
 */
function bezZmiennych(
  s: string,
  zmienna: OdczytZmiennej | undefined,
  glebokosc: number,
): string | null {
  if (glebokosc > MAX_GLEBOKOSC) return null;
  let wynik = s;
  for (;;) {
    const start = wynik.indexOf("var(");
    if (start < 0) return wynik;
    const koniec = domkniecie(wynik, start + 3);
    if (koniec < 0) return null;
    const [nazwa, ...zapas] = poPrzecinkach(wynik.slice(start + 4, koniec));
    const odczyt = zmienna?.(nazwa.trim()).trim() ?? "";
    const wartosc = odczyt !== "" ? odczyt : zapas.length > 0 ? zapas.join(",") : null;
    if (wartosc === null) return null;
    const rozwiazana = bezZmiennych(wartosc, zmienna, glebokosc + 1);
    if (rozwiazana === null) return null;
    wynik = wynik.slice(0, start) + rozwiazana + wynik.slice(koniec + 1);
  }
}

/** Liczba albo procent (`skala` = wartość odpowiadająca 100%). */
function skladowa(raw: string | undefined, skala: number): number | null {
  if (raw === undefined || raw === "none") return raw === "none" ? 0 : null;
  const procent = raw.endsWith("%");
  const v = Number.parseFloat(procent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(v)) return null;
  return procent ? (v / 100) * skala : v;
}

/** Kąt odcienia w stopniach (`deg`, `rad`, `turn` albo liczba). */
function kat(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (raw === "none") return 0;
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  if (raw.endsWith("rad")) return (v * 180) / Math.PI;
  if (raw.endsWith("turn")) return v * 360;
  return v;
}

/** Argumenty funkcji koloru: trzy składowe i opcjonalne krycie po `/`. */
function argumenty(wnetrze: string): { czesci: string[]; alfa: number } | null {
  const [przed, po] = wnetrze.split("/");
  const czesci = przed.includes(",") ? poPrzecinkach(przed) : poSpacjach(przed.trim());
  let alfa = 1;
  const surowa = po?.trim() ?? (czesci.length === 4 ? czesci.pop() : undefined);
  if (surowa !== undefined) {
    const a = skladowa(surowa, 1);
    if (a === null) return null;
    alfa = a;
  }
  return { czesci, alfa: clamp01(alfa) };
}

function hex(raw: string): Rgba | null {
  const h = raw.slice(1);
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  const pelny =
    h.length === 3 || h.length === 4
      ? [...h].map((c) => c + c).join("")
      : h.length === 6 || h.length === 8
        ? h
        : null;
  if (pelny === null) return null;
  const kan = (i: number): number => Number.parseInt(pelny.slice(i, i + 2), 16) / 255;
  return [kan(0), kan(2), kan(4), pelny.length === 8 ? kan(6) : 1];
}

/** Mieszanka `color-mix(in <przestrzeń>, A [p%], B [q%])` - krycie premnożone. */
function mieszanka(
  wnetrze: string,
  zmienna: OdczytZmiennej | undefined,
  glebokosc: number,
): Rgba | null {
  const [przestrzen, ...kolory] = poPrzecinkach(wnetrze);
  if (kolory.length !== 2) return null;
  const metoda = przestrzen.replace(/^in\s+/, "").trim();
  const rozbierz = (arg: string): { kolor: Rgba | null; pct: number | null } => {
    const slowa = poSpacjach(arg);
    const pctIdx = slowa.findIndex((w) => /^-?[\d.]+%$/.test(w));
    const pct = pctIdx >= 0 ? Number.parseFloat(slowa[pctIdx]) : null;
    const kolor = parsuj(slowa.filter((_, i) => i !== pctIdx).join(" "), zmienna, glebokosc + 1);
    return { kolor, pct };
  };
  const a = rozbierz(kolory[0]);
  const b = rozbierz(kolory[1]);
  if (a.kolor === null || b.kolor === null) return null;
  let p1 = a.pct;
  let p2 = b.pct;
  if (p1 === null && p2 === null) {
    p1 = 50;
    p2 = 50;
  } else if (p1 === null) p1 = 100 - (p2 ?? 0);
  else if (p2 === null) p2 = 100 - p1;
  const suma = (p1 ?? 0) + (p2 ?? 0);
  if (suma <= 0) return null;
  const w1 = (p1 ?? 0) / suma;
  const w2 = (p2 ?? 0) / suma;
  // Suma poniżej 100% obniża krycie wyniku (CSS Color 5).
  const mnoznik = Math.min(1, suma / 100);
  const [r1, g1, bl1, al1] = a.kolor;
  const [r2, g2, bl2, al2] = b.kolor;
  const alfa = al1 * w1 + al2 * w2;
  const wsp = (x: [number, number, number], y: [number, number, number]): number[] =>
    alfa === 0 ? [0, 0, 0] : x.map((v, i) => (v * al1 * w1 + y[i] * al2 * w2) / alfa);
  let rgb: [number, number, number];
  if (metoda === "srgb") {
    rgb = wsp([r1, g1, bl1], [r2, g2, bl2]) as [number, number, number];
  } else if (metoda === "srgb-linear") {
    const lin = wsp(
      [doLiniowego(r1), doLiniowego(g1), doLiniowego(bl1)],
      [doLiniowego(r2), doLiniowego(g2), doLiniowego(bl2)],
    );
    rgb = [zLiniowego(lin[0]), zLiniowego(lin[1]), zLiniowego(lin[2])];
  } else {
    // OKLab (silnik miesza wyłącznie w nim) i każda inna przestrzeń
    // biegunowa - przybliżenie mieszanką OKLab zamiast czerni jest tu
    // zawsze bliżej prawdy.
    const [l, aa, bb] = wsp(doOklab(r1, g1, bl1), doOklab(r2, g2, bl2));
    rgb = zOklab(l, aa, bb);
  }
  return [rgb[0], rgb[1], rgb[2], clamp01(alfa * mnoznik)];
}

/** Rozbiór zapisu koloru na sRGB + krycie; `null`, gdy zapis jest nieznany. */
function parsuj(raw: string, zmienna: OdczytZmiennej | undefined, glebokosc: number): Rgba | null {
  if (glebokosc > MAX_GLEBOKOSC) return null;
  const bez = bezZmiennych(raw.trim(), zmienna, glebokosc);
  if (bez === null) return null;
  const s = bez.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAZWANE, s)) return NAZWANE[s];
  if (s.startsWith("#")) return hex(s);
  const nawias = s.indexOf("(");
  if (nawias < 0 || !s.endsWith(")")) return null;
  const funkcja = s.slice(0, nawias).trim();
  const wnetrze = s.slice(nawias + 1, -1);
  if (funkcja === "color-mix") return mieszanka(wnetrze, zmienna, glebokosc);
  if (funkcja === "color") {
    const [przestrzen, ...reszta] = poSpacjach(wnetrze.split("/")[0]);
    const alfaRaw = wnetrze.includes("/") ? wnetrze.split("/")[1].trim() : "1";
    const [x, y, z] = reszta.map((v) => skladowa(v, 1));
    const alfa = skladowa(alfaRaw, 1);
    if (x == null || y == null || z == null || alfa === null) return null;
    if (przestrzen === "srgb") return [clamp01(x), clamp01(y), clamp01(z), clamp01(alfa)];
    if (przestrzen === "srgb-linear")
      return [zLiniowego(x), zLiniowego(y), zLiniowego(z), clamp01(alfa)];
    if (przestrzen === "display-p3") {
      const [r, g, b] = p3DoSrgb(doLiniowego(x), doLiniowego(y), doLiniowego(z));
      return [r, g, b, clamp01(alfa)];
    }
    return null;
  }
  const args = argumenty(wnetrze);
  if (args === null || args.czesci.length < 3) return null;
  const [c1, c2, c3] = args.czesci;
  if (funkcja === "rgb" || funkcja === "rgba") {
    const r = skladowa(c1, 255);
    const g = skladowa(c2, 255);
    const b = skladowa(c3, 255);
    if (r === null || g === null || b === null) return null;
    return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), args.alfa];
  }
  if (funkcja === "oklab") {
    const l = skladowa(c1, 1);
    const a = skladowa(c2, 0.4);
    const b = skladowa(c3, 0.4);
    if (l === null || a === null || b === null) return null;
    return [...zOklab(l, a, b), args.alfa];
  }
  if (funkcja === "oklch") {
    const l = skladowa(c1, 1);
    const c = skladowa(c2, 0.4);
    const h = kat(c3);
    if (l === null || c === null || h === null) return null;
    const rad = (h * Math.PI) / 180;
    return [...zOklab(l, c * Math.cos(rad), c * Math.sin(rad)), args.alfa];
  }
  return null;
}

function bajt(v: number): number {
  return Math.round(clamp01(v) * 255);
}

/**
 * Kolor w zapisie przenośnym: `#rrggbb` dla pełnego krycia, `rgba()` dla
 * częściowego. Wartości bez koloru (`none`, `url(#...)`, `currentcolor`)
 * wracają bez zmian. `null` znaczy „tego koloru nie da się rozwiązać" -
 * wołający usuwa wtedy atrybut, zamiast zostawić w pliku zapis, którego nikt
 * nie przeczyta.
 */
export function normalizujKolor(raw: string, zmienna?: OdczytZmiennej): string | null {
  const s = raw.trim();
  if (s === "") return null;
  const male = s.toLowerCase();
  if (male === "none" || male === "currentcolor" || male.startsWith("url(")) return s;
  const rgba = parsuj(s, zmienna, 0);
  if (rgba === null) return null;
  const [r, g, b, a] = rgba;
  if (a >= 0.999) {
    return `#${[r, g, b].map((v) => bajt(v).toString(16).padStart(2, "0")).join("")}`;
  }
  return `rgba(${bajt(r)}, ${bajt(g)}, ${bajt(b)}, ${Number(a.toFixed(3))})`;
}
