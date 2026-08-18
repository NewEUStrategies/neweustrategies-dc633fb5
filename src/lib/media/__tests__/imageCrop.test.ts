// `imageCrop.ts` - orkiestracja dwóch canvasów, z której wychodzi KAŻDY
// przycięty plik w serwisie. Do 18.08.2026: 0 z 13 funkcji.
//
// DLACZEGO ATRAPA CANVASU, A NIE PRAWDZIWY. `happy-dom` nie implementuje
// `CanvasRenderingContext2D`, więc bez atrapy `getContext("2d")` oddaje `null`
// i moduł rzuca „no 2d ctx" na pierwszej linii - nie da się dojść do żadnej
// reguły. Atrapa zapisuje ARGUMENTY `drawImage` i wymiary canvasów, bo to one
// są kontraktem tego modułu: „ile canvas ma mieć piksela, który wycinek źródła
// trafia w który wycinek celu". Piksele rysuje przeglądarka i to nie jest nasz
// kod do testowania.
//
// UWAGA NA ZAKRES. Ten plik NIE ma klamrowania kadru do krawędzi obrazu -
// `crop.x/y/width/height` idą prosto do `drawImage`. Testy niżej pinują ten
// stan świadomie (patrz „przekazuje kadr niezmieniony"); dołożenie klamry jest
// zmianą zachowania i należy do osobnego commitu. Same reguły geometryczne
// (bounding box, tolerancja proporcji, kroki suwaków) mieszkają w
// `cropGeometry.ts` i mają własny plik testowy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCroppedBlob, getImageDimensions, readFileAsDataUrl } from "@/lib/media/imageCrop";

// ---------- Atrapa obrazu ----------

interface ImageStubOptions {
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  /** Gdy true, `src = ...` odpala `onerror` zamiast `onload`. */
  fail?: boolean;
}

const imageOptions: ImageStubOptions = {};
/** Ostatnio utworzona atrapa obrazu - do asercji na `crossOrigin`. */
let lastImage: ImageStub | null = null;

class ImageStub {
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 0;
  height = 0;
  naturalWidth = 0;
  naturalHeight = 0;
  #src = "";

  constructor() {
    lastImage = this;
  }

  set src(value: string) {
    this.#src = value;
    const o = imageOptions;
    this.width = o.width ?? 0;
    this.height = o.height ?? 0;
    this.naturalWidth = o.naturalWidth ?? o.width ?? 0;
    this.naturalHeight = o.naturalHeight ?? o.height ?? 0;
    // Ładowanie obrazu jest asynchroniczne także w przeglądarce - atrapa musi
    // to odwzorować, inaczej test przechodziłby obok kolejki `await`.
    queueMicrotask(() => (o.fail ? this.onerror?.() : this.onload?.()));
  }

  get src(): string {
    return this.#src;
  }
}

// ---------- Atrapa canvasu ----------

interface DrawImageCall {
  readonly source: "image" | "canvas" | "unknown";
  readonly args: readonly number[];
}

interface CanvasStub {
  width: number;
  height: number;
  readonly draws: DrawImageCall[];
  readonly translates: number[][];
  readonly rotates: number[];
  smoothing: { enabled?: boolean; quality?: string };
  getContext: (kind: string) => unknown;
  toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void;
}

interface CanvasBehaviour {
  /** Indeksy canvasów (0 = rotacji, 1 = wyjściowy), dla których `getContext` ma oddać null. */
  nullContextAt?: number[];
  /** Gdy true, `toBlob` oddaje null (przeglądarka tak sygnalizuje porażkę kodowania). */
  toBlobFails?: boolean;
  /** Wyjątek rzucany przez `drawImage` na canvasie wyjściowym. */
  drawThrows?: Error;
}

const canvasBehaviour: CanvasBehaviour = {};
let canvases: CanvasStub[] = [];
/** Argumenty ostatniego wywołania `toBlob` - do asercji na mime i jakości. */
let lastToBlobArgs: { type?: string; quality?: number } | null = null;

