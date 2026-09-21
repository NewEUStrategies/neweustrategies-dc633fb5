// Tekst na ciemnym: BRAMKA HALACJI I JEDNEJ BIELI.
//
// PO CO TEN PLIK ISTNIEJE. Kontrast jest jedynym parametrem czytelności,
// który da się policzyć - i dlatego jest jedynym, o którym ktoś kiedyś powie
// "im więcej, tym lepiej". Na ciemnym tle to nieprawda: biel przy pełnym
// kontraście HALACJE, czyli jasne glify rozlewają się na ciemne tło, cienkie
// kreski liter grubieją optycznie, a długi tekst zaczyna migotać. Token
// `--foreground` w bloku `.dark` miał wartość `oklch(0.98 0 0)`, czyli
// praktycznie biel (#f8f8f8) i 18,05:1 na płycie. Ta bramka pilnuje obu
// końców: żeby tekst nie wrócił do bieli ORAZ żeby nie zszedł tak nisko, że
// przestanie przechodzić próg WCAG.
//
// DRUGA RZECZ, KTÓREJ PILNUJE: JEDNEJ BIELI. Silnik wykresów używał `#ede9e7`
// jako `--chart-tip-ink` i `--chart-zone`, a interfejs `#f8f8f8` - aplikacja
// miała w trybie ciemnym dwa różne "prawie białe", z których żadne nie było
// błędem, i nikt tego nie widział, bo nigdy nie stały obok siebie w jednym
// elemencie. Po scaleniu ta asercja nie pozwala im się znów rozjechać.
//
// LICZBY LICZONE, NIE PRZEPISANE. Bramka nie zna żadnej wartości kontrastu
// z góry: wyciąga tokeny z arkusza i liczy je wzorem WCAG 2.x, tak samo jak
// `brandContrast.test.ts` i bramka palety wykresów.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");

/**
 * Blok `.dark` wycięty do `@layer base` - tak samo, jak cięją go bramka
 * palety i test kontrastu tarczy. Trzy miejsca muszą ciąć IDENTYCZNIE,
 * inaczej patrzą na różne napisy i "zgadzają się" przez przypadek.
 */
const DARK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

function token(name: string): string {
  const m = DARK.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`brak tokenu ${name} w bloku .dark`);
  return m[1].trim().toLowerCase();
}

