// CO DOWODZI TEN PLIK
//
// Przeglądarkowy generator karty OG (`src/lib/seo/ogCardCanvas.ts`) - do
// 22.08.2026 ZERO wykonanych linii. To JEDYNE miejsce, w którym obrazek
// społecznościowy wpisu/strony powstaje i trafia do publicznego kubełka, a jego
// błędy widać wyłącznie POZA serwisem: podgląd linku na LinkedInie, Facebooku
// i w Slacku jest budowany raz i cache'owany po ich stronie. Dowodzone jest:
//
//   1. UKŁAD KARTY - płótno 1200x630, gradient tła, pasek akcentu, narożny glif
//      z PRZYWRÓCONYM kryciem, kicker, wielolinijkowy tytuł i stopka lądują na
//      wyliczonych współrzędnych, w kolorach z tokenów marki. Każdy pomiar
//      tekstu jedzie przez `ctx.font` ustawiony PRZED `measureText` - atrapa
//      rzuca, gdy font jest pusty, bo „pomiar" bez fontu mierzyłby fikcję i
//      cały auto-dobór rozmiaru tytułu byłby pozorny.
//   2. TRZY GAŁĘZIE AWARII - brak kontekstu 2D (`Error`), `toBlob` oddające
//      `null` (`Error`) oraz wybuch `document.fonts.load`: karta MUSI powstać
//      na czcionce zastępczej, bo inaczej jeden nieodpowiadający CDN fontów
//      blokuje publikację wpisu.
//   3. WEJŚCIE NIE-ŁACIŃSKIE (cyrylica, greka, chiński, emoji) w tytule,
//      kickerze i nazwie serwisu dociera do `fillText` BEZ cichego okrojenia.
//   4. UPLOAD - jeden obiekt na encję (`upsert: true`), `image/png`, ścieżka z
//      `ogCardStoragePath` dla `post` i `page`, błąd zapisu jako wyjątek z
//      komunikatem, a w URL-u cache-buster (bez niego scraper trzyma stary
//      podgląd tak długo, jak chce).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//
//   * `ogCard.test.ts` - czysty rdzeń układu (`wrapText`, `layoutOgTitle`,
//     `ogCardStoragePath`): kroki rozmiarów czcionki, klamra 4 linii, elipsa na
//     ostatniej linii, kształt ścieżki w kubełku. Rdzeń zostaje tutaj
//     PRAWDZIWY, więc mierzona jest KOMPOZYCJA (co renderer robi z wynikiem
//     układu), a nie reguły układu.
//   * `src/lib/media/__tests__/ogImagePrepare.test.ts` i `imageCrop.test.ts` -
//     dwie inne powierzchnie canvasu (przygotowanie WGRYWANEGO og:image i
//     kadrowanie). Inny moduł, inne decyzje, zero powtórzeń.
//   * `e2e/seo.spec.ts` - jego cztery testy `head contract on /`, `/en`,
//     `/blog`, `/qa` dowodzą BAJTAMI na żywym SSR, że `og:image` jest w
//     `<head>` i jest adresem absolutnym. Ten plik nie renderuje żadnej strony,
//     nie dotyka `<head>` i nie wykonuje ANI JEDNEGO żądania sieciowego:
//     wejściem jest atrapa canvasu, wyjściem `Blob` i adres z atrapy storage.
//   * polityki kubełka `media` i RLS storage - domena pgTAP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OG_CARD_COLORS,
  OG_CARD_HEIGHT,
  OG_CARD_PADDING,
  OG_CARD_WIDTH,
  type OgCardInput,
} from "@/lib/seo/ogCard";

// ---------------------------------------------------------------------------
// Atrapa storage. Stan przez `vi.hoisted()`, bo fabryka `vi.mock` jest
// wynoszona nad importy i nie widzi zmiennych z góry pliku.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  /** Kubełki, o które poprosił kod produkcyjny (kolejność wywołań). */
  kubelki: [] as string[],
  upload:
    vi.fn<
      (
        path: string,
        body: unknown,
        options: unknown,
      ) => Promise<{ error: { message: string } | null }>
    >(),
  getPublicUrl: vi.fn<(path: string) => { data: { publicUrl: string } }>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        h.kubelki.push(bucket);
        return { upload: h.upload, getPublicUrl: h.getPublicUrl };
      },
    },
  },
}));

