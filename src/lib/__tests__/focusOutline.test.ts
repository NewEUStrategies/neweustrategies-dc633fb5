// Obramowanie fokusu pól formularza: PRÓG GRAFIKI PRZY KAŻDEJ REALNEJ WARTOŚCI.
//
// PO CO OSOBNY PLIK. `darkForeground.test.ts` pilnuje bloku ciemnego. To
// sprawdzenie musi objąć OBA motywy i - co ważniejsze - OBA ŹRÓDŁA wartości
// tokena: arkusz `src/styles.css` oraz nadpisania z panelu globalnych kolorów
// (`src/lib/builder/globalColors.ts`), które lecą w runtime i wygrywają
// z arkuszem. Test, który patrzy tylko na arkusz, przepuszcza defekt widoczny
// dla każdego czytelnika.
//
// CO SIĘ TU ZEPSUŁO I DLACZEGO TO NIE BYŁ PRZYPADEK. Reguła miała postać
// `outline: 2px solid color-mix(in oklab, var(--foreground) 35%, transparent)`.
// Trzydzieści pięć procent koloru tekstu brzmi jak rozsądna recesywność, ale
// wskaźnik fokusu jest OBIEKTEM GRAFICZNYM i obowiązuje go próg 3,0:1
// (WCAG 1.4.11) - a policzone wartości wychodziły tak:
//
//     jasny  #121212 (arkusz)             2,262:1
//     jasny  #374151 (globalne kolory)    1,903:1 na bieli
//     ciemny #f8f8f8 (arkusz, poprzednio) 3,095:1  <- jedyna, która ledwo przechodziła
//     ciemny #ede9e7 (arkusz, obecnie)    2,841:1
//     ciemny #d1d5db (globalne kolory)    2,529:1
//
// Czyli obramowanie fokusu nie przechodziło progu W ŻADNYM motywie przy
// wartościach, które naprawdę malują piksele. Podkręcanie alfy nie jest
// naprawą: przy `#374151` trzeba by 57%, a wtedy obramowanie przestaje być
// recesywne i zaczyna wyglądać jak obwódka błędu walidacji.
//
// PRZEZROCZYSTOŚĆ MA TU DRUGĄ WADĘ, NIEZALEŻNĄ OD LICZB. `color-mix` z
// `transparent` przepuszcza to, co leży POD obramowaniem, więc kontrast zależy
// od powierzchni, na której stoi pole - a pola stoją na karcie, na tle strony
// i na powierzchni podniesionej. Kolor solidny nie ma tego problemu i dlatego
// naprawa polega na zmianie KSZTAŁTU reguły, nie jej parametru.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const globalColors = readFileSync("src/lib/builder/globalColors.ts", "utf8");

const LIGHT = css.slice(css.indexOf(":root,"), css.indexOf(".dark {"));
const DARK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

/** Próg dla obiektu graficznego i komponentu interfejsu (WCAG 1.4.11). */
const GRAPHIC_MIN = 3;

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Wartość tokenu z podanego bloku arkusza - hex albo `oklch(L C H)`. */
function sheetToken(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`brak tokenu ${name}`);
  const raw = m[1].trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  const o = raw.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!o) throw new Error(`token ${name} w nieobsługiwanym zapisie: ${raw}`);
  return oklchToHex(Number(o[1]), Number(o[2]), Number(o[3]));
}

/** Domyślna wartość slotu panelu globalnych kolorów - ta, która leci w runtime. */
function slotDefault(key: string, which: "defaultLight" | "defaultDark"): string {
  const from = globalColors.indexOf(`key: "${key}"`);
  if (from < 0) throw new Error(`brak slotu ${key}`);
  // Cięcie do końca literału slotu: następny `key:` albo koniec pliku. Bez
  // tego wyrażenie łapałoby wartość z kolejnego slotu i test "przechodziłby"
  // mierząc nie ten kolor, o który pyta.
  const rest = globalColors.slice(from + 1);
  const next = rest.indexOf('key: "');
  const body = next > 0 ? rest.slice(0, next) : rest;
  const m = body.match(new RegExp(`${which}:\\s*"(#[0-9a-fA-F]{6})"`));
  if (!m) throw new Error(`brak ${which} w slocie ${key}`);
  return m[1].toLowerCase();
}

