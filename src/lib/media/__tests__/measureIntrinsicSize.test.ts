// Pomiar naturalnego rozmiaru pliku w przeglądarce redaktora
// (src/lib/media/measureIntrinsicSize.ts).
//
// CO TU MA DOWÓD
//  1. Obietnica NIGDY nie jest odrzucana i ZAWSZE się rozstrzyga: błąd pobrania,
//     brak odpowiedzi (limit 5 s) i wyjątek konstruktora dają `""`. Od tego
//     zależy "Zapisz" w Opcjach motywu - czeka na pomiar, więc pomiar bez
//     rozstrzygnięcia zawiesiłby zapis.
//  2. Wynik przechodzi przez wspólną walidację: plik bez własnego rozmiaru
//     (0 × 0) to `""`, a nie `"0x0"`.
//  3. Mierzony jest plik pod adresem, którym panel pokazuje podglądy: kanoniczny
//     `/media/...` jako ścieżka względna (działa na hoście podglądu), adres
//     zewnętrzny bez zmian.
//  4. SVG BEZ WŁASNEJ PROPORCJI NIE DOSTAJE ROZMIARU. Chrome zgłasza dla takiego
//     pliku rozmiar zastępczy (300 × 150 albo jeden prawdziwy bok i drugi
//     zastępczy), a atrybuty z tej pary zostałyby na stałe - plik nie ma
//     proporcji, która wygrałaby po pobraniu - i zmieniłyby kształt obrazu.
//     Pomiar czyta więc plik SVG i oddaje rozmiar tylko wtedy, gdy plik sam
//     deklaruje proporcję. Odczyt nie odrzuca obietnicy, ma ten sam limit 5 s,
//     a adres innego pliku nie dostaje żadnego dodatkowego żądania.
//
// `fetch` jest atrapą: domyślnie oddaje SVG z `viewBox` (plik z proporcją), więc
// przypadki ogólne na adresach `.svg` mierzą się jak dotąd.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSvgSource,
  measureIntrinsicSize,
  svgDeclaresRatio,
} from "@/lib/media/measureIntrinsicSize";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";

