// Bramka ruchu (P3.5) na wspólnym zatrzasku: `useMotionGate()` daje `false` do
// otwarcia, a otwarcie ustawia `data-motion="on"` na `<html>` - poza Reactem,
// przed re-renderem konsumentów; `useMotionGate(false)` niczego nie uzbraja;
// serwer i hydratacja bez atrybutu i bez rozjazdu. Pauzę animacji w CSS do
// otwarcia sprawdza prawdziwa przeglądarka (e2e `motion-gate.boot-home`).
// Wideo za bramką: wyciszone `play()` dopiero po otwarciu (wariant tła: tylko
// przy viewporcie), a do otwarcia pierwsza klatka przez fragment `#t=`
// (iOS), chyba że jest plakat albo własny fragment adresu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { useRef } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";

import { __resetFirstInteractionForTests } from "../firstInteraction";
import { __resetPostInteractionQueueForTests } from "../postInteractionQueue";

const quiet = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));

vi.mock("../whenQuiescent", () => ({
  onQuiescent: (task: () => unknown) => {
    quiet.tasks.push(task);
    return () => {
      quiet.tasks = quiet.tasks.filter((candidate) => candidate !== task);
    };
  },
}));

const { onInteractionOrQuiet } = await import("../interactionOrQuiet");
const {
  __openMotionGateForTests,
  __resetMotionGateForTests,
  firstFrameVideoSrc,
  useGatedVideoAutoplay,
  useMotionGate,
} = await import("../motionGate");

const html = document.documentElement;
let container: HTMLDivElement;
let root: Root | null = null;

function reachQuiet(): void {
  for (const task of quiet.tasks.splice(0)) task();
}

function Probe({ enabled, seen }: { enabled?: boolean; seen?: Array<string | null> }) {
  const motion = useMotionGate(enabled);
  // Co widzi render z otwartą bramką: atrybut ma już stać.
  if (motion) seen?.push(html.getAttribute("data-motion"));
  return (
    <span data-motion-loop="" data-state={motion ? "on" : "off"}>
      {motion ? "ruch" : "stop"}
    </span>
  );
}

function mount(element: React.ReactElement): void {
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
}

beforeEach(() => {
  quiet.tasks = [];
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
  __resetMotionGateForTests();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  __resetMotionGateForTests();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
});

describe("bramka ruchu", () => {
  it("do otwarcia false i bez atrybutu; otwarcie ustawia data-motion=on przed re-renderem", () => {
    const seen: Array<string | null> = [];
    mount(<Probe seen={seen} />);
    expect(container.textContent).toBe("stop");
    expect(html.hasAttribute("data-motion")).toBe(false);
    act(() => reachQuiet());
    expect(container.textContent).toBe("ruch");
    expect(html.getAttribute("data-motion")).toBe("on");
    expect(seen).toEqual(["on"]);
  });

  it("`useMotionGate(false)` niczego nie uzbraja i nie ustawia atrybutu", () => {
    mount(<Probe enabled={false} />);
    expect(quiet.tasks).toHaveLength(0);
    act(() => __openMotionGateForTests());
    expect(container.textContent).toBe("stop");
    expect(html.hasAttribute("data-motion")).toBe(false);
  });

  it("zatrzask otwarty wcześniej przez innego konsumenta: pierwszy hook ruchu dopisuje atrybut", async () => {
    onInteractionOrQuiet(vi.fn());
    reachQuiet();
    expect(html.hasAttribute("data-motion")).toBe(false);
    mount(<Probe />);
    expect(container.textContent).toBe("ruch");
    await act(async () => {
      await Promise.resolve();
    });
    expect(html.getAttribute("data-motion")).toBe("on");
  });

  it("serwer i hydratacja: bramka zamknięta w HTML, bez rozjazdu i bez atrybutu przed otwarciem", () => {
    const markup = renderToString(<Probe />);
    expect(markup).toContain('data-state="off"');
    container.innerHTML = markup;
    const errors: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, <Probe />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector("span")?.getAttribute("data-state")).toBe("off");
    expect(html.hasAttribute("data-motion")).toBe(false);
    act(() => reachQuiet());
    expect(container.querySelector("span")?.getAttribute("data-state")).toBe("on");
    expect(html.getAttribute("data-motion")).toBe("on");
  });
});

describe("wideo za bramką", () => {
  it("`firstFrameVideoSrc`: fragment pierwszej klatki tylko bez plakatu i bez własnego fragmentu", () => {
    expect(firstFrameVideoSrc("https://cdn.example.com/a.mp4")).toBe(
      "https://cdn.example.com/a.mp4#t=0.001",
    );
    expect(
      firstFrameVideoSrc("https://cdn.example.com/a.mp4", "https://cdn.example.com/p.jpg"),
    ).toBe("https://cdn.example.com/a.mp4");
    expect(firstFrameVideoSrc("https://cdn.example.com/a.mp4#t=5")).toBe(
      "https://cdn.example.com/a.mp4#t=5",
    );
  });

  function Video({
    enabled = true,
    inViewOnly = false,
  }: {
    enabled?: boolean;
    inViewOnly?: boolean;
  }) {
    const ref = useRef<HTMLVideoElement | null>(null);
    useGatedVideoAutoplay(ref, enabled, "https://cdn.example.com/a.mp4", inViewOnly);
    return <video ref={ref} />;
  }

  function stubMedia() {
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    return { play, pause };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("wyciszone play() dopiero po otwarciu bramki", () => {
    const { play } = stubMedia();
    mount(<Video />);
    expect(play).not.toHaveBeenCalled();
    act(() => reachQuiet());
    expect(play).toHaveBeenCalledOnce();
    expect(container.querySelector("video")?.muted).toBe(true);
  });

  it("`enabled === false`: nie uzbraja bramki i nie gra", () => {
    const { play } = stubMedia();
    mount(<Video enabled={false} />);
    expect(quiet.tasks).toHaveLength(0);
    act(() => __openMotionGateForTests());
    expect(play).not.toHaveBeenCalled();
  });

  it("`inViewOnly`: obserwator dopiero po otwarciu, gra w kadrze i pauzuje poza nim", () => {
    const { play, pause } = stubMedia();
    const observed: Element[] = [];
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    mount(<Video inViewOnly />);
    act(() => notify([{ isIntersecting: true }]));
    expect(observed).toHaveLength(0);
    expect(play).not.toHaveBeenCalled();

    act(() => reachQuiet());
    expect(observed).toEqual([container.querySelector("video")]);
    act(() => notify([{ isIntersecting: true }]));
    expect(play).toHaveBeenCalledOnce();
    act(() => notify([{ isIntersecting: false }]));
    expect(pause).toHaveBeenCalledOnce();
  });
});