import { generateAndUploadOgCard } from "@/lib/seo/ogCardCanvas";

// ---------------------------------------------------------------------------
// Atrapa kontekstu 2D. `happy-dom` nie implementuje `CanvasRenderingContext2D`
// (`getContext("2d")` oddaje `null`), więc bez atrapy moduł rzuca na pierwszej
// linii i żadnej reguły układu nie da się dosięgnąć. Piksele rysuje
// przeglądarka i to nie jest nasz kod; kontraktem tego modułu są WSPÓŁRZĘDNE,
// kolory i kolejność wywołań - i dokładnie to atrapa zapisuje.
// ---------------------------------------------------------------------------

/** Gradient z zapisanym obszarem i punktami koloru. */
interface GradientStub {
  readonly obszar: readonly [number, number, number, number];
  readonly punkty: Array<[number, string]>;
  addColorStop: (offset: number, color: string) => void;
}

interface RysunekTekstu {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly rozmiar: number;
  readonly kolor: string;
  /** `textBaseline` obowiązujący w chwili rysowania. */
  readonly baza: string;
}

interface RysunekProstokata {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly alpha: number;
  readonly styl: string;
}

interface RysunekLuku {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly od: number;
  readonly do_: number;
  readonly alpha: number;
  readonly styl: string;
}

/** Wszystko, co kod produkcyjny zrobił na jednym płótnie. */
interface ZapisKarty {
  szerokosc: number;
  wysokosc: number;
  readonly rodzajeKontekstu: string[];
  readonly teksty: RysunekTekstu[];
  readonly prostokaty: RysunekProstokata[];
  readonly luki: RysunekLuku[];
  readonly gradienty: GradientStub[];
  /** Teksty przekazane do `measureText` - dowód, że układ naprawdę mierzy. */
  readonly pomiary: Array<{ text: string; rozmiar: number }>;
  readonly toBlobTypy: Array<string | undefined>;
}

/** Kontekst 2D w zakresie, jakiego naprawdę dotyka renderer. */
interface KontekstStub {
  font: string;
  /** Produkcja wpisuje tu ALBO kolor, ALBO obiekt gradientu - stąd `unknown`. */
  fillStyle: unknown;
  globalAlpha: number;
  textBaseline: string;
  createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => GradientStub;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  beginPath: () => void;
  arc: (x: number, y: number, r: number, od: number, do_: number) => void;
  fill: () => void;
  measureText: (text: string) => { width: number };
  fillText: (text: string, x: number, y: number) => void;
}

interface Zachowanie {
  /** `getContext("2d")` oddaje `null` (tak zachowuje się canvas bez GPU/2D). */
  brakKontekstu: boolean;
  /** `toBlob` oddaje `null` - tak przeglądarka sygnalizuje porażkę kodowania. */
  toBlobNull: boolean;
  /** Czy `document.fonts.load` spełnia obietnicę, czy ją odrzuca. */
  fonty: "dziala" | "rzuca";
}

const zachowanie: Zachowanie = { brakKontekstu: false, toBlobNull: false, fonty: "dziala" };

/** Szerokość litery: 0.5em - ta sama konwencja co w `ogCard.test.ts`. */
const SZEROKOSC_ZNAKU_EM = 0.5;

function szerokoscTekstu(text: string, rozmiar: number): number {
  return text.length * rozmiar * SZEROKOSC_ZNAKU_EM;
}

/**
 * Rozmiar czcionki wyczytany z `ctx.font`. Brak `px` to BŁĄD TESTU, nie zero:
 * renderer musi ustawić font PRZED pomiarem, inaczej cały auto-dobór rozmiaru
 * tytułu opiera się na przypadkowym stanie kontekstu.
 */
function rozmiarFontu(font: string): number {
  const dopasowanie = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!dopasowanie) throw new Error(`test: rysowanie/pomiar bez ustawionego fontu ("${font}")`);
  return Number(dopasowanie[1]);
}

/** Nazwa stylu wypełnienia - kolor wprost albo „gradient". STRAŻNIK, nie rzut. */
function nazwaStylu(styl: unknown): string {
  if (typeof styl === "string") return styl;
  if (typeof styl === "object" && styl !== null && "punkty" in styl) return "gradient";
  return "?";
}