function makeCanvas(index: number): CanvasStub {
  const draws: DrawImageCall[] = [];
  const translates: number[][] = [];
  const rotates: number[] = [];
  const smoothing: { enabled?: boolean; quality?: string } = {};

  const ctx = {
    translate: (x: number, y: number) => translates.push([x, y]),
    rotate: (r: number) => rotates.push(r),
    drawImage: (source: unknown, ...args: number[]) => {
      if (canvasBehaviour.drawThrows && args.length === 8) throw canvasBehaviour.drawThrows;
      draws.push({
        source:
          source instanceof ImageStub
            ? "image"
            : typeof source === "object" && source !== null && "getContext" in source
              ? "canvas"
              : "unknown",
        args,
      });
    },
    set imageSmoothingEnabled(v: boolean) {
      smoothing.enabled = v;
    },
    set imageSmoothingQuality(v: string) {
      smoothing.quality = v;
    },
  };

  return {
    width: 0,
    height: 0,
    draws,
    translates,
    rotates,
    smoothing,
    getContext: (kind: string) =>
      kind === "2d" && !canvasBehaviour.nullContextAt?.includes(index) ? ctx : null,
    toBlob: (cb, type, quality) => {
      lastToBlobArgs = { type, quality };
      cb(canvasBehaviour.toBlobFails ? null : new Blob(["x"], { type: type ?? "image/jpeg" }));
    },
  };
}

const AVATAR_CROP = { x: 100, y: 50, width: 400, height: 400 };

beforeEach(() => {
  canvases = [];
  lastImage = null;
  lastToBlobArgs = null;
  for (const key of Object.keys(imageOptions)) delete imageOptions[key as keyof ImageStubOptions];
  for (const key of Object.keys(canvasBehaviour)) {
    delete canvasBehaviour[key as keyof CanvasBehaviour];
  }
  vi.stubGlobal("Image", ImageStub);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") throw new Error(`nieoczekiwany element w teście: ${tag}`);
    const canvas = makeCanvas(canvases.length);
    canvases.push(canvas);
    return canvas as unknown as HTMLElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getCroppedBlob - canvas rotacji", () => {
  it("bez obrotu ma wymiary źródła i rysuje obraz wyśrodkowany", async () => {
    imageOptions.width = 1600;
    imageOptions.height = 900;
    await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600);

    const [rot] = canvases;
    expect(rot.width).toBe(1600);
    expect(rot.height).toBe(900);
    // translate na środek, obrót, rysunek od minus połowy boku - bez tego
    // obrót odbywałby się wokół lewego górnego rogu i wynosił zdjęcie z kadru.
    expect(rot.translates).toEqual([[800, 450]]);
    expect(rot.rotates).toEqual([0]);
    expect(rot.draws[0]).toEqual({ source: "image", args: [-800, -450] });
  });

  it("obrót o 90° zamienia wymiary canvasu rotacji", async () => {
    imageOptions.width = 1600;
    imageOptions.height = 900;
    await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 90, 600, 600);

    const [rot] = canvases;
    expect(rot.width).toBeCloseTo(900, 9);
    expect(rot.height).toBeCloseTo(1600, 9);
    expect(rot.rotates[0]).toBeCloseTo(Math.PI / 2, 12);
  });

  it("obrót ujemny daje ten sam canvas co dodatni, ale przeciwny kąt", async () => {
    imageOptions.width = 1600;
    imageOptions.height = 900;
    await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, -90, 600, 600);

    const [rot] = canvases;
    expect(rot.width).toBeCloseTo(900, 9);
    expect(rot.height).toBeCloseTo(1600, 9);
    expect(rot.rotates[0]).toBeCloseTo(-Math.PI / 2, 12);
  });

  it("obrót o 45° daje canvas większy od źródła w obu osiach", async () => {
    imageOptions.width = 1000;
    imageOptions.height = 500;
    await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 45, 600, 600);

    const [rot] = canvases;
    // Gdyby canvas został przy 1000×500, rogi obróconego zdjęcia zostałyby ścięte.
    expect(rot.width).toBeGreaterThan(1000);
    expect(rot.height).toBeGreaterThan(500);
    expect(Number.isFinite(rot.width)).toBe(true);
  });
});