/** Atrapa `Image`: zapamiętuje instancje, zdarzenia odpala test. */
class ProbeStub {
  static instances: ProbeStub[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";

  constructor() {
    ProbeStub.instances.push(this);
  }

  load(width: number, height: number): void {
    this.naturalWidth = width;
    this.naturalHeight = height;
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }
}

const lastProbe = () => ProbeStub.instances[ProbeStub.instances.length - 1];

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const SHAPE = '<rect width="10" height="10"/>';
/** Plik SVG z podanymi atrybutami elementu głównego. */
const svgFile = (attributes = "") => `<svg ${NS} ${attributes}>${SHAPE}</svg>`;
/** Plik z proporcją - domyślna odpowiedź atrapy `fetch`. */
const SVG_WITH_RATIO = svgFile('viewBox="0 0 350 150"');

interface FetchCall {
  url: string;
  signal: AbortSignal | undefined;
}
interface FetchReply {
  ok: boolean;
  text: () => Promise<string>;
}

/** Atrapa `fetch`: zapisuje żądania, odpowiedź ustawia test. */
const svgFetch = {
  calls: [] as FetchCall[],
  respond: (): Promise<FetchReply> => Promise.reject(new Error("brak odpowiedzi")),
};

/** Odpowiedź 200 z podaną treścią pliku. */
const serveSvg = (markup: string) => {
  svgFetch.respond = () => Promise.resolve({ ok: true, text: () => Promise.resolve(markup) });
};

beforeEach(() => {
  ProbeStub.instances = [];
  vi.stubGlobal("Image", ProbeStub);
  svgFetch.calls = [];
  serveSvg(SVG_WITH_RATIO);
  vi.stubGlobal("fetch", (url: string, init?: { signal?: AbortSignal }) => {
    svgFetch.calls.push({ url, signal: init?.signal });
    return svgFetch.respond();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("measureIntrinsicSize", () => {
  it('załadowany plik 350 × 150 -> "350x150"', async () => {
    const pending = measureIntrinsicSize("https://cdn.example.com/logo.svg");
    lastProbe().load(350, 150);

    await expect(pending).resolves.toBe("350x150");
  });

  it('plik bez własnego rozmiaru (0 × 0) -> ""', async () => {
    const pending = measureIntrinsicSize("https://cdn.example.com/bez-rozmiaru.svg");
    lastProbe().load(0, 0);

    await expect(pending).resolves.toBe("");
  });

  it('błąd pobrania -> "" (bez odrzucenia obietnicy)', async () => {
    const pending = measureIntrinsicSize("https://cdn.example.com/404.png");
    lastProbe().fail();

    await expect(pending).resolves.toBe("");
  });

  it('brak zdarzenia przez 5000 ms -> "", ani chwili wcześniej', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    void measureIntrinsicSize("https://cdn.example.com/wisi.png").then(settled);

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith("");
  });

  it("po rozstrzygnięciu zdejmuje uchwyty i zegar - spóźnione zdarzenie niczego nie zmienia", async () => {
    vi.useFakeTimers();
    const pending = measureIntrinsicSize("https://cdn.example.com/logo.svg");
    const probe = lastProbe();
    probe.load(350, 150);

    await expect(pending).resolves.toBe("350x150");
    expect(probe.onload).toBeNull();
    expect(probe.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pusty adres -> "" bez tworzenia obiektu Image', async () => {
    await expect(measureIntrinsicSize("")).resolves.toBe("");
    expect(ProbeStub.instances).toHaveLength(0);
  });

  it('środowisko bez `Image` -> ""', async () => {
    vi.stubGlobal("Image", undefined);

    await expect(measureIntrinsicSize("https://cdn.example.com/logo.svg")).resolves.toBe("");
  });

  it('wyjątek konstruktora `Image` -> "" (obietnica się rozstrzyga)', async () => {
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          throw new Error("brak pamięci");
        }
      },
    );

    await expect(measureIntrinsicSize("https://cdn.example.com/logo.svg")).resolves.toBe("");
  });

  it("kanoniczny adres `/media/...` jest ładowany jako ścieżka względna", () => {
    void measureIntrinsicSize(`${PUBLIC_MEDIA_ORIGIN}/media/theme/logo/nes.svg`);

    expect(lastProbe().src).toBe("/media/theme/logo/nes.svg");
  });

  it("adres zewnętrzny jest ładowany bez zmian", () => {
    void measureIntrinsicSize("https://cdn.example.com/media/logo.svg");

    expect(lastProbe().src).toBe("https://cdn.example.com/media/logo.svg");
  });
});

describe("measureIntrinsicSize - SVG bez własnej proporcji", () => {
  const LOGO = "https://cdn.example.com/logo.svg";

  /** Pomiar pliku `LOGO`, dla którego przeglądarka zgłasza podany rozmiar. */
  const measureSvg = (markup: string, width: number, height: number) => {
    serveSvg(markup);
    const pending = measureIntrinsicSize(LOGO);
    lastProbe().load(width, height);
    return pending;
  };

  // Rozmiary w obu tabelach to `naturalWidth` × `naturalHeight` zdjęte z
  // Chrome 153 dla dokładnie takich plików.
  it.each([
    ["bez `viewBox`, `width` i `height`", svgFile(), 300, 150],
    ["sam `width` (wysokość zastępcza)", svgFile('width="200"'), 200, 150],
    ["sam `height` (szerokość zastępcza)", svgFile('height="80"'), 300, 80],
    ["`width` i `height` w procentach", svgFile('width="100%" height="100%"'), 300, 150],
    ["rozmiar tylko w `style`", svgFile('style="width:100px;height:50px"'), 300, 150],
    [
      '`viewBox` z `preserveAspectRatio="none"`',
      svgFile('viewBox="0 0 512 128" preserveAspectRatio="none"'),
      300,
      150,
    ],
    ["`viewBox` o zerowym polu", svgFile('viewBox="0 0 0 0"'), 300, 150],
  ])('%s -> "" (znacznik zostaje bez atrybutów)', async (_name, markup, width, height) => {
    await expect(measureSvg(markup, width, height)).resolves.toBe("");
  });

  it.each([
    ["sam `viewBox`", svgFile('viewBox="0 0 512 128"'), 300, 75, "300x75"],
    ["`width` i `height` w pikselach", svgFile('width="350" height="150"'), 350, 150, "350x150"],
    ["`width` z `viewBox`", svgFile('width="200" viewBox="0 0 100 50"'), 200, 100, "200x100"],
    [
      '`width` i `height` mimo `preserveAspectRatio="none"`',
      svgFile('width="350" height="150" viewBox="0 0 10 10" preserveAspectRatio="none"'),
      350,
      150,
      "350x150",
    ],
  ])("%s -> rozmiar pliku", async (_name, markup, width, height, expected) => {
    await expect(measureSvg(markup, width, height)).resolves.toBe(expected);
  });

  it("plik SVG jest czytany spod adresu pomiaru: kanoniczny `/media/...` jako ścieżka względna", async () => {
    const pending = measureIntrinsicSize(`${PUBLIC_MEDIA_ORIGIN}/media/theme/logo/nes.svg`);
    lastProbe().load(350, 150);

    await expect(pending).resolves.toBe("350x150");
    expect(svgFetch.calls.map((call) => call.url)).toEqual(["/media/theme/logo/nes.svg"]);
    expect(lastProbe().src).toBe("/media/theme/logo/nes.svg");
  });

  it("adres innego pliku nie dostaje żadnego żądania i mierzy się jak dotąd", async () => {
    // Odpowiedź, która zabrałaby rozmiar, gdyby pomiar w ogóle o nią zapytał.
    serveSvg(svgFile());
    for (const url of [
      "https://cdn.example.com/panel.jpg",
      "https://cdn.example.com/panel.png?nazwa=logo.svg",
      "https://cdn.example.com/panel.webp#logo.svg",
      "data:image/png;base64,AAAA",
    ]) {
      const pending = measureIntrinsicSize(url);
      lastProbe().load(300, 150);
      await expect(pending).resolves.toBe("300x150");
    }

    expect(svgFetch.calls).toEqual([]);
  });

  it('nieudany pomiar pliku SVG z proporcją -> ""', async () => {
    const pending = measureIntrinsicSize(LOGO);
    lastProbe().fail();

    await expect(pending).resolves.toBe("");
  });

  it('błąd odczytu pliku (sieć, odmowa CORS) -> "" bez odrzucenia obietnicy', async () => {
    svgFetch.respond = () => Promise.reject(new TypeError("Failed to fetch"));
    const pending = measureIntrinsicSize(LOGO);
    lastProbe().load(350, 150);

    await expect(pending).resolves.toBe("");
  });

  it('odpowiedź inna niż 2xx -> "", treść nie jest czytana', async () => {
    const text = vi.fn(() => Promise.resolve(SVG_WITH_RATIO));
    svgFetch.respond = () => Promise.resolve({ ok: false, text });
    const pending = measureIntrinsicSize(LOGO);
    lastProbe().load(350, 150);

    await expect(pending).resolves.toBe("");
    expect(text).not.toHaveBeenCalled();
  });

  it('błąd czytania treści odpowiedzi -> ""', async () => {
    svgFetch.respond = () =>
      Promise.resolve({ ok: true, text: () => Promise.reject(new Error("przerwane")) });
    const pending = measureIntrinsicSize(LOGO);
    lastProbe().load(350, 150);

    await expect(pending).resolves.toBe("");
  });

  it('wyjątek `fetch` i środowisko bez `fetch` -> ""', async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("zablokowane");
    });
    const thrown = measureIntrinsicSize(LOGO);
    lastProbe().load(350, 150);
    await expect(thrown).resolves.toBe("");

    vi.stubGlobal("fetch", undefined);
    const missing = measureIntrinsicSize(LOGO);
    lastProbe().load(350, 150);
    await expect(missing).resolves.toBe("");
  });

