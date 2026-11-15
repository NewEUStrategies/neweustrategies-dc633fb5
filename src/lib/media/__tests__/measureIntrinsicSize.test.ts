// Pomiar naturalnego rozmiaru pliku w przeglądarce redaktora
// (src/lib/media/measureIntrinsicSize.ts).
//
// CO TU MA DOWÓD
//  1. Obietnica NIGDY nie jest odrzucana i ZAWSZE się rozstrzyga: błąd pobrania,
//     brak odpowiedzi (limit 5 s), wyjątek przy stawianiu sond i wyjątek odczytu
//     układu dają `""`. Od tego zależy "Zapisz" w Opcjach motywu - czeka na
//     pomiar, więc pomiar bez rozstrzygnięcia zawiesiłby zapis.
//  2. Wynik przechodzi przez wspólną walidację: plik bez własnego rozmiaru
//     (0 × 0) to `""`, a nie `"0x0"`.
//  3. Mierzony jest plik pod adresem, którym panel pokazuje podglądy: kanoniczny
//     `/media/...` jako ścieżka względna (działa na hoście podglądu), adres
//     zewnętrzny bez zmian.
//  4. PLIK BEZ WŁASNEJ PROPORCJI NIE DOSTAJE ROZMIARU. Chrome zgłasza dla
//     takiego SVG rozmiar zastępczy (300 × 150 albo jeden prawdziwy bok i drugi
//     zastępczy), a atrybuty z tej pary zostałyby na stałe i zmieniły kształt
//     obrazu. O proporcję pytany jest SILNIK: dwie sondy `<img>` tego samego
//     adresu o wysokości 10 px i 1000 px; plik z proporcją jest w wyższej
//     szerszy, plik bez proporcji ma w obu tę samą szerokość.
//  5. Moduł NIE CZYTA PLIKU (`fetch`): CSP aplikacji (`connect-src`) blokuje
//     taki odczyt dla hosta zewnętrznego i adresu `data:`, a każda blokada
//     trafia do kanału błędów jako fałszywy alarm.
//  6. Wynik nie zależy od rozszerzenia adresu.
//  7. Sondy znikają z dokumentu na każdej ścieżce.
//
// happy-dom nie ładuje obrazów i nie liczy układu: zdarzenia `load`/`error`
// odpala test, a szerokość sondy podaje wstrzyknięty odczyt (drugi argument
// `measureIntrinsicSize`). Liczby w tabelach są zdjęte z Chromium 153 dla
// dokładnie takich plików (sonda 10 px, sonda 1000 px, `naturalWidth` ×
// `naturalHeight`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureIntrinsicSize, type ProbeWidthReader } from "@/lib/media/measureIntrinsicSize";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";

const LOGO = "https://cdn.example.com/logo.svg";

/** Sonda niska (10 px) stoi w pojemniku pierwsza, wysoka (1000 px) druga. */
const isLowProbe = (probe: HTMLImageElement) => probe.parentElement?.firstElementChild === probe;

/** Odczyt układu: szerokość sondy niskiej i wysokiej. */
const widths =
  (low: number, high: number): ProbeWidthReader =>
  (probe) =>
    isLowProbe(probe) ? low : high;

/** Plik z własną proporcją 7 : 3 (350 × 150): 23,33 px i 2333,33 px. */
const SCALES = widths(23.33, 2333.33);
/** Plik bez proporcji: szerokość zastępcza w obu sondach. */
const FIXED = widths(300, 300);

/** Sondy pomiaru w toku: pojemnik dopięty na końcu `<body>` i jego dwa obrazy. */
function probesInDocument(): HTMLImageElement[] {
  return Array.from(document.body.querySelectorAll<HTMLImageElement>("[aria-hidden] > img"));
}

