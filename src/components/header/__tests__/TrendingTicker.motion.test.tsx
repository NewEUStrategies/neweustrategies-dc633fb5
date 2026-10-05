// Pasek „Na czasie" przy starcie strony (P2.3, F9-F11 z diagnozy P0.5).
//
// Przypinane kontrakty:
//  F11 - re-render paska z identycznym tekstem arkuszy (zmiana porcji wpisów co
//        `intervalSec`) nie dotyka bloków `<style>`: dawniej każdy re-render
//        przepisywał `innerHTML` 300-liniowego arkusza (`ParseHTML` w commicie,
//        K12) i przeliczał style;
//  F10 - nieskończony ruch ozdobny (płomień, `live`, `ribbon`) rusza dopiero po
//        pierwszej interakcji albo w punkcie ciszy: przy starcie korzeń paska
//        nie ma `data-tt-motion`, a płomień nie trzyma warstwy (`will-change`);
//  F9  - klatki `tt-flip` animują wyłącznie `transform`/`opacity` (oś obrotu
//        stoi w regule `.tt-anim-flip`), więc animacja wejścia może iść na
//        kompozytorze.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import "@/lib/i18n";
import { __resetFirstInteractionForTests } from "@/lib/performance/firstInteraction";
import { __resetPostInteractionQueueForTests } from "@/lib/performance/postInteractionQueue";

const feed = vi.hoisted(() => ({
  posts: [1, 2, 3, 4].map((n) => ({
    id: `p${n}`,
    slug: `p${n}`,
    title_pl: `Wpis ${n}`,
    title_en: `Post ${n}`,
  })),
}));
const quiet = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));

vi.mock("@/lib/views/headerTickerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/views/headerTickerQuery")>()),
  headerTickerQueryOptions: () => ({
    queryKey: ["header-ticker-motion"],
    queryFn: () => Promise.resolve(feed.posts),
  }),
}));
vi.mock("@/lib/performance/whenQuiescent", () => ({
  onQuiescent: (task: () => unknown) => {
    quiet.tasks.push(task);
    return () => {
      quiet.tasks = quiet.tasks.filter((entry) => entry !== task);
    };
  },
}));

const { TrendingTicker } = await import("@/components/header/TrendingTicker");

let frames: FrameRequestCallback[] = [];

/** Klatka kolejki P0.3: rAF, makrozadanie kroku, praca Reacta. */
async function frame(): Promise<void> {
  await act(async () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(performance.now());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function ticker(props: Record<string, unknown>): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <TrendingTicker {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  frames = [];
  quiet.tasks = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
});

describe("pasek „Na czasie” przy starcie strony (P2.3)", () => {
  it("F11: zmiana porcji wpisów nie przepisuje bloków <style>", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { container } = render(
      ticker({ mode: "flip", intervalSec: 2, visibleCount: 1, iconAnimation: "flicker" }),
    );
    await screen.findByText("Wpis 1");
    const styles = Array.from(container.querySelectorAll("style"));
    expect(styles.length).toBeGreaterThanOrEqual(2);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    for (const style of styles) {
      observer.observe(style, { childList: true, characterData: true, subtree: true });
    }
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("Wpis 2")).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    observer.disconnect();
    expect(mutations).toEqual([]);
    for (const style of styles) expect(style.isConnected).toBe(true);
  });

  it("F10: ruch ozdobny dopiero po pierwszej interakcji", async () => {
    render(ticker({ mode: "flip", iconAnimation: "flicker" }));
    await screen.findByText("Wpis 1");
    const root = screen.getByTestId("trending-ticker");
    expect(root.hasAttribute("data-tt-motion")).toBe(false);
    await frame();
    expect(root.hasAttribute("data-tt-motion")).toBe(false);

    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      window.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    for (let i = 0; i < 4 && !root.hasAttribute("data-tt-motion"); i += 1) await frame();
    expect(root.getAttribute("data-tt-motion")).toBe("");
  });

  it("F10: bez interakcji ruch rusza w punkcie ciszy", async () => {
    render(ticker({ mode: "flip", iconAnimation: "pulse" }));
    await screen.findByText("Wpis 1");
    const root = screen.getByTestId("trending-ticker");
    expect(root.hasAttribute("data-tt-motion")).toBe(false);
    expect(quiet.tasks.length).toBeGreaterThan(0);
    await act(async () => {
      for (const task of quiet.tasks.splice(0)) task();
    });
    expect(root.getAttribute("data-tt-motion")).toBe("");
  });

  it("F9/F10: klatki wejścia i płomień w arkuszu paska", async () => {
    const { container } = render(ticker({ mode: "flip", iconAnimation: "flicker" }));
    await screen.findByText("Wpis 1");
    const css = Array.from(container.querySelectorAll("style"), (s) => s.textContent ?? "").join(
      "\n",
    );
    const flip = /@keyframes tt-flip\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? "";
    expect(flip).toContain("transform:");
    // W klatkach tylko właściwości kompozytora.
    const properties = Array.from(flip.matchAll(/([a-z-]+)\s*:/g), (m) => m[1]);
    expect(new Set(properties)).toEqual(new Set(["opacity", "transform"]));
    // Płomień nie trzyma warstwy kompozytora przez całe życie strony.
    const flame = /\.tt-flame\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(flame).not.toContain("will-change");
    // Animacja płomienia tylko pod atrybutem ruchu.
    expect(css).not.toMatch(/(^|\n)\s*\.tt-flame-flicker\s*\{/);
  });
});