function utworzKontekst(zapis: ZapisKarty): KontekstStub {
  const ctx: KontekstStub = {
    font: "",
    fillStyle: "",
    globalAlpha: 1,
    textBaseline: "",
    createLinearGradient: (x0, y0, x1, y1) => {
      const gradient: GradientStub = {
        obszar: [x0, y0, x1, y1],
        punkty: [],
        addColorStop: (offset, color) => {
          gradient.punkty.push([offset, color]);
        },
      };
      zapis.gradienty.push(gradient);
      return gradient;
    },
    fillRect: (x, y, w, h) => {
      zapis.prostokaty.push({
        x,
        y,
        w,
        h,
        alpha: ctx.globalAlpha,
        styl: nazwaStylu(ctx.fillStyle),
      });
    },
    beginPath: () => {},
    arc: (x, y, r, od, do_) => {
      zapis.luki.push({
        x,
        y,
        r,
        od,
        do_,
        alpha: ctx.globalAlpha,
        styl: nazwaStylu(ctx.fillStyle),
      });
    },
    fill: () => {},
    measureText: (text) => {
      const rozmiar = rozmiarFontu(ctx.font);
      zapis.pomiary.push({ text, rozmiar });
      return { width: szerokoscTekstu(text, rozmiar) };
    },
    fillText: (text, x, y) => {
      zapis.teksty.push({
        text,
        x,
        y,
        font: ctx.font,
        rozmiar: rozmiarFontu(ctx.font),
        kolor: nazwaStylu(ctx.fillStyle),
        baza: ctx.textBaseline,
      });
    },
  };
  return ctx;
}

/** Specyfikacje fontów, o które poprosił `ensureFontsLoaded`. */
let zadaneFonty: string[] = [];
let karty: ZapisKarty[] = [];

const realCreateElement = document.createElement.bind(document);

function ostatniaKarta(): ZapisKarty {
  const karta = karty.at(-1);
  if (!karta) throw new Error("test: kod produkcyjny nie utworzył płótna");
  return karta;
}

const WEJSCIE: OgCardInput = {
  title: "Krótki tytuł karty",
  kicker: null,
  siteName: "New European Strategies",
};

/** Skrót: wygenerowanie karty wpisu z podmienionym wejściem. */
function generuj(nadpisania: Partial<OgCardInput> = {}): Promise<string> {
  return generateAndUploadOgCard("post", "p-1", { ...WEJSCIE, ...nadpisania });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(zachowanie, { brakKontekstu: false, toBlobNull: false, fonty: "dziala" });
  karty = [];
  zadaneFonty = [];
  h.kubelki.length = 0;
  h.upload.mockResolvedValue({ error: null });
  h.getPublicUrl.mockReturnValue({
    data: { publicUrl: "https://cdn.test/storage/media/og-cards/post-p-1.png" },
  });

  // Cache-buster czyta `Date.now()` - bez ustalonego czasu asercja na sufiksie
  // `?v=` byłaby niedeterministyczna.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-03T10:15:00Z"));

  // `happy-dom` nie ma `FontFaceSet` (`"fonts" in document === false`), więc
  // atrapę trzeba podstawić - inaczej KAŻDY przebieg wpadałby w `catch`
  // i gałąź „fonty się wczytały" nigdy by się nie wykonała.
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      load: (spec: string) => {
        zadaneFonty.push(spec);
        return zachowanie.fonty === "rzuca"
          ? Promise.reject(new Error("CDN fontów nie odpowiada"))
          : Promise.resolve([]);
      },
    },
  });

  vi.spyOn(document, "createElement").mockImplementation((tag) => {
    const element = realCreateElement(tag);
    // STRAŻNIK, nie rzutowanie: dopiero `instanceof` daje typowane
    // `width`/`height`, a jednocześnie pilnuje, że renderer prosi o canvas.
    if (!(element instanceof HTMLCanvasElement)) return element;
    const zapis: ZapisKarty = {
      szerokosc: -1,
      wysokosc: -1,
      rodzajeKontekstu: [],
      teksty: [],
      prostokaty: [],
      luki: [],
      gradienty: [],
      pomiary: [],
      toBlobTypy: [],
    };
    karty.push(zapis);
    Object.defineProperty(element, "getContext", {
      configurable: true,
      value: (kind: string) => {
        zapis.rodzajeKontekstu.push(kind);
        // Wymiary czytane W CHWILI pobrania kontekstu: renderer ustawia je
        // przed nim, więc to jedyne miejsce dowodzące kolejności.
        zapis.szerokosc = element.width;
        zapis.wysokosc = element.height;
        return zachowanie.brakKontekstu ? null : utworzKontekst(zapis);
      },
    });
    Object.defineProperty(element, "toBlob", {
      configurable: true,
      value: (callback: (blob: Blob | null) => void, type?: string) => {
        zapis.toBlobTypy.push(type);
        callback(zachowanie.toBlobNull ? null : new Blob([new Uint8Array(8)], { type }));
      },
    });
    return element;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fonts");
});

