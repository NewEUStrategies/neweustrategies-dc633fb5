// `prepareOgImageFile` - warstwa przeglądarkowa karty społecznościowej.
// Do 18.08.2026: cała ta funkcja bez pokrycia (sąsiedni test obejmuje wyłącznie
// czyste reguły MIME, wymiarów i planu kompresji).
//
// DLACZEGO TO WAŻNE. To jest jedyne miejsce, w którym plik og:image jest
// WALIDOWANY i SKOMPRESOWANY przed wgraniem. Konsekwencje błędu widać poza
// serwisem: karta linku na Facebooku, LinkedInie i Slacku jest budowana raz
// i cache'owana po ich stronie, więc źle przygotowany obrazek zostaje na długo.
//
// Test podstawia atrapy `createImageBitmap` i canvasu - happy-dom nie ma ani
// jednego, ani drugiego, a i tak nie o piksele tu chodzi, tylko o KOLEJNOŚĆ
// decyzji: odrzucić, przeskalować, skompresować, czy oddać oryginał.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OG_MAX_BYTES, prepareOgImageFile, type OgPrepareResult } from "@/lib/media/ogImage";

interface Behaviour {
  /** Wymiary oddawane przez dekoder. */
  width: number;
  height: number;
  /** Gdy true, dekodowanie pliku pada. */
  decodeFails: boolean;
  /** Gdy true, canvas nie oddaje kontekstu 2D. */
  noContext: boolean;
  /** Rozmiary kolejnych blobów zwracanych przez kodowanie. */
  blobSizes: number[];
  /** Gdy true, `toBlob` oddaje null (porażka kodowania). */
  encodeFails: boolean;
}

const b: Behaviour = {
  width: 1200,
  height: 630,
  decodeFails: false,
  noContext: false,
  blobSizes: [1000],
  encodeFails: false,
};

let closedBitmaps = 0;
let encodeCalls: Array<{ mime?: string; quality?: number }> = [];
let drawnSize: { width: number; height: number } | null = null;

function makeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  Object.assign(b, {
    width: 1200,
    height: 630,
    decodeFails: false,
    noContext: false,
    blobSizes: [1000],
    encodeFails: false,
  });
  closedBitmaps = 0;
  encodeCalls = [];
  drawnSize = null;

  vi.stubGlobal("createImageBitmap", async () => {
    if (b.decodeFails) throw new Error("nie da się zdekodować");
    return {
      width: b.width,
      height: b.height,
      close: () => {
        closedBitmaps += 1;
      },
    };
  });

  let encodeIndex = 0;
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") throw new Error(`nieoczekiwany element: ${tag}`);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        b.noContext
          ? null
          : {
              drawImage: (_src: unknown, _x: number, _y: number, w: number, h: number) => {
                drawnSize = { width: w, height: h };
              },
            },
      toBlob: (cb: (blob: Blob | null) => void, mime?: string, quality?: number) => {
        encodeCalls.push({ mime, quality });
        if (b.encodeFails) return cb(null);
        const size = b.blobSizes[Math.min(encodeIndex, b.blobSizes.length - 1)];
        encodeIndex += 1;
        // Blob musi mieć PRAWDZIWĄ długość: `new File([blob], …)` przelicza
        // rozmiar z zawartości, więc podmieniony getter `size` nie przeszedłby
        // do pliku wynikowego i test mierzyłby fikcję.
        cb(new Blob([new Uint8Array(size)], { type: mime }));
      },
    };
    return canvas as unknown as HTMLElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Skrót: przygotowanie pliku o zadanych parametrach. */
function prepare(
  opts: { name?: string; type?: string; size?: number } = {},
): Promise<OgPrepareResult> {
  return prepareOgImageFile(
    makeFile(opts.name ?? "karta.jpg", opts.type ?? "image/jpeg", opts.size ?? 500_000),
  );
}

describe("prepareOgImageFile - odrzucenia", () => {
  it("ODRZUCA nieobsługiwany typ PRZED dekodowaniem", () => {
    // Dekodowanie pliku, którego i tak nie przyjmiemy, to zmarnowana pamięć
    // przeglądarki na dużym pliku.
    return prepare({ type: "image/svg+xml" }).then((out) => {
      expect(out.file).toBeNull();
      expect(out.issues[0]).toMatchObject({ code: "mime_unsupported", severity: "error" });
      expect(out.bytesAfter).toBe(0);
    });
  });

  it("ODRZUCA plik, którego nie da się zdekodować", () => {
    // Uszkodzony albo podmieniony plik z poprawnym nagłówkiem MIME.
    b.decodeFails = true;
    return prepare().then((out) => {
      expect(out.file).toBeNull();
      expect(out.issues[0]).toMatchObject({ code: "dimensions_mismatch", severity: "error" });
    });
  });

  it("ODRZUCA obrazek o złej proporcji i ZWALNIA zdekodowaną bitmapę", () => {
    // Bez `close()` każda odrzucona próba zostawia pełną bitmapę w pamięci -
    // przy kilku podejściach redaktora to setki megabajtów.
    b.width = 1200;
    b.height = 1200;
    return prepare().then((out) => {
      expect(out.file).toBeNull();
      expect(out.issues.at(-1)).toMatchObject({ code: "dimensions_mismatch" });
      expect(closedBitmaps).toBe(1);
    });
  });

  it("ODRZUCA obrazek mniejszy niż karta docelowa", () => {
    b.width = 600;
    b.height = 315;
    return prepare().then((out) => {
      expect(out.file).toBeNull();
      expect(out.issues.at(-1)).toMatchObject({ code: "dimensions_too_small" });
    });
  });
});

