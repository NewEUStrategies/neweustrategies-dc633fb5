// Ruch karty prelegenta (FLIP na Web Animations API) - bez przegladarki.
//
// TESTUJEMY ARYTMETYKE I STRAZNIKI, NIE KLATKI. Karta ma rysowac sie tak samo
// na serwerze i w pierwszym renderze klienta, a ruch odgrywac tylko tam, gdzie
// silnik go umie - wiec kazda funkcja musi przezyc brak `CSS.supports`,
// `matchMedia`, `Element.animate` i konstruktora `Image` bez rzutu.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SPEAKER_CARD_MOTION_MS,
  SPEAKER_CARD_RADIUS_PX,
  SPEAKER_CARD_SPRING,
  SPEAKER_CARD_SPRING_FALLBACK,
  boxOf,
  flipHeightKeyframes,
  flipMediaKeyframes,
  flipShiftKeyframes,
  playKeyframes,
  prefersReducedMotion,
  preloadImage,
  speakerCardEasing,
  type FlipBox,
} from "@/lib/events/speakerCardMotion";

function box(over: Partial<FlipBox> = {}): FlipBox {
  return { top: 0, left: 0, width: 80, height: 80, ...over };
}

/** Wlasnosc ustawiona na obiekcie na czas jednego testu, zwijana w `afterEach`. */
const restorers: Array<() => void> = [];

function defineOn(target: object, key: string, value: unknown): void {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restorers.push(() => {
    if (previous === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, previous);
  });
}

afterEach(() => {
  while (restorers.length > 0) restorers.pop()?.();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stale ruchu", () => {
  it("czas, promien i obie krzywe maja wartosci ze specyfikacji karty", () => {
    expect(SPEAKER_CARD_MOTION_MS).toBe(440);
    expect(SPEAKER_CARD_RADIUS_PX).toBe(6);
    expect(SPEAKER_CARD_SPRING.startsWith("linear(0, ")).toBe(true);
    expect(SPEAKER_CARD_SPRING.endsWith(", 1)")).toBe(true);
    expect(SPEAKER_CARD_SPRING_FALLBACK).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("sprezyna ma lekki przestrzal ponad 1, ale nie odbija ponizej zera", () => {
    const samples = SPEAKER_CARD_SPRING.slice("linear(".length, -1)
      .split(",")
      .map((value) => Number(value.trim()));
    expect(samples.every((value) => Number.isFinite(value))).toBe(true);
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.05);
    expect(Math.min(...samples)).toBe(0);
  });
});

describe("speakerCardEasing", () => {
  it("silnik z `linear()` dostaje sprezyne i pytany jest o te wlasnie skladnie", () => {
    const supports = vi.fn(() => true);
    vi.stubGlobal("CSS", { supports });
    expect(speakerCardEasing()).toBe(SPEAKER_CARD_SPRING);
    expect(supports).toHaveBeenCalledWith("transition-timing-function", "linear(0, 1)");
  });

  it("silnik bez `linear()` dostaje krzywa awaryjna", () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => false) });
    expect(speakerCardEasing()).toBe(SPEAKER_CARD_SPRING_FALLBACK);
  });

  it("rzut z `CSS.supports` nie wychodzi poza funkcje - krzywa awaryjna", () => {
    vi.stubGlobal("CSS", {
      supports: () => {
        throw new Error("brak parsera");
      },
    });
    expect(speakerCardEasing()).toBe(SPEAKER_CARD_SPRING_FALLBACK);
  });

  it("brak obiektu `CSS` (serwer) daje krzywa awaryjna", () => {
    vi.stubGlobal("CSS", undefined);
    expect(speakerCardEasing()).toBe(SPEAKER_CARD_SPRING_FALLBACK);
  });

  it("`CSS` bez funkcji `supports` daje krzywa awaryjna", () => {
    vi.stubGlobal("CSS", {});
    expect(speakerCardEasing()).toBe(SPEAKER_CARD_SPRING_FALLBACK);
  });
});