describe("generateAndUploadOgCard - płótno i tło marki", () => {
  it("rysuje płótno 1200x630 z gradientem tła i paskiem akcentu", async () => {
    await generuj();
    const karta = ostatniaKarta();

    expect(karta.rodzajeKontekstu).toEqual(["2d"]);
    expect([karta.szerokosc, karta.wysokosc]).toEqual([OG_CARD_WIDTH, OG_CARD_HEIGHT]);
    // Gradient przez CAŁĄ przekątną karty - inaczej „głębia" kończy się w
    // losowym miejscu kadru.
    expect(karta.gradienty).toHaveLength(1);
    expect(karta.gradienty[0]?.obszar).toEqual([0, 0, OG_CARD_WIDTH, OG_CARD_HEIGHT]);
    expect(karta.gradienty[0]?.punkty).toEqual([
      [0, OG_CARD_COLORS.background],
      [1, "#1a1a1a"],
    ]);
    // Tło pełnym gradientem, potem 14px paska akcentu na lewej krawędzi.
    expect(karta.prostokaty).toEqual([
      { x: 0, y: 0, w: OG_CARD_WIDTH, h: OG_CARD_HEIGHT, alpha: 1, styl: "gradient" },
      { x: 0, y: 0, w: 14, h: OG_CARD_HEIGHT, alpha: 1, styl: OG_CARD_COLORS.accent },
    ]);
  });

  it("narożny glif rysuje na 8% krycia i PRZYWRACA pełne krycie stopce", async () => {
    await generuj();
    const karta = ostatniaKarta();

    // Glif: pełne koło w prawym górnym narożniku, ledwo widoczne.
    expect(karta.luki[0]).toEqual({
      x: OG_CARD_WIDTH - 60,
      y: 40,
      r: 220,
      od: 0,
      do_: Math.PI * 2,
      alpha: 0.08,
      styl: OG_CARD_COLORS.accent,
    });
    // Kropka stopki MUSI być na krycie 1 - brak przywrócenia `globalAlpha`
    // dałby ledwo widoczną stopkę na każdej karcie serwisu.
    expect(karta.luki[1]?.alpha).toBe(1);
    expect(karta.teksty.every((t) => t.text.length > 0)).toBe(true);
  });
});