function setNaturalSize(probe: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(probe, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(probe, "naturalHeight", { configurable: true, value: height });
}

/** Pomiar w toku: obietnica i sterowanie zdarzeniami sond. */
function startMeasure(url: string, readWidth: ProbeWidthReader = SCALES) {
  const pending = measureIntrinsicSize(url, readWidth);
  const probes = probesInDocument();
  return {
    pending,
    probes,
    host: probes[0]?.parentElement ?? null,
    /** Oba obrazy załadowane: plik zgłasza podany rozmiar naturalny. */
    load(width: number, height: number) {
      for (const probe of probes) {
        setNaturalSize(probe, width, height);
        probe.dispatchEvent(new Event("load"));
      }
    },
    /** Załadowana tylko jedna sonda. */
    loadOne(index: number, width: number, height: number) {
      setNaturalSize(probes[index], width, height);
      probes[index].dispatchEvent(new Event("load"));
    },
    fail(index = 0) {
      probes[index].dispatchEvent(new Event("error"));
    },
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;
let nodesBefore = 0;

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error("pomiar nie może czytać pliku")));
  vi.stubGlobal("fetch", fetchSpy);
  nodesBefore = document.body.childElementCount;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Każdy test sprawdza przez to dwie rzeczy naraz: pomiar po sobie posprzątał
  // i ani razu nie sięgnął po `fetch`.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(probesInDocument()).toEqual([]);
  expect(document.body.childElementCount).toBe(nodesBefore);
});

describe("measureIntrinsicSize", () => {
  it('załadowany plik 350 × 150 z własną proporcją -> "350x150"', async () => {
    const measure = startMeasure(LOGO);
    measure.load(350, 150);

    await expect(measure.pending).resolves.toBe("350x150");
  });

  it('plik z proporcją, ale bez własnego rozmiaru (0 × 0) -> ""', async () => {
    const measure = startMeasure("https://cdn.example.com/bez-rozmiaru.svg");
    measure.load(0, 0);

    await expect(measure.pending).resolves.toBe("");
  });

  it.each([0, 1])('błąd pobrania w sondzie %i -> "" (bez odrzucenia obietnicy)', async (index) => {
    const measure = startMeasure("https://cdn.example.com/404.png");
    measure.fail(index);

    await expect(measure.pending).resolves.toBe("");
  });

  it('brak zdarzenia przez 5000 ms -> "", ani chwili wcześniej; sondy znikają', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const measure = startMeasure("https://cdn.example.com/wisi.png");
    void measure.pending.then(settled);

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled();
    expect(measure.host?.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith("");
    expect(measure.host?.isConnected).toBe(false);
  });

  it("jedna załadowana sonda nie rozstrzyga - pomiar czeka na obie (limit liczy się od startu)", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    const measure = startMeasure(LOGO);
    void measure.pending.then(settled);

    measure.loadOne(1, 350, 150);
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled();

    measure.loadOne(0, 350, 150);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith("350x150");
  });

  it("po rozstrzygnięciu zdejmuje uchwyty, zegar i sondy - spóźnione zdarzenie niczego nie zmienia", async () => {
    vi.useFakeTimers();
    const readWidth = vi.fn(SCALES);
    const measure = startMeasure(LOGO, readWidth);
    measure.load(350, 150);

    await expect(measure.pending).resolves.toBe("350x150");
    for (const probe of measure.probes) {
      expect(probe.onload).toBeNull();
      expect(probe.onerror).toBeNull();
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(measure.host?.isConnected).toBe(false);

    const reads = readWidth.mock.calls.length;
    measure.load(1, 1);
    measure.fail();
    expect(readWidth.mock.calls.length).toBe(reads);
  });

  it('pusty adres -> "" bez stawiania sond', async () => {
    const createElement = vi.spyOn(document, "createElement");

    await expect(measureIntrinsicSize("", SCALES)).resolves.toBe("");
    expect(createElement).not.toHaveBeenCalled();
  });

  it('środowisko bez `document` (render serwera) -> ""', async () => {
    const page = document;
    vi.stubGlobal("document", undefined);
    try {
      await expect(measureIntrinsicSize(LOGO, SCALES)).resolves.toBe("");
    } finally {
      vi.stubGlobal("document", page);
    }
  });

  it('wyjątek przy tworzeniu sondy -> "" (obietnica się rozstrzyga, nic nie zostaje w dokumencie)', async () => {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "img") throw new Error("brak pamięci");
      return createElement(tag);
    }) as typeof document.createElement);

    await expect(measureIntrinsicSize(LOGO, SCALES)).resolves.toBe("");
  });

  it('wyjątek przy dopinaniu sond do dokumentu -> "", bez wiszącego zegara', async () => {
    vi.useFakeTimers();
    vi.spyOn(document.body, "appendChild").mockImplementation(() => {
      throw new Error("dokument zamknięty");
    });

    await expect(measureIntrinsicSize(LOGO, SCALES)).resolves.toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("kanoniczny adres `/media/...` jest ładowany jako ścieżka względna - w obu sondach", async () => {
    const measure = startMeasure(`${PUBLIC_MEDIA_ORIGIN}/media/theme/logo/nes.svg`);

    expect(measure.probes.map((probe) => probe.getAttribute("src"))).toEqual([
      "/media/theme/logo/nes.svg",
      "/media/theme/logo/nes.svg",
    ]);
    measure.fail();
    await measure.pending;
  });

  it("adres zewnętrzny jest ładowany bez zmian", async () => {
    const measure = startMeasure("https://cdn.example.com/media/logo.svg");

    expect(measure.probes.map((probe) => probe.getAttribute("src"))).toEqual([
      "https://cdn.example.com/media/logo.svg",
      "https://cdn.example.com/media/logo.svg",
    ]);
    measure.fail();
    await measure.pending;
  });
});