describe("prefersReducedMotion", () => {
  it("czyta zapytanie o ograniczenie ruchu i oddaje jego wynik", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    defineOn(window, "matchMedia", matchMedia);
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("brak preferencji to pelny ruch", () => {
    defineOn(window, "matchMedia", () => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it("silnik bez `matchMedia` nie ogranicza ruchu", () => {
    defineOn(window, "matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("rzut z `matchMedia` nie wychodzi poza funkcje", () => {
    defineOn(window, "matchMedia", () => {
      throw new Error("zly selektor");
    });
    expect(prefersReducedMotion()).toBe(false);
  });

  it("bez `window` (render serwerowy) oddaje false bez rzutu", () => {
    vi.stubGlobal("window", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("boxOf", () => {
  it("brak elementu to brak pudelka", () => {
    expect(boxOf(null)).toBeNull();
    expect(boxOf(undefined)).toBeNull();
  });

  it("oddaje wylacznie polozenie i rozmiar z `getBoundingClientRect`", () => {
    const element = document.createElement("div");
    defineOn(element, "getBoundingClientRect", () => ({
      top: 12,
      left: 34,
      width: 80,
      height: 96,
      x: 34,
      y: 12,
      right: 114,
      bottom: 108,
      toJSON: () => ({}),
    }));
    expect(boxOf(element)).toStrictEqual({ top: 12, left: 34, width: 80, height: 96 });
  });
});

describe("flipMediaKeyframes", () => {
  it("powiekszenie: start w starym pudelku, skala < 1 i promien kontr-skalowany", () => {
    const first = box({ top: 10, left: 20, width: 80, height: 80 });
    const last = box({ top: 0, left: 0, width: 320, height: 320 });
    expect(flipMediaKeyframes(first, last)).toStrictEqual([
      {
        transformOrigin: "0 0",
        transform: "translate(20px, 10px) scale(0.25)",
        borderRadius: "24px",
      },
      {
        transformOrigin: "0 0",
        transform: "translate(0px, 0px) scale(1)",
        borderRadius: "6px",
      },
    ]);
  });

  it("zwiniecie: skala > 1 zmniejsza promien CSS, zeby na ekranie zostalo 6 px", () => {
    const first = box({ top: 0, left: 0, width: 320, height: 320 });
    const last = box({ top: 16, left: 24, width: 80, height: 80 });
    const frames = flipMediaKeyframes(first, last);
    expect(frames?.[0]).toStrictEqual({
      transformOrigin: "0 0",
      transform: "translate(-24px, -16px) scale(4)",
      borderRadius: "1.5px",
    });
    expect(frames?.[1].borderRadius).toBe(`${SPEAKER_CARD_RADIUS_PX}px`);
  });

  it("promien na ekranie (CSS razy skala) jest staly w pierwszej klatce", () => {
    const first = box({ width: 100 });
    const last = box({ left: 5, width: 250 });
    const frames = flipMediaKeyframes(first, last);
    const scale = 100 / 250;
    const radius = Number.parseFloat(String(frames?.[0].borderRadius));
    expect(radius * scale).toBeCloseTo(SPEAKER_CARD_RADIUS_PX, 10);
  });

  it("samo przesuniecie bez zmiany rozmiaru zostawia skale 1 i promien 6 px", () => {
    const frames = flipMediaKeyframes(box({ top: 40, left: 0 }), box({ top: 0, left: 0 }));
    expect(frames?.[0]).toStrictEqual({
      transformOrigin: "0 0",
      transform: "translate(0px, 40px) scale(1)",
      borderRadius: "6px",
    });
  });

  it("sama zmiana rozmiaru w tym samym rogu nadal jest ruchem", () => {
    const frames = flipMediaKeyframes(box({ width: 80 }), box({ width: 160 }));
    expect(frames?.[0].transform).toBe("translate(0px, 0px) scale(0.5)");
    expect(frames?.[0].borderRadius).toBe("12px");
  });

  it("brak zmiany pudelka to brak animacji", () => {
    expect(flipMediaKeyframes(box(), box())).toBeNull();
  });

  it("drgniecia ponizej pol piksela i skali ponizej 0,001 nie sa ruchem", () => {
    const first = box({ top: 0.2, left: -0.4, width: 1000.4 });
    const last = box({ top: 0, left: 0, width: 1000 });
    expect(flipMediaKeyframes(first, last)).toBeNull();
  });

  it("przesuniecie o dokladnie pol piksela juz jest ruchem", () => {
    expect(flipMediaKeyframes(box({ left: 0.5 }), box())).not.toBeNull();
    expect(flipMediaKeyframes(box({ top: -0.5 }), box())).not.toBeNull();
  });

  it("zmiana skali o wiecej niz 0,001 przy tym samym rogu jest ruchem", () => {
    expect(flipMediaKeyframes(box({ width: 1002 }), box({ width: 1000 }))).not.toBeNull();
  });

  it("zerowa lub ujemna szerokosc (element ukryty) nie dzieli przez zero", () => {
    expect(flipMediaKeyframes(box({ width: 80 }), box({ width: 0 }))).toBeNull();
    expect(flipMediaKeyframes(box({ width: 0 }), box({ width: 80 }))).toBeNull();
    expect(flipMediaKeyframes(box({ width: -1 }), box({ width: 80 }))).toBeNull();
    expect(flipMediaKeyframes(box({ width: 80 }), box({ width: -1 }))).toBeNull();
  });
});

describe("flipShiftKeyframes", () => {
  it("przesuwa napis od starego polozenia do nowego", () => {
    expect(
      flipShiftKeyframes(box({ top: 100, left: 8 }), box({ top: 260, left: 16 })),
    ).toStrictEqual([
      { transform: "translate(-8px, -160px)" },
      { transform: "translate(0px, 0px)" },
    ]);
  });

  it("zmiana samego rozmiaru nie jest przesunieciem", () => {
    expect(flipShiftKeyframes(box({ width: 80 }), box({ width: 320, height: 40 }))).toBeNull();
  });

  it("brak ruchu i drgniecia ponizej pol piksela daja null", () => {
    expect(flipShiftKeyframes(box(), box())).toBeNull();
    expect(flipShiftKeyframes(box({ top: 0.3, left: 0.49 }), box())).toBeNull();
  });

  it("wystarczy ruch w jednej osi", () => {
    expect(flipShiftKeyframes(box({ left: 3 }), box())?.[0]).toStrictEqual({
      transform: "translate(3px, 0px)",
    });
    expect(flipShiftKeyframes(box({ top: -2 }), box())?.[0]).toStrictEqual({
      transform: "translate(0px, -2px)",
    });
  });
});

describe("flipHeightKeyframes", () => {
  it("wysokosc karty idzie od starej do nowej", () => {
    expect(flipHeightKeyframes(box({ height: 120 }), box({ height: 420 }))).toStrictEqual([
      { height: "120px" },
      { height: "420px" },
    ]);
  });

  it("zwiniecie tez animuje wysokosc (w dol)", () => {
    expect(flipHeightKeyframes(box({ height: 420 }), box({ height: 120 }))).toStrictEqual([
      { height: "420px" },
      { height: "120px" },
    ]);
  });

  it("ta sama wysokosc (albo roznica ponizej pol piksela) to brak animacji", () => {
    expect(flipHeightKeyframes(box({ height: 200 }), box({ height: 200 }))).toBeNull();
    expect(flipHeightKeyframes(box({ height: 200.3 }), box({ height: 200 }))).toBeNull();
  });

  it("przesuniecie i szerokosc nie wplywaja na wysokosc", () => {
    expect(
      flipHeightKeyframes(box({ top: 50, left: 50, width: 10 }), box({ width: 999 })),
    ).toBeNull();
  });
});

describe("playKeyframes", () => {
  const frames: Keyframe[] = [{ height: "10px" }, { height: "20px" }];

  function animatable(animate: unknown): HTMLElement {
    const element = document.createElement("div");
    defineOn(element, "animate", animate);
    return element;
  }

  it("odgrywa klatki z czasem karty i podana krzywa", () => {
    const animation = { id: "anim" } as unknown as Animation;
    const animate = vi.fn(() => animation);
    const element = animatable(animate);
    expect(playKeyframes(element, frames, "ease-out")).toBe(animation);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(frames, {
      duration: SPEAKER_CARD_MOTION_MS,
      easing: "ease-out",
    });
  });

  it("brak klatek (nic sie nie ruszylo) nie wola `animate`", () => {
    const animate = vi.fn();
    expect(playKeyframes(animatable(animate), null, SPEAKER_CARD_SPRING)).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("brak elementu (odmontowany ref) to brak animacji", () => {
    expect(playKeyframes(null, frames, SPEAKER_CARD_SPRING)).toBeNull();
    expect(playKeyframes(undefined, frames, SPEAKER_CARD_SPRING)).toBeNull();
  });

  it("silnik bez Web Animations API nie rzuca - karta zmienia sie bez ruchu", () => {
    expect(playKeyframes(animatable(undefined), frames, SPEAKER_CARD_SPRING)).toBeNull();
  });

  it("rzut z `animate` (np. nieznana krzywa) konczy sie null, nie wyjatkiem", () => {
    const element = animatable(() => {
      throw new TypeError("zla krzywa");
    });
    expect(playKeyframes(element, frames, "linear(zle)")).toBeNull();
  });
});

describe("preloadImage", () => {
  const created: Array<{ decoding: string; src: string }> = [];

  class RecordingImage {
    decoding = "";
    src = "";

    constructor() {
      created.push(this);
    }
  }

  afterEach(() => {
    created.length = 0;
  });

  it("rozgrzewa duzy kadr asynchronicznym dekodowaniem", () => {
    vi.stubGlobal("Image", RecordingImage);
    preloadImage("https://cdn.example/speaker-large.webp");
    expect(created).toHaveLength(1);
    expect(created[0].decoding).toBe("async");
    expect(created[0].src).toBe("https://cdn.example/speaker-large.webp");
  });

  it("brak adresu albo pusty adres niczego nie pobiera", () => {
    vi.stubGlobal("Image", RecordingImage);
    preloadImage(null);
    preloadImage("");
    expect(created).toHaveLength(0);
  });

  it("srodowisko bez konstruktora `Image` (serwer) przechodzi bez rzutu", () => {
    vi.stubGlobal("Image", undefined);
    expect(() => preloadImage("https://cdn.example/a.webp")).not.toThrow();
  });

  it("rzut z konstruktora obrazu nie wychodzi poza funkcje", () => {
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          throw new Error("brak DOM");
        }
      },
    );
    expect(() => preloadImage("https://cdn.example/a.webp")).not.toThrow();
  });
});
