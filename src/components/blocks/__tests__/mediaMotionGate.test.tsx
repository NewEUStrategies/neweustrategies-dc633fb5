// Bloki z ruchem w treści wpisu a bramka ruchu (P3.5): karuzela obrazów i
// hero wideo nie ruszają przy pierwszym malowaniu (w środku śladu
// Lighthouse'a), tylko po pierwszej interakcji albo w punkcie ciszy strony
// (tu atrapa). Karuzela: pierwszy przeskok pełny interwał po otwarciu; wideo:
// HTML bez atrybutu `autoplay`, wyciszone `play()` po otwarciu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { ImageCarouselView } from "@/components/blocks/MarketingViews";
import { VideoHeroView } from "@/components/blocks/ConversionViews";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";

// Punkt ciszy bramki ruchu tylko na żądanie testu.
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetMotionGateForTests();
});

const slides = [1, 2, 3].map((n) => ({
  url: `https://cdn.example.com/${n}.jpg`,
  alt: `Kadr ${n}`,
}));
/** Indeks widocznego slajdu (ukryte mają `aria-hidden="true"`). */
const visible = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[aria-hidden]")).findIndex(
    (el) => el.getAttribute("aria-hidden") === "false",
  );

describe("ImageCarouselView", () => {
  it("stoi 30 s przed otwarciem bramki; pierwszy przeskok pełny interwał po otwarciu", () => {
    vi.useFakeTimers();
    const { container } = render(<ImageCarouselView items={slides} autoplay interval={2000} />);
    expect(visible(container)).toBe(0);
    // Krokami po sekundzie: skok 30 s mógłby wrócić na pierwszy slajd po pełnych obrotach.
    for (let second = 0; second < 30; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(visible(container)).toBe(0);
    }
    act(() => __openMotionGateForTests());
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(visible(container)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(visible(container)).toBe(1);
  });
});

describe("VideoHeroView", () => {
  it("HTML z serwera nie ma atrybutu autoplay", () => {
    const html = renderToString(<VideoHeroView src="https://cdn.example.com/hero.mp4" />);
    expect(html).toContain("<video");
    expect(html).not.toMatch(/autoplay/i);
  });

  it("wyciszone play() dopiero po otwarciu bramki; `autoplay={false}` nie gra wcale", () => {
    const play = vi.fn(() => Promise.resolve());
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    try {
      const { container } = render(<VideoHeroView src="https://cdn.example.com/hero.mp4" />);
      const video = container.querySelector("video") as HTMLVideoElement;
      expect(play).not.toHaveBeenCalled();
      act(() => __openMotionGateForTests());
      expect(play).toHaveBeenCalledOnce();
      expect(video.muted).toBe(true);

      play.mockClear();
      render(<VideoHeroView src="https://cdn.example.com/hero.mp4" autoplay={false} />);
      expect(play).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(HTMLMediaElement.prototype, "play", original);
    }
  });
});