describe("prepareOgImageFile - konwersja i skalowanie", () => {
  it("format wymagający konwersji przechodzi z OSTRZEŻENIEM, nie błędem", () => {
    // AVIF wyświetli się w przeglądarce, ale scraper Facebooka go nie odczyta -
    // dlatego konwertujemy, zamiast odrzucać pracę redaktora.
    b.blobSizes = [1000];
    return prepare({ type: "image/avif", name: "karta.avif" }).then((out) => {
      expect(out.file).not.toBeNull();
      expect(out.issues[0]).toMatchObject({ code: "mime_converted", severity: "warning" });
    });
  });

  it("SKALUJE zbyt szeroki obrazek do 1200 px i ostrzega", () => {
    b.width = 2400;
    b.height = 1260;
    b.blobSizes = [1000];
    return prepare().then((out) => {
      expect(drawnSize).toEqual({ width: 1200, height: 630 });
      expect(out.issues.some((i) => i.code === "dimensions_downscaled")).toBe(true);
    });
  });

  it("PNG jest zapisywany jako PNG - przezroczystość przetrwa", () => {
    // Konwersja logotypu z alfą na JPEG dałaby czarne tło w karcie linku.
    b.blobSizes = [1000];
    return prepare({ type: "image/png", name: "logo.png" }).then((out) => {
      expect(encodeCalls[0].mime).toBe("image/png");
      expect(out.file?.name).toBe("logo.png");
    });
  });

  it("pozostałe formaty lądują jako JPEG z rozszerzeniem .jpg", () => {
    b.blobSizes = [1000];
    return prepare({ name: "karta.webp", type: "image/webp" }).then((out) => {
      expect(encodeCalls[0].mime).toBe("image/jpeg");
      expect(out.file?.name).toBe("karta.jpg");
    });
  });

  it("plik bez nazwy dostaje nazwę zastępczą", () => {
    b.blobSizes = [1000];
    return prepare({ name: ".jpg" }).then((out) => {
      expect(out.file?.name).toBe("og-card.jpg");
    });
  });
});

describe("prepareOgImageFile - schodkowa kompresja", () => {
  it("PRZERYWA po pierwszej jakości mieszczącej się w limicie", () => {
    // Każde kolejne kodowanie to pełny przebieg po pikselach - zbędne, gdy
    // wynik już jest wystarczająco lekki.
    b.blobSizes = [1000];
    return prepare().then(() => {
      expect(encodeCalls).toHaveLength(1);
    });
  });

  it("SCHODZI niżej z jakością, dopóki plik nie zmieści się w limicie", () => {
    b.blobSizes = [OG_MAX_BYTES + 1, OG_MAX_BYTES + 1, 1000];
    return prepare().then(() => {
      expect(encodeCalls).toHaveLength(3);
      const qualities = encodeCalls.map((c) => c.quality ?? 0);
      // Jakość musi MALEĆ - rosnąca nie zmniejszyłaby pliku.
      for (let i = 1; i < qualities.length; i += 1) {
        expect(qualities[i]).toBeLessThan(qualities[i - 1]);
      }
    });
  });

  it("ostrzega, gdy nawet najniższa jakość nie mieści się w limicie", () => {
    b.blobSizes = [OG_MAX_BYTES + 5, OG_MAX_BYTES + 4, OG_MAX_BYTES + 3];
    return prepare({ size: 5_000_000 }).then((out) => {
      expect(out.file).not.toBeNull();
      expect(out.issues.some((i) => i.code === "file_too_large")).toBe(true);
    });
  });

  it("ODDAJE ORYGINAŁ, gdy kompresja go nie zmniejszyła", () => {
    // Zamiana pliku na WIĘKSZY byłaby optymalizacją w złą stronę.
    b.blobSizes = [900_000];
    return prepare({ size: 500_000, name: "karta.jpg" }).then((out) => {
      expect(out.file?.name).toBe("karta.jpg");
      expect(out.bytesAfter).toBe(500_000);
      expect(out.bytesBefore).toBe(500_000);
    });
  });

  it("ODDAJE ORYGINAŁ, gdy kodowanie w ogóle się nie powiodło", () => {
    b.encodeFails = true;
    return prepare({ size: 100_000 }).then((out) => {
      expect(out.file).not.toBeNull();
      expect(out.bytesAfter).toBe(100_000);
    });
  });

  it("ODDAJE ORYGINAŁ, gdy przeglądarka nie daje kontekstu 2D", () => {
    // Fail-open jest tu świadomy: lepiej wgrać niezoptymalizowany obrazek niż
    // zablokować redaktorowi publikację.
    b.noContext = true;
    return prepare({ size: 100_000 }).then((out) => {
      expect(out.file).not.toBeNull();
      expect(out.bytesAfter).toBe(100_000);
      expect(closedBitmaps).toBe(1);
    });
  });

  it("raportuje wagę PRZED i PO optymalizacji", () => {
    // Ta para trafia wprost do komunikatu w panelu - to jedyny sygnał, że
    // optymalizacja w ogóle coś dała.
    b.blobSizes = [120_000];
    return prepare({ size: 500_000 }).then((out) => {
      expect(out.bytesBefore).toBe(500_000);
      expect(out.bytesAfter).toBe(120_000);
    });
  });

  it("ZWALNIA bitmapę także na ścieżce udanej", () => {
    b.blobSizes = [1000];
    return prepare().then(() => {
      expect(closedBitmaps).toBe(1);
    });
  });
});