describe("obramowanie fokusu pól - kształt reguły", () => {
  it("jest SOLIDNE, nie przezroczystym odcieniem koloru tekstu", () => {
    const regula = css.slice(css.indexOf(":where(input, textarea, select):focus-visible"));
    const blok = regula.slice(0, regula.indexOf("}"));
    expect(blok).toContain("outline: 2px solid var(--muted-foreground)");
    // Gdyby ktoś wrócił do mieszania z przezroczystością, asercja pada
    // niezależnie od dobranej alfy - bo problemem był KSZTAŁT, nie liczba.
    expect(blok).not.toContain("color-mix");
    expect(blok).not.toContain("transparent");
  });

  it("nie jest zgaszone przez `box-shadow` ani cofnięte przez `outline: none`", () => {
    // Reguła `:focus` zeruje domyślną poświatę przeglądarki i to jest w
    // porządku, ale MUSI stać PRZED `:focus-visible`, inaczej zdejmowałaby
    // obramowanie, które ten drugi selektor właśnie postawił.
    const focus = css.indexOf(":where(input, textarea, select):focus {");
    const focusVisible = css.indexOf(":where(input, textarea, select):focus-visible");
    expect(focus).toBeGreaterThan(0);
    expect(focus).toBeLessThan(focusVisible);
  });
});

describe("obramowanie fokusu pól - próg 3,0:1 przy KAŻDEJ realnej wartości", () => {
  // Cztery kombinacje, bo token ma dwa źródła i dwa motywy. Powierzchnie to
  // wszystko, na czym realnie stoi pole formularza.
  const przypadki: Array<{ nazwa: string; kolor: string; powierzchnie: string[] }> = [
    {
      nazwa: "jasny / arkusz",
      kolor: sheetToken(LIGHT, "--muted-foreground"),
      powierzchnie: [sheetToken(LIGHT, "--background"), sheetToken(LIGHT, "--card")],
    },
    {
      nazwa: "jasny / panel globalnych kolorów",
      kolor: slotDefault("body-text-muted", "defaultLight"),
      powierzchnie: [sheetToken(LIGHT, "--background"), sheetToken(LIGHT, "--card")],
    },
    {
      nazwa: "ciemny / arkusz",
      kolor: sheetToken(DARK, "--muted-foreground"),
      powierzchnie: [
        sheetToken(DARK, "--background"),
        sheetToken(DARK, "--card"),
        sheetToken(DARK, "--secondary"),
      ],
    },
    {
      nazwa: "ciemny / panel globalnych kolorów",
      kolor: slotDefault("body-text-muted", "defaultDark"),
      powierzchnie: [
        sheetToken(DARK, "--background"),
        sheetToken(DARK, "--card"),
        sheetToken(DARK, "--secondary"),
      ],
    },
  ];

  for (const { nazwa, kolor, powierzchnie } of przypadki) {
    it(`${nazwa} przechodzi na każdej powierzchni`, () => {
      for (const p of powierzchnie) {
        const r = contrast(kolor, p);
        expect(r, `${kolor} na ${p}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(GRAPHIC_MIN);
      }
    });
  }

  it("stary wariant 35% koloru tekstu NIE przeszedłby - dowód, że to była naprawa", () => {
    // Test regresji odwrotnej: gdyby ktoś uznał, że poprzednia reguła była
    // dobra, ta asercja pokazuje liczbę, która ją dyskwalifikowała. Kompozycja
    // w sRGB, bo tak liczy przeglądarka `color-mix(... , transparent)`.
    const nad = (fg: string, bg: string, alpha: number): string => {
      const ch = (i: number): string => {
        const a = parseInt(fg.slice(1 + i * 2, 3 + i * 2), 16);
        const b = parseInt(bg.slice(1 + i * 2, 3 + i * 2), 16);
        return Math.round(a * alpha + b * (1 - alpha))
          .toString(16)
          .padStart(2, "0");
      };
      return `#${ch(0)}${ch(1)}${ch(2)}`;
    };
    const jasnyTekst = slotDefault("body-text", "defaultLight");
    const bialaKarta = sheetToken(LIGHT, "--card");
    const stary = contrast(nad(jasnyTekst, bialaKarta, 0.35), bialaKarta);
    expect(stary).toBeLessThan(GRAPHIC_MIN);
    expect(stary).toBeLessThan(2);
  });
});

/**
 * OKLCh -> sRGB hex. Macierze Björna Ottossona, przycięcie kanałów bez
 * mapowania gamutu: wszystkie tokeny czytane w tym pliku są neutralne
 * (chroma 0), więc bisekcja chromy byłaby kodem, którego nikt nie wykona.
 */
function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const lin = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  const channel = (v: number): string => {
    const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${lin.map(channel).join("")}`;
}