describe("generateAndUploadOgCard - tytuł", () => {
  it("krótki tytuł zostaje w jednej linii na największym rozmiarze", async () => {
    await generuj({ title: "Krótki tytuł karty" });
    const karta = ostatniaKarta();

    // Bez kickera: y = padding + 40 + fontSize = 80 + 40 + 72.
    expect(karta.teksty[0]).toEqual({
      text: "Krótki tytuł karty",
      x: OG_CARD_PADDING,
      y: OG_CARD_PADDING + 40 + 72,
      font: '700 72px "Red Hat Display", "Segoe UI", Arial, sans-serif',
      rozmiar: 72,
      kolor: OG_CARD_COLORS.title,
      baza: "",
    });
    // Pomiar naprawdę się odbył i to na foncie tytułu.
    expect(karta.pomiary.length).toBeGreaterThan(0);
    expect(karta.pomiary.every((p) => p.rozmiar === 72)).toBe(true);
  });

  it("bardzo długi tytuł zawija się na wiele linii i schodzi z rozmiarem", async () => {
    const tytul =
      "Nowa strategia przemysłowa Unii Europejskiej wobec konkurencji z Chin i " +
      "Stanów Zjednoczonych w perspektywie roku 2030";
    await generuj({ title: tytul });
    const karta = ostatniaKarta();

    const linie = karta.teksty.slice(0, 4);
    expect(linie.map((l) => l.text)).toEqual([
      "Nowa strategia przemysłowa Unii",
      "Europejskiej wobec konkurencji z",
      "Chin i Stanów Zjednoczonych w",
      "perspektywie roku 2030",
    ]);
    // Rozmiar ZSZEDŁ z 72 na 64, bo na 72 tekst nie mieścił się w 4 liniach.
    expect(linie.every((l) => l.rozmiar === 64)).toBe(true);
    // lineHeight = round(64 * 1.16) = 74; pierwsza linia na 120 + 64.
    expect(linie.map((l) => l.y)).toEqual([184, 258, 332, 406]);
    // Stopka zostaje NIŻEJ niż ostatnia linia tytułu - tytuł jej nie nadpisuje.
    expect(linie[3]?.y).toBeLessThan(OG_CARD_HEIGHT - OG_CARD_PADDING + 10);
    // ŻADNA linia nie rozrywa słowa: sklejenie linii odtwarza tytuł znak w znak.
    expect(linie.map((l) => l.text).join(" ")).toBe(tytul);
    // I każda mieści się w budżecie 1040px (1200 - 2 * 80).
    for (const linia of linie) {
      expect(szerokoscTekstu(linia.text, linia.rozmiar)).toBeLessThanOrEqual(
        OG_CARD_WIDTH - OG_CARD_PADDING * 2,
      );
    }
  });

  it("słowo dłuższe niż cała linia jest OBCINANE elipsą (zamierzone)", async () => {
    // ZAMIERZONY stan rdzenia (`wrapText`: „words longer than the budget are
    // hard-truncated with an ellipsis rather than overflowing the canvas",
    // przypięty w `ogCard.test.ts`): renderer NIE schodzi dla takiego słowa z
    // rozmiarem, bo jedna linia mieści się w klamrze 4 linii. Konsekwencja dla
    // użytkownika: bardzo długi jednowyrazowy tytuł (albo wklejony URL) traci
    // ogon na karcie, choć w rozmiarze 42px zmieściłby się w całości. Pinujemy
    // to tutaj, żeby zmiana rdzenia była widoczna także po stronie renderera.
    const slowo = "Superkalifradylistyczneksesipralidokcje";
    await generuj({ title: slowo });
    const karta = ostatniaKarta();

    const linia = karta.teksty[0];
    expect(linia?.rozmiar).toBe(72);
    expect(linia?.text.endsWith("…")).toBe(true);
    expect(slowo.startsWith(linia?.text.slice(0, -1) ?? "")).toBe(true);
    expect(linia?.text.length).toBeLessThan(slowo.length);
  });
});