  it('odczyt bez odpowiedzi przez 5000 ms -> "", ani chwili wcześniej; żądanie jest przerywane', async () => {
    vi.useFakeTimers();
    svgFetch.respond = () => new Promise<FetchReply>(() => {});
    const settled = vi.fn();
    void measureIntrinsicSize(LOGO).then(settled);
    lastProbe().load(350, 150);

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled();
    expect(svgFetch.calls[0].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith("");
    expect(svgFetch.calls[0].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("isSvgSource", () => {
  it.each([
    "https://cdn.example.com/logo.svg",
    "https://cdn.example.com/LOGO.SVG",
    "/media/theme/logo/nes.svg?v=3",
    "/brand/znak.svg#ciemny",
    "https://cdn.example.com/logo.svgz",
    "data:image/svg+xml;utf8,%3Csvg%2F%3E",
    "data:image/svg+xml,%3Csvg%2F%3E",
  ])("%s to SVG", (url) => {
    expect(isSvgSource(url)).toBe(true);
  });

  it.each([
    "https://cdn.example.com/panel.jpg",
    "https://cdn.example.com/panel.png?plik=logo.svg",
    "https://cdn.example.com/panel.png#logo.svg",
    "https://cdn.example.com/svg/panel.png",
    "https://cdn.example.com/logo.svg.png",
    "data:image/png;base64,AAAA",
  ])("%s to nie SVG", (url) => {
    expect(isSvgSource(url)).toBe(false);
  });
});

describe("svgDeclaresRatio", () => {
  // `true` tylko tam, gdzie Chrome 153 daje obrazowi o stałej wysokości TO SAMO
  // pole z atrybutami `width`/`height` i bez nich (plik ma własną proporcję).
  it.each([
    ["`viewBox`", svgFile('viewBox="0 0 512 128"')],
    ["`viewBox` z przecinkami", svgFile('viewBox="0, 0, 512, 128"')],
    ["`viewBox` z odstępami na brzegach", svgFile('viewBox="  0 0 512 128  "')],
    ["`viewBox` z ujemnym początkiem i wykładnikiem", svgFile('viewBox="-10 -10 5e2 1.25e2"')],
    ["`viewBox` z ułamkami bez zera", svgFile('viewBox="0 0 .5 .25"')],
    ["`viewBox` o bardzo małym polu", svgFile('viewBox="0 0 0.004 0.001"')],
    ["`viewBox` o bardzo dużym polu", svgFile('viewBox="0 0 1e38 1e38"')],
    ["`viewBox` w apostrofach", svgFile("viewBox='0 0 512 128'")],
    ["`viewBox` po atrybucie ze znakiem `>`", svgFile('data-x="a>b" viewBox="0 0 512 128"')],
    ["`width` i `height` bez jednostki", svgFile('width="350" height="150"')],
    ["`width` i `height` w px", svgFile('width="350px" height="150PX"')],
    ["`width` i `height` w calach i punktach", svgFile('width=".5in" height="72pt"')],
    ["`width` i `height` w mm i pc", svgFile('width="100mm" height="3pc"')],
    ["`width` i `height` ze znakiem plus i odstępami", svgFile('width=" +350 " height="1.5e2"')],
    [
      "nieznana wartość `preserveAspectRatio` (obowiązuje domyślna)",
      svgFile('viewBox="0 0 512 128" preserveAspectRatio="NONE"'),
    ],
    [
      "element główny z prefiksem przestrzeni nazw",
      '<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 512 128"><s:rect/></s:svg>',
    ],
    [
      "deklaracja XML, DOCTYPE z encjami i komentarz przed elementem głównym",
      '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
        '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
        '  <!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n' +
        "<!-- Generator: <svg width='1' height='1'> -->\n" +
        `<svg xmlns="&ns_svg;" viewBox="0 0 512 128">${SHAPE}</svg>`,
    ],
  ])("%s -> plik deklaruje proporcję", (_name, markup) => {
    expect(svgDeclaresRatio(markup)).toBe(true);
  });

  it.each([
    ["brak atrybutów rozmiaru", svgFile()],
    ["sam `width`", svgFile('width="200"')],
    ["sam `height`", svgFile('height="80"')],
    ["procenty", svgFile('width="100%" height="100%"')],
    ["`height` w procentach", svgFile('width="350" height="150%"')],
    ["`auto`", svgFile('width="auto" height="auto"')],
    ["odstęp przed jednostką", svgFile('width="350 px" height="150"')],
    ["kropka bez cyfr po niej", svgFile('width="350." height="150."')],
    ["wartość ujemna i zero", svgFile('width="-350" height="0"')],
    ["jednostki względne (reguła zachowawcza)", svgFile('width="10em" height="5ex"')],
    ["rozmiar w `style`", svgFile('style="width:100px;height:50px"')],
    ["atrybuty wielkimi literami", svgFile('WIDTH="350" HEIGHT="150" VIEWBOX="0 0 1 1"')],
    ["`viewBox` z jednostką", svgFile('viewBox="0 0 512 128px"')],
    ["`viewBox` z trzema liczbami", svgFile('viewBox="0 0 512"')],
    ["`viewBox` z pięcioma liczbami", svgFile('viewBox="0 0 512 128 7"')],
    ["`viewBox` z podwójnym przecinkiem", svgFile('viewBox="0,,512,128"')],
    ["`viewBox` z przecinkiem na końcu", svgFile('viewBox="0 0 512 128,"')],
    ["`viewBox` z kropką bez cyfr", svgFile('viewBox="0 0 512. 128."')],
    ["`viewBox` o zerowej albo ujemnej stronie", svgFile('viewBox="0 0 -5 0"')],
    ["`viewBox` z liczbą poza zakresem", svgFile('viewBox="0 0 1e400 128"')],
    ["`viewBox` z liczbą poza zakresem 32 bitów", svgFile('viewBox="0 0 1e39 128"')],
    ["`viewBox` z liczbą zbyt małą", svgFile('viewBox="0 0 1e-50 128"')],
    ["`viewBox` o boku, który Chrome liczy jak zero", svgFile('viewBox="0 0 1e-40 1e-40"')],
    ["`viewBox` z początkiem poza zakresem", svgFile('viewBox="1e400 0 512 128"')],
    ["`width` poza zakresem", svgFile('width="1e400" height="150"')],
    ['`preserveAspectRatio="none"`', svgFile('viewBox="0 0 512 128" preserveAspectRatio="none"')],
    [
      '`preserveAspectRatio="none meet"` z odstępami',
      svgFile('viewBox="0 0 512 128" preserveAspectRatio="  none meet "'),
    ],
    [
      '`width` z `viewBox` i `preserveAspectRatio="none"`',
      svgFile('width="200" viewBox="0 0 100 50" preserveAspectRatio="none"'),
    ],
    ["wartość z encji (reguła zachowawcza)", svgFile('width="&w;" height="150"')],
    [
      "dokument HTML zamiast SVG",
      "<!doctype html><html><body><svg viewBox='0 0 1 1'/></body></html>",
    ],
    ["element główny inny niż `svg`", '<svgx viewBox="0 0 512 128"/>'],
    ["treść binarna", "\u0089PNG\r\n\u001a\n"],
    ["pusta treść", ""],
  ])("%s -> brak proporcji", (_name, markup) => {
    expect(svgDeclaresRatio(markup)).toBe(false);
  });
});