function hexToken(name: string): string {
  const raw = token(name);
  if (!/^#[0-9a-f]{6}$/.test(raw))
    throw new Error(`token ${name} nie jest 6-cyfrowym hexem: ${raw}`);
  return raw;
}

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

/** Próg tekstu normalnego (WCAG 1.4.3). */
const TEXT_MIN = 4.5;

/**
 * SUFIT PRZECIW HALACJI. Nie jest to próg z WCAG - WCAG nie zna górnej
 * granicy - tylko decyzja projektowa: powyżej ~17:1 na ciemnym tle biel
 * zaczyna się rozlewać. 16,5 daje zapas nad zmierzonymi 15,89:1 na płycie
 * i jednocześnie oblewa się natychmiast, gdy ktoś wróci do bieli (18,05:1).
 */
const HALATION_MAX = 16.5;

describe("tryb ciemny - tekst nie jest bielą, ale przechodzi próg", () => {
  it("tekst główny NIE jest bielą - halacja jest defektem, nie zaletą", () => {
    const fg = hexToken("--foreground");
    const plyta = hexToken("--card");
    const tlo = hexToken("--background");
    // Poniżej sufitu: znaki zostają ostre.
    expect(
      contrast(fg, plyta),
      `tekst na płycie: ${contrast(fg, plyta).toFixed(2)}:1`,
    ).toBeLessThan(HALATION_MAX);
    expect(contrast(fg, tlo), `tekst na tle: ${contrast(fg, tlo).toFixed(2)}:1`).toBeLessThan(
      HALATION_MAX,
    );
    // I znacznie powyżej progu: czytelność nie jest ceną za ostrość.
    expect(contrast(fg, plyta)).toBeGreaterThan(3 * TEXT_MIN);
  });

  it("KAŻDA para tekst/powierzchnia w bloku ciemnym przechodzi 4,5:1", () => {
    // Pary są wypisane, a nie zgadywane z nazw: token o nazwie `*-foreground`
    // nie zawsze stoi na powierzchni o nazwie bez sufiksu (`--primary` jest
    // POWIERZCHNIĄ, a jego tekstem jest `--primary-foreground`), więc
    // automatyczne parowanie po nazwie dałoby fałszywe wyniki w obie strony.
    const pary: Array<[string, string]> = [
      ["--foreground", "--background"],
      ["--foreground", "--card"],
      ["--card-foreground", "--card"],
      ["--popover-foreground", "--popover"],
      ["--secondary-foreground", "--secondary"],
      ["--accent-foreground", "--accent"],
      // Odwrócona rola: tu tekstem jest `*-foreground`, a POWIERZCHNIĄ
      // `--primary`, który celowo został przy jaśniejszej wartości.
      ["--primary-foreground", "--primary"],
    ];
    for (const [tekstToken, tloToken] of pary) {
      const tekst = value(tekstToken);
      const tlo = value(tloToken);
      const r = contrast(tekst, tlo);
      expect(r, `${tekstToken} na ${tloToken}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it("interfejs i wykres mają JEDNĄ biel - inaczej rozjadą się bez ostrzeżenia", () => {
    // Silnik wykresów używa tej wartości jako atramentu tooltipa i koloru
    // strefy prognozy. Dopóki obie są tym samym napisem, nie da się zmienić
    // jednej i zapomnieć o drugiej.
    expect(hexToken("--foreground")).toBe(hexToken("--chart-tip-ink"));
    expect(hexToken("--foreground")).toBe(hexToken("--chart-zone"));
  });

  it("role TEKSTOWE zeszły z bieli, a POWIERZCHNIOWE i FOKUS zostały", () => {
    // Halacja dotyczy glifów, nie prostokątów: `--primary` jest tłem
    // przycisku, a `--ring` wskaźnikiem fokusu, który ma być maksymalnie
    // widoczny. Gdyby ktoś "ujednolicił" je razem z tekstem, przycisk
    // primary i obramowanie fokusu straciłyby część kontrastu bez żadnego
    // zysku czytelności.
    const fg = hexToken("--foreground");
    for (const rola of ["--primary", "--ring"]) {
      expect(token(rola), `${rola} ma zostać jaśniejszy od tekstu`).not.toBe(fg);
    }
  });

  it("ARKUSZ I PANEL GLOBALNYCH KOLORÓW mówią to samo o tekście", () => {
    // NAJWAŻNIEJSZA ASERCJA W TYM PLIKU, i najpóźniej odkryta.
    //
    // Slot `body-text` w `src/lib/builder/globalColors.ts` ma
    // `overrides: ["--foreground"]`, a `globalColorsToCss` emituje jego
    // `defaultDark` BEZWARUNKOWO - także wtedy, gdy tenant nigdy nic tu nie
    // ustawił. Reguła leci z `DesignTokensStyle` (montowany w `__root.tsx`)
    // PO arkuszu i w tej samej specyficzności (`.dark`), więc WYGRYWA.
    //
    // Znaczy to, że wartość w arkuszu jest wyłącznie fallbackiem przed
    // hydracją, a to, co czytelnik naprawdę widzi, pochodzi z pliku TypeScript.
    // Przez długi czas oba źródła mówiły co innego: arkusz `#f8f8f8` (18,05:1),
    // panel `#d1d5db` (13,01:1) - i żadna bramka tego nie widziała, bo każda
    // patrzyła tylko na swoje źródło. Ta asercja jest jedynym miejscem, w którym
    // te dwa światy się spotykają.
    const globalColors = readFileSync("src/lib/builder/globalColors.ts", "utf8");
    const slot = globalColors.slice(globalColors.indexOf('key: "body-text"'));
    const koniec = slot.indexOf('key: "body-text-muted"');
    const bodyText = koniec > 0 ? slot.slice(0, koniec) : slot;
    const dark = bodyText.match(/defaultDark:\s*"(#[0-9a-fA-F]{6})"/);
    expect(dark, "brak defaultDark w slocie body-text").not.toBeNull();
    expect(dark?.[1].toLowerCase()).toBe(hexToken("--foreground"));
  });

  it("OBRAMOWANIE FOKUSU PÓL jest solidne i przechodzi próg grafiki", () => {
    // Było `color-mix(in oklab, var(--foreground) 35%, transparent)` i nie
    // przechodziło 3,0:1 (WCAG 1.4.11) przy ŻADNEJ realnej wartości tokena:
    // 2,262:1 (jasny arkusz), 1,903:1 (jasny panel), 3,095:1 (ciemny arkusz
    // stary - jedyna, która ledwo przechodziła), 2,841:1 (ciemny arkusz nowy),
    // 2,529:1 (ciemny panel). Przezroczystość ma przy tym wadę niezależną od
    // liczb: przepuszcza to, co jest POD obramowaniem, więc kontrast zależy od
    // powierzchni, na której stoi pole.
    //
    // Test pilnuje KSZTAŁTU reguły, nie liczby: gdyby ktoś wrócił do
    // `color-mix` z `transparent`, asercja pada niezależnie od dobranej alfy.
    const regula = css.slice(css.indexOf(":where(input, textarea, select):focus-visible"));
    const blok = regula.slice(0, regula.indexOf("}"));
    expect(blok).toContain("outline: 2px solid var(--muted-foreground)");
    expect(blok).not.toContain("transparent");

    // I liczba: tekst drugorzędny przechodzi próg grafiki na każdej ciemnej
    // powierzchni. Wartość jasną i nadpisania z panelu sprawdza
    // `focusOutline.test.ts` - tu jesteśmy w bloku ciemnym.
    const drugi = value("--muted-foreground");
    for (const powierzchnia of ["--card", "--background", "--secondary"]) {
      const r = contrast(drugi, hexToken(powierzchnia));
      expect(r, `${powierzchnia}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("tekst DRUGI zostaje recesywny, ale nadal czytelny", () => {
    // `--muted-foreground` niesie podpisy i etykiety osi. Ma być wyraźnie
    // słabszy od tekstu głównego (inaczej hierarchia znika), a i tak
    // przechodzić próg tekstowy.
    const drugi = value("--muted-foreground");
    const glowny = hexToken("--foreground");
    const plyta = hexToken("--card");
    expect(contrast(drugi, plyta)).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrast(drugi, plyta)).toBeLessThan(contrast(glowny, plyta));
  });
});

/**
 * Wartość tokenu jako hex - także wtedy, gdy arkusz zapisuje ją w `oklch()`.
 *
 * Konwersja jest tu potrzebna, bo blok ciemny mieszka w dwóch notacjach:
 * powierzchnie i tekst są hexami, a część ról (`--primary`, `--ring`,
 * `--muted-foreground`) została w `oklch()`. Bramka ma liczyć kontrast
 * WSZYSTKICH par, więc musi rozumieć oba zapisy - inaczej pary z `oklch()`
 * po cichu wypadałyby ze sprawdzenia.
 *
 * Obsługujemy wyłącznie `oklch(L C H)` bez alfy: to jedyna forma, w jakiej
 * arkusz zapisuje kolory nieprzezroczyste, a token z alfą nie jest kolorem
 * tekstu ani powierzchni (jest nakładką) i do tych par nie wchodzi.
 */
function value(name: string): string {
  const raw = token(name);
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  const m = raw.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`token ${name} w nieobsługiwanym zapisie: ${raw}`);
  return oklchToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * OKLCh -> sRGB hex. Macierze Björna Ottossona, przycięcie kanałów do zakresu
 * BEZ mapowania gamutu: tokeny neutralne (chroma 0 albo bliska zeru) są w
 * gamucie z definicji, więc bisekcja chromy byłaby tu kodem, którego nikt
 * nigdy nie wykona. Moduł palety wykresów ma pełne mapowanie i to on jest
 * miejscem na kolory nasycone.
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
    const byte = Math.round(Math.min(1, Math.max(0, srgb)) * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${lin.map(channel).join("")}`;
}