describe("measureIntrinsicSize - sondy układu", () => {
  it("dwie sondy `<img>` stoją W DOKUMENCIE, w ukrytym pojemniku, z wysokością 10 px i 1000 px i szerokością auto", async () => {
    const measure = startMeasure(LOGO);

    expect(measure.probes).toHaveLength(2);
    expect(measure.host?.parentElement).toBe(document.body);
    expect(measure.host?.getAttribute("aria-hidden")).toBe("true");
    // Pojemnik niczego nie rysuje i nie zmienia układu strony.
    const hostStyle = measure.host?.getAttribute("style") ?? "";
    for (const rule of [
      /position:\s*fixed\s*!important/,
      /width:\s*0(px)?\s*!important/,
      /height:\s*0(px)?\s*!important/,
      /overflow:\s*hidden\s*!important/,
    ]) {
      expect(hostStyle).toMatch(rule);
    }
    // `all: initial` zdejmuje z sondy reguły arkusza (np. `max-width: 100%`),
    // więc szerokość zostaje `auto`; jedyna własna wartość to wysokość.
    const styles = measure.probes.map((probe) => probe.getAttribute("style") ?? "");
    expect(styles[0]).toMatch(/^all:\s*initial\s*!important;\s*height:\s*10px\s*!important;?$/);
    expect(styles[1]).toMatch(/^all:\s*initial\s*!important;\s*height:\s*1000px\s*!important;?$/);
    for (const probe of measure.probes) {
      expect(probe.getAttribute("alt")).toBe("");
      expect(probe.hasAttribute("srcset")).toBe(false);
    }
    measure.fail();
    await measure.pending;
  });

  // [nazwa, sonda 10 px, sonda 1000 px, naturalWidth, naturalHeight]
  it.each([
    ["SVG bez `viewBox`, `width` i `height`", 300, 300, 300, 150],
    ["SVG z samym `width` (wysokość zastępcza)", 200, 200, 200, 150],
    ["SVG z samym `height` (szerokość zastępcza)", 300, 300, 300, 80],
    ["SVG z `width` i `height` w procentach", 300, 300, 300, 150],
    ["SVG z rozmiarem tylko w `style`", 300, 300, 300, 150],
    ['SVG z `viewBox` i `preserveAspectRatio="none"`', 300, 300, 300, 150],
    ["SVG z `viewBox` o zerowym polu", 300, 300, 300, 150],
  ])(
    '%s: obie sondy tej samej szerokości -> "" (znacznik zostaje bez atrybutów)',
    async (_name, low, high, width, height) => {
      const measure = startMeasure(LOGO, widths(low, high));
      measure.load(width, height);

      await expect(measure.pending).resolves.toBe("");
    },
  );

  // [nazwa, sonda 10 px, sonda 1000 px, naturalWidth, naturalHeight, wynik]
  it.each([
    ["SVG z samym `viewBox` 512 × 128", 40, 4000, 300, 75, "300x75"],
    ["SVG z `width` i `height` w pikselach", 23.33, 2333.33, 350, 150, "350x150"],
    ["SVG z `width` i `viewBox`", 20, 2000, 200, 100, "200x100"],
    [
      'SVG z `width` i `height` mimo `preserveAspectRatio="none"`',
      23.33,
      2333.33,
      350,
      150,
      "350x150",
    ],
    ["SVG z `width` i `height` w em", 20, 2000, 160, 80, "160x80"],
    ["PNG 350 × 150", 23.33, 2333.33, 350, 150, "350x150"],
    ["PNG 1 × 2000 (niska sonda zaokrąglona do zera)", 0, 0.5, 1, 2000, "1x2000"],
    ["PNG 4000 × 2", 20000, 2000000, 4000, 2, "4000x2"],
  ])(
    "%s: wyższa sonda jest szersza -> rozmiar pliku",
    async (_name, low, high, width, height, size) => {
      const measure = startMeasure(LOGO, widths(low, high));
      measure.load(width, height);

      await expect(measure.pending).resolves.toBe(size);
    },
  );

  it.each([
    ["zero w obu sondach (brak układu)", 0, 0],
    ["NaN", Number.NaN, Number.NaN],
    ["wyższa sonda węższa", 300, 200],
  ])('odczyt układu bez odpowiedzi (%s) -> ""', async (_name, low, high) => {
    const measure = startMeasure(LOGO, widths(low, high));
    measure.load(350, 150);

    await expect(measure.pending).resolves.toBe("");
  });

  it('wyjątek odczytu układu -> "" od razu, bez czekania na limit', async () => {
    vi.useFakeTimers();
    const measure = startMeasure(LOGO, () => {
      throw new Error("układ niedostępny");
    });
    measure.load(350, 150);

    await expect(measure.pending).resolves.toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wynik NIE zależy od rozszerzenia adresu: decyduje układ, nie nazwa pliku", async () => {
    // Plik bez proporcji pod adresem, który nie wygląda na SVG...
    for (const url of [
      "https://cdn.example.com/asset/12345",
      "https://cdn.example.com/panel.png",
      "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
    ]) {
      const measure = startMeasure(url, FIXED);
      measure.load(300, 150);
      await expect(measure.pending).resolves.toBe("");
    }
    // ...i plik z proporcją pod adresem `.svg`, `.svgz`, bez rozszerzenia i `data:`.
    for (const url of [
      "https://cdn.example.com/logo.svg",
      "https://cdn.example.com/logo.svgz",
      "https://cdn.example.com/asset/67890",
      "data:image/svg+xml;utf8,%3Csvg%20viewBox%3D%220%200%20512%20128%22%2F%3E",
    ]) {
      const measure = startMeasure(url, widths(40, 4000));
      measure.load(300, 75);
      await expect(measure.pending).resolves.toBe("300x75");
    }
  });

  it("domyślny odczyt układu to `getBoundingClientRect().width` sondy", async () => {
    const rect = vi
      .spyOn(HTMLImageElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLImageElement) {
        return { width: isLowProbe(this) ? 23.33 : 2333.33 } as DOMRect;
      });
    const pending = measureIntrinsicSize(LOGO);
    for (const probe of probesInDocument()) {
      setNaturalSize(probe, 350, 150);
      probe.dispatchEvent(new Event("load"));
    }

    await expect(pending).resolves.toBe("350x150");
    expect(rect).toHaveBeenCalledTimes(2);

    // Ten sam plik bez proporcji w układzie: rozmiaru nie ma.
    rect.mockImplementation(() => ({ width: 300 }) as DOMRect);
    const fixed = measureIntrinsicSize(LOGO);
    for (const probe of probesInDocument()) {
      setNaturalSize(probe, 300, 150);
      probe.dispatchEvent(new Event("load"));
    }
    await expect(fixed).resolves.toBe("");
  });
});

describe("measureIntrinsicSize - moduł nie czyta pliku", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/media/measureIntrinsicSize.ts"),
    "utf8",
  );
  /** Kod bez komentarzy - nagłówek modułu opisuje `fetch` słowami. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("w kodzie modułu nie ma `fetch`, `XMLHttpRequest` ani parsera treści SVG", () => {
    expect(code).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|AbortController/);
    expect(code).not.toMatch(/viewBox|preserveAspectRatio|\.text\(\)/);
  });

  it("moduł eksportuje sam pomiar - bez rozpoznawania SVG po adresie", async () => {
    const exported = await import("@/lib/media/measureIntrinsicSize");

    expect(Object.keys(exported).sort()).toEqual(["measureIntrinsicSize"]);
  });
});