describe("generateAndUploadOgCard - kicker", () => {
  it("kicker rysuje WERSALIKAMI w kolorze akcentu i przesuwa tytuł o 56px", async () => {
    await generuj({ kicker: "Analizy polityki" });
    const zKickerem = ostatniaKarta();

    expect(zKickerem.teksty[0]).toEqual({
      text: "ANALIZY POLITYKI",
      x: OG_CARD_PADDING,
      y: OG_CARD_PADDING + 40,
      font: '600 26px "Red Hat Display", "Segoe UI", Arial, sans-serif',
      rozmiar: 26,
      kolor: OG_CARD_COLORS.kicker,
      baza: "alphabetic",
    });

    await generuj({ kicker: null });
    const bezKickera = ostatniaKarta();
    const yTytuluZ = zKickerem.teksty[1]?.y ?? 0;
    const yTytuluBez = bezKickera.teksty[0]?.y ?? 0;
    expect(yTytuluZ - yTytuluBez).toBe(56);
  });

  it.each([
    ["pusty napis", ""],
    ["same spacje", "   "],
    ["null", null],
    ["brak pola", undefined],
  ])("kicker (%s) jest POMIJANY, a tytuł nie przesuwa się w dół", async (_opis, kicker) => {
    await generuj({ kicker });
    const karta = ostatniaKarta();

    // Dwa teksty na karcie: tytuł i nazwa serwisu w stopce. Żadnego kickera.
    expect(karta.teksty.map((t) => t.text)).toEqual([
      "Krótki tytuł karty",
      "New European Strategies",
    ]);
    expect(karta.teksty[0]?.y).toBe(OG_CARD_PADDING + 40 + 72);
  });

  it.fails("DEFEKT: długi kicker wyjeżdża za prawą krawędź karty", async () => {
    // Kicker to nazwa sekcji/kategorii pochodząca z TREŚCI, więc jej długość
    // ustala redakcja, a nie kod. Renderer rysuje go jednak BEZ pomiaru i bez
    // skrótu - w przeciwieństwie do tytułu, który przechodzi przez `wrapText`
    // („rather than overflowing the canvas"). KONSEKWENCJA DLA UŻYTKOWNIKA:
    // każda karta takiej kategorii ma kicker ucięty krawędzią kadru w połowie
    // wyrazu na wszystkich portalach społecznościowych - i nie widać tego w
    // panelu, bo podgląd pokazuje tekst, nie kadr.
    await generuj({
      kicker:
        "Analizy polityki przemysłowej i konkurencyjności gospodarki Unii Europejskiej w perspektywie 2030",
    });
    const kicker = ostatniaKarta().teksty[0];
    const prawaKrawedzTekstu = (kicker?.x ?? 0) + szerokoscTekstu(kicker?.text ?? "", 26);
    expect(prawaKrawedzTekstu).toBeLessThanOrEqual(OG_CARD_WIDTH - OG_CARD_PADDING);
  });

  it("stan faktyczny: długi kicker idzie na płótno w całości, bez skrótu", async () => {
    // ZIELONY zapis stanu faktycznego: po naprawie powyższego defektu ten test
    // padnie razem z odblokowaniem `it.fails` - i to jest jego cel.
    const dlugi =
      "Analizy polityki przemysłowej i konkurencyjności gospodarki Unii Europejskiej w perspektywie 2030";
    await generuj({ kicker: dlugi });
    const kicker = ostatniaKarta().teksty[0];

    expect(kicker?.text).toBe(dlugi.toUpperCase());
    expect(kicker?.text.endsWith("…")).toBe(false);
    // Kicker NIE jest mierzony: `measureText` widzi wyłącznie tekst tytułu.
    expect(ostatniaKarta().pomiary.some((p) => p.text.includes("ANALIZY"))).toBe(false);
    expect((kicker?.x ?? 0) + szerokoscTekstu(kicker?.text ?? "", 26)).toBeGreaterThan(
      OG_CARD_WIDTH,
    );
  });
});

describe("generateAndUploadOgCard - stopka", () => {
  it("rysuje kropkę akcentu i nazwę serwisu przypięte do dolnej krawędzi", async () => {
    await generuj();
    const karta = ostatniaKarta();
    const stopkaY = OG_CARD_HEIGHT - OG_CARD_PADDING + 10;

    expect(karta.luki[1]).toEqual({
      x: OG_CARD_PADDING + 10,
      y: stopkaY - 9,
      r: 10,
      od: 0,
      do_: Math.PI * 2,
      alpha: 1,
      styl: OG_CARD_COLORS.accent,
    });
    // Nazwa serwisu jest NA KARCIE - bez niej obrazek jest anonimowy.
    expect(karta.teksty.at(-1)).toEqual({
      text: "New European Strategies",
      x: OG_CARD_PADDING + 34,
      y: stopkaY,
      font: '600 28px "Red Hat Display", "Segoe UI", Arial, sans-serif',
      rozmiar: 28,
      kolor: OG_CARD_COLORS.footer,
      baza: "",
    });
  });
});

