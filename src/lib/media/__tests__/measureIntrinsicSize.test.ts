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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureIntrinsicSize } from "@/lib/media/measureIntrinsicSize";
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

beforeEach(() => {
  ProbeStub.instances = [];
  vi.stubGlobal("Image", ProbeStub);
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