describe("getCroppedBlob - canvas wyjściowy", () => {
  it("ma DOKŁADNIE wymiary docelowe i skaluje do nich kadr", async () => {
    imageOptions.width = 1600;
    imageOptions.height = 900;
    await getCroppedBlob(
      "data:image/png;base64,x",
      { x: 100, y: 50, width: 400, height: 150 },
      0,
      1600,
      600,
    );

    const out = canvases[1];
    expect(out.width).toBe(1600);
    expect(out.height).toBe(600);
    // Kontrakt: wycinek źródła (x, y, w, h) -> pełny cel (0, 0, targetW, targetH).
    expect(out.draws[0]).toEqual({
      source: "canvas",
      args: [100, 50, 400, 150, 0, 0, 1600, 600],
    });
  });

  it("włącza wygładzanie w najwyższej jakości przy skalowaniu w dół", async () => {
    // Bez tego zmniejszenie 1600->600 daje schodkowane krawędzie (aliasing) na
    // każdej miniaturze i każdym awatarze.
    imageOptions.width = 1600;
    imageOptions.height = 900;
    await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600);

    expect(canvases[1].smoothing).toEqual({ enabled: true, quality: "high" });
  });

  it("przekazuje kadr NIEZMIENIONY, także gdy wychodzi poza obraz", async () => {
    // Ten moduł nie klamruje kadru - wycinek spoza źródła canvas dopełnia
    // przezroczystością, więc wynik jest rozciągnięty. Pin na dzisiejszy stan:
    // klamrowanie to zmiana zachowania, nie refaktor.
    imageOptions.width = 800;
    imageOptions.height = 600;
    await getCroppedBlob(
      "data:image/png;base64,x",
      { x: 700, y: 500, width: 400, height: 400 },
      0,
      600,
      600,
    );

    expect(canvases[1].draws[0].args).toEqual([700, 500, 400, 400, 0, 0, 600, 600]);
  });

  it("przekazuje kadr o ujemnych i ułamkowych współrzędnych bez normalizacji", async () => {
    imageOptions.width = 800;
    imageOptions.height = 600;
    await getCroppedBlob(
      "data:image/png;base64,x",
      { x: -12.5, y: -0.5, width: 400.25, height: 399.75 },
      0,
      600,
      600,
    );

    expect(canvases[1].draws[0].args).toEqual([-12.5, -0.5, 400.25, 399.75, 0, 0, 600, 600]);
  });

  it("kadr o zerowej wysokości dochodzi do canvasu, a jego błąd wychodzi na wierzch", async () => {
    // Przeglądarka odrzuca `drawImage` z zerowym bokiem źródła (IndexSizeError).
    // Istotne jest, że moduł tego nie połyka: użytkownik dostaje błąd zamiast
    // pustego pliku wgranego do biblioteki.
    imageOptions.width = 800;
    imageOptions.height = 600;
    canvasBehaviour.drawThrows = new Error("IndexSizeError");

    await expect(
      getCroppedBlob("data:image/png;base64,x", { x: 0, y: 0, width: 400, height: 0 }, 0, 600, 600),
    ).rejects.toThrow("IndexSizeError");
  });
});

describe("getCroppedBlob - kodowanie wyniku", () => {
  it("domyślnie zapisuje JPEG w jakości 0,92", async () => {
    imageOptions.width = 800;
    imageOptions.height = 600;
    const blob = await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600);

    expect(lastToBlobArgs).toEqual({ type: "image/jpeg", quality: 0.92 });
    expect(blob).toBeInstanceOf(Blob);
  });

  it("przekazuje jawnie podany typ i jakość", async () => {
    imageOptions.width = 800;
    imageOptions.height = 600;
    await getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600, "image/webp", 0.5);

    expect(lastToBlobArgs).toEqual({ type: "image/webp", quality: 0.5 });
  });

  it("odrzuca obietnicę, gdy kodowanie nie oddaje blobu", async () => {
    imageOptions.width = 800;
    imageOptions.height = 600;
    canvasBehaviour.toBlobFails = true;

    await expect(
      getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600),
    ).rejects.toThrow("toBlob failed");
  });
});