describe("generateAndUploadOgCard - gałęzie awarii", () => {
  it("brak kontekstu 2D rzuca i NIE wysyła niczego do storage", async () => {
    zachowanie.brakKontekstu = true;
    await expect(generuj()).rejects.toThrow("Canvas 2D context unavailable");
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.getPublicUrl).not.toHaveBeenCalled();
  });

  it("`toBlob` bez bloba odrzuca obietnicę i NIE wysyła niczego do storage", async () => {
    zachowanie.toBlobNull = true;
    await expect(generuj()).rejects.toThrow("Canvas PNG export failed");
    expect(ostatniaKarta().toBlobTypy).toEqual(["image/png"]);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("prosi o OBA kroje pisma przed rysowaniem", async () => {
    await generuj();
    expect(zadaneFonty).toEqual(['700 72px "Red Hat Display"', '600 28px "Red Hat Display"']);
  });

  it("wybuch `document.fonts.load` NIE blokuje karty - rysuje na zastępczym", async () => {
    zachowanie.fonty = "rzuca";
    const url = await generuj();

    expect(url).toContain("og-cards/post-p-1.png");
    expect(h.upload).toHaveBeenCalledTimes(1);
    const blob = h.upload.mock.calls[0]?.[1];
    expect(blob).toBeInstanceOf(Blob);
    // Karta powstała w całości: tytuł i stopka są na płótnie.
    expect(ostatniaKarta().teksty).toHaveLength(2);
  });

  it("brak `document.fonts` w środowisku też kończy się kartą", async () => {
    // Stan wyjściowy `happy-dom` (i starszych przeglądarek): BRAK `FontFaceSet`,
    // więc sięgnięcie po `document.fonts.load` rzuca TypeError - i on MUSI
    // wpaść w ten sam `catch`, inaczej karty nie da się wygenerować w ogóle.
    Reflect.deleteProperty(document, "fonts");

    await expect(generuj()).resolves.toContain("og-cards/post-p-1.png");
    expect(zadaneFonty).toEqual([]);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });
});

describe("generateAndUploadOgCard - znaki spoza łaciny", () => {
  it("cyrylica, greka, chiński i emoji trafiają na płótno BEZ modyfikacji", async () => {
    // Karta wpisu po ukraińsku albo z chińską nazwą programu nie może wyjść
    // pusta ani okrojona - to jedyny obrazek, jaki zobaczy czytelnik z linku.
    const tytul = "Привет 世界 🚀 Ελλάδα";
    await generuj({ title: tytul, kicker: "новини 新聞", siteName: "Νέα Στρατηγική 🇪🇺" });
    const karta = ostatniaKarta();

    expect(karta.teksty.map((t) => t.text)).toEqual(["НОВИНИ 新聞", tytul, "Νέα Στρατηγική 🇪🇺"]);
    // Tytuł zmieścił się w jednej linii - żadnej elipsy, żadnego obcięcia.
    expect(karta.teksty[1]?.text).not.toContain("…");
  });
});

describe("generateAndUploadOgCard - upload", () => {
  it("wysyła PNG pod ścieżkę encji z `upsert` i oddaje URL z cache-busterem", async () => {
    const url = await generuj();

    expect(h.kubelki).toEqual(["media", "media"]);
    expect(h.upload).toHaveBeenCalledTimes(1);
    const [sciezka, blob, opcje] = h.upload.mock.calls[0] ?? [];
    expect(sciezka).toBe("og-cards/post-p-1.png");
    expect(blob).toBeInstanceOf(Blob);
    // `upsert: true` to reguła „jeden obiekt na encję" - bez niej regeneracja
    // zaśmieca publiczny kubełek kopiami przy każdym zapisie wpisu.
    expect(opcje).toEqual({ contentType: "image/png", upsert: true });
    expect(h.getPublicUrl).toHaveBeenCalledWith("og-cards/post-p-1.png");
    // 2026-02-03T10:15:00Z = 1770113700000 -> base36.
    expect(url).toBe("https://cdn.test/storage/media/og-cards/post-p-1.png?v=ml6fzs80");
  });

  it("ścieżka STRONY jest inna niż ścieżka WPISU", async () => {
    h.getPublicUrl.mockReturnValue({
      data: { publicUrl: "https://cdn.test/storage/media/og-cards/page-s-9.png" },
    });
    const url = await generateAndUploadOgCard("page", "s-9", WEJSCIE);

    expect(h.upload.mock.calls[0]?.[0]).toBe("og-cards/page-s-9.png");
    expect(url).toBe("https://cdn.test/storage/media/og-cards/page-s-9.png?v=ml6fzs80");
  });

  it("błąd zapisu do storage rzuca KOMUNIKATEM storage i nie buduje URL-a", async () => {
    h.upload.mockResolvedValue({ error: { message: "new row violates row-level security" } });

    await expect(generuj()).rejects.toThrow("new row violates row-level security");
    expect(h.getPublicUrl).not.toHaveBeenCalled();
  });
});