describe("getCroppedBlob - ścieżki błędu", () => {
  it("rzuca, gdy canvas rotacji nie daje kontekstu 2D", async () => {
    imageOptions.width = 800;
    imageOptions.height = 600;
    canvasBehaviour.nullContextAt = [0];

    await expect(
      getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600),
    ).rejects.toThrow("no 2d ctx");
  });

  it("rzuca, gdy canvas WYJŚCIOWY nie daje kontekstu 2D", async () => {
    // Osobna gałąź i osobna linia - drugi `getContext` bywa pomijany przez
    // testy sprawdzające tylko pierwszy.
    imageOptions.width = 800;
    imageOptions.height = 600;
    canvasBehaviour.nullContextAt = [1];

    await expect(
      getCroppedBlob("data:image/png;base64,x", AVATAR_CROP, 0, 600, 600),
    ).rejects.toThrow("no 2d ctx");
  });

  it("rzuca, gdy źródło się nie ładuje", async () => {
    imageOptions.fail = true;

    await expect(
      getCroppedBlob("https://cdn.example/brak.png", AVATAR_CROP, 0, 600, 600),
    ).rejects.toThrow("image load failed");
  });

  it("ustawia crossOrigin=anonymous, bo inaczej zdalne zdjęcie skaża canvas", async () => {
    // Bez tego `toBlob` na obrazie z CDN-a rzuca SecurityError i kadrowanie
    // każdego zdalnego zdjęcia pada - regresja niewidoczna na plikach lokalnych.
    imageOptions.width = 800;
    imageOptions.height = 600;
    await getCroppedBlob("https://cdn.example/a.png", AVATAR_CROP, 0, 600, 600);

    expect(lastImage?.crossOrigin).toBe("anonymous");
  });
});

describe("getImageDimensions", () => {
  it("czyta wymiary NATURALNE, nie wyświetlane", async () => {
    // `width`/`height` na elemencie <img> to rozmiar w layoucie; tolerancja
    // proporcji musi patrzeć na rzeczywistą rozdzielczość pliku.
    imageOptions.width = 100;
    imageOptions.height = 100;
    imageOptions.naturalWidth = 4000;
    imageOptions.naturalHeight = 3000;

    expect(await getImageDimensions("data:image/png;base64,x")).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it("odrzuca obietnicę dla źródła, którego nie da się wczytać", async () => {
    imageOptions.fail = true;
    await expect(getImageDimensions("https://cdn.example/brak.png")).rejects.toThrow(
      "image load failed",
    );
  });
});

describe("readFileAsDataUrl", () => {
  it("oddaje zawartość pliku jako data URL", async () => {
    const file = new File(["abc"], "a.png", { type: "image/png" });
    const url = await readFileAsDataUrl(file);
    expect(url.startsWith("data:")).toBe(true);
  });

  it("odrzuca obietnicę, gdy odczyt pliku pada", async () => {
    class FailingReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("FileReader", FailingReader);

    await expect(readFileAsDataUrl(new File(["x"], "a.png"))).rejects.toThrow("read failed");
  });

  it("nie wywraca się na pustym wyniku odczytu", async () => {
    // `String(null)` daje "null" - brzydko, ale nie rzuca. Pin, żeby zmiana na
    // odrzucenie obietnicy była decyzją, a nie efektem ubocznym.
    class NullReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("FileReader", NullReader);

    expect(await readFileAsDataUrl(new File(["x"], "a.png"))).toBe("null");
  });
});
