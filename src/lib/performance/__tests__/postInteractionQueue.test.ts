// Kolejka po pierwszej interakcji: kolejność klas, jedno zadanie na klatkę,
// zawsze po handlerach interakcji, `target` pod palcem na początku,
// `postTask(background)`, karta w tle, odwołanie, izolacja wyjątków.
// Klatki sterowane ręcznie (`frame()`), makrozadania - fałszywymi zegarami.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFirstInteractionForTests, onFirstInteraction } from "../firstInteraction";
import {
  FRAME_FALLBACK_MS,
  QUEUE_PRIORITIES,
  __resetPostInteractionQueueForTests,
  enqueue,
} from "../postInteractionQueue";

let frames: FrameRequestCallback[] = [];

/** Jedna klatka: callbacki rAF, potem makrozadanie `setTimeout(0)` kroku. */
function frame(): void {
  const pending = frames;
  frames = [];
  for (const callback of pending) callback(performance.now());
  vi.advanceTimersByTime(0);
}

function interact(target: EventTarget = window, type = "pointerdown"): void {
  target.dispatchEvent(new Event(type, { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  __resetFirstInteractionForTests();
  __resetPostInteractionQueueForTests();
});

afterEach(() => {
  __resetPostInteractionQueueForTests();
  __resetFirstInteractionForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("zwolnienie po pierwszej interakcji", () => {
  it("nic nie biegnie przed pierwszą interakcją - ani po klatkach, ani po czasie", () => {
    const task = vi.fn();
    enqueue(task, { priority: "shell" });
    enqueue(task, { priority: "analytics" });

    frame();
    vi.advanceTimersByTime(30_000);
    frame();

    expect(task).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("po interakcji: kolejność klas i JEDNO zadanie na klatkę, gtag (analytics) ostatni", () => {
    const order: string[] = [];
    for (const priority of [
      "analytics",
      "islands",
      "shell",
      "overlays",
      "header",
      "island-target",
    ]) {
      enqueue(() => order.push(priority), {
        priority: QUEUE_PRIORITIES.find((candidate) => candidate === priority) ?? "analytics",
      });
    }

    interact();
    expect(order).toEqual([]);

    for (let step = 1; step <= QUEUE_PRIORITIES.length; step += 1) {
      frame();
      expect(order).toHaveLength(step);
    }
    expect(order).toEqual([...QUEUE_PRIORITIES]);
    frame();
    expect(order).toHaveLength(QUEUE_PRIORITIES.length);
  });

  it("zadanie biegnie zawsze po własnych handlerach interakcji i po klatce, nie w dyspozycji zdarzenia", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const order: string[] = [];
    button.addEventListener("pointerdown", () => order.push("handler"));
    enqueue(() => order.push("zadanie"), { priority: "shell" });

    interact(button);
    expect(order).toEqual(["handler"]);
    vi.advanceTimersByTime(0);
    expect(order).toEqual(["handler"]);
    frame();
    expect(order).toEqual(["handler", "zadanie"]);
  });

  it("wpis z target zawierającym event.target wskakuje na początek; trafione zachowują porządek klas", () => {
    const shellRoot = document.createElement("div");
    const header = document.createElement("header");
    const islandA = document.createElement("section");
    const islandB = document.createElement("section");
    const button = document.createElement("button");
    islandA.append(button);
    header.append(islandA);
    document.body.append(shellRoot, header, islandB);

    const order: string[] = [];
    enqueue(() => order.push("shell"), { priority: "shell", target: shellRoot });
    enqueue(() => order.push("islandB"), { priority: "islands", target: islandB });
    enqueue(() => order.push("islandA"), { priority: "islands", target: islandA });
    enqueue(() => order.push("header"), { priority: "header", target: header });
    enqueue(() => order.push("gtag"), { priority: "analytics" });

    interact(button);
    for (let i = 0; i < 5; i += 1) frame();

    expect(order).toEqual(["header", "islandA", "shell", "islandB", "gtag"]);
  });

  it("klawiatura: wyspa z fokusem (cel keydown) też wskakuje na początek", () => {
    const island = document.createElement("section");
    const input = document.createElement("input");
    island.append(input);
    document.body.append(island);
    const order: string[] = [];
    enqueue(() => order.push("shell"), { priority: "shell" });
    enqueue(() => order.push("wyspa"), { priority: "islands", target: island });

    interact(input, "keydown");
    frame();
    frame();

    expect(order).toEqual(["wyspa", "shell"]);
  });

  it("autoodtwarzana karuzela (scroll elementu) nie zwalnia kolejki", () => {
    const track = document.createElement("div");
    document.body.append(track);
    const task = vi.fn();
    enqueue(task, { priority: "analytics" });

    track.dispatchEvent(new Event("scroll"));
    frame();
    vi.advanceTimersByTime(30_000);
    frame();

    expect(task).not.toHaveBeenCalled();
  });

  it("przewinięcie (cel = dokument) niczego nie promuje", () => {
    const island = document.createElement("section");
    document.body.append(island);
    const order: string[] = [];
    enqueue(() => order.push("wyspa"), { priority: "islands", target: island });
    enqueue(() => order.push("shell"), { priority: "shell" });

    interact(document, "scroll");
    frame();
    frame();

    expect(order).toEqual(["shell", "wyspa"]);
  });

  it("wpis dodany po interakcji jest zwolniony od razu, a dodany w trakcie opróżniania wchodzi na swoje miejsce", () => {
    const order: string[] = [];
    enqueue(() => order.push("overlays"), { priority: "overlays" });
    enqueue(
      () => {
        order.push("shell");
        enqueue(() => order.push("header"), { priority: "header" });
      },
      { priority: "shell" },
    );
    interact();

    frame();
    expect(order).toEqual(["shell"]);
    frame();
    expect(order).toEqual(["shell", "header"]);
    frame();
    expect(order).toEqual(["shell", "header", "overlays"]);

    enqueue(() => order.push("analytics"), { priority: "analytics" });
    frame();
    expect(order).toEqual(["shell", "header", "overlays", "analytics"]);
  });

  it("wpisy dodane po interakcji też są porządkowane jej celem (wyspa pod palcem pierwsza)", () => {
    const islandA = document.createElement("section");
    const islandB = document.createElement("section");
    const button = document.createElement("button");
    islandA.append(button);
    document.body.append(islandA, islandB);
    onFirstInteraction(() => {});
    interact(button);

    const order: string[] = [];
    enqueue(() => order.push("shell"), { priority: "shell" });
    enqueue(() => order.push("islandB"), { priority: "islands", target: islandB });
    enqueue(() => order.push("islandA"), { priority: "islands", target: islandA });
    for (let i = 0; i < 3; i += 1) frame();

    expect(order).toEqual(["islandA", "shell", "islandB"]);
  });

  it("interakcja zapisana wcześniej przez innego subskrybenta zwalnia wpis bez czekania", () => {
    onFirstInteraction(() => {});
    interact();
    const task = vi.fn();
    enqueue(task, { priority: "islands" });
    frame();
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("zwolnienie natychmiastowe (punkt ciszy, IntersectionObserver)", () => {
  it("release immediate biegnie bez interakcji, nadal jedno zadanie na klatkę i w porządku klas", () => {
    const order: string[] = [];
    enqueue(() => order.push("analytics"), { priority: "analytics", release: "immediate" });
    enqueue(() => order.push("overlays"), { priority: "overlays", release: "immediate" });
    const waiting = vi.fn();
    enqueue(waiting, { priority: "shell" });

    expect(order).toEqual([]);
    frame();
    expect(order).toEqual(["overlays"]);
    frame();
    expect(order).toEqual(["overlays", "analytics"]);
    frame();
    expect(waiting).not.toHaveBeenCalled();
  });
});

describe("planowanie kroku", () => {
  it("używa scheduler.postTask z priorytetem background, gdy API istnieje", () => {
    const posted: Array<() => void> = [];
    const postTask = vi.fn((callback: () => void) => {
      posted.push(callback);
      return Promise.resolve();
    });
    vi.stubGlobal("scheduler", { postTask });
    const task = vi.fn();
    enqueue(task, { priority: "islands", release: "immediate" });

    frame();
    expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: "background" });
    expect(task).not.toHaveBeenCalled();
    posted.shift()?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it("bez Scheduler API schodzi przez setTimeout(0) po klatce", () => {
    const timeout = vi.spyOn(window, "setTimeout");
    const task = vi.fn();
    enqueue(task, { priority: "islands", release: "immediate" });
    const [callback] = frames;
    frames = [];
    callback(performance.now());
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 0);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledOnce();
  });

  it("w ukrytej karcie nie czeka na rAF (nie przychodzi), schodzi makrozadaniem", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const task = vi.fn();
    enqueue(task, { priority: "analytics", release: "immediate" });
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledOnce();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("gdy klatka nie przychodzi mimo widocznej karty, idzie dalej po FRAME_FALLBACK_MS", () => {
    const task = vi.fn();
    enqueue(task, { priority: "analytics", release: "immediate" });
    vi.advanceTimersByTime(FRAME_FALLBACK_MS - 1);
    expect(task).not.toHaveBeenCalled();
    // Zapas klatki + zagnieżdżony `setTimeout(0)` (fałszywe zegary liczą mu 1 ms).
    vi.advanceTimersByTime(2);
    expect(task).toHaveBeenCalledOnce();
    // Spóźniona klatka nie uruchamia niczego drugi raz.
    frame();
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("odwołanie i wyjątki", () => {
  it("odwołany wpis nie biegnie; odwołanie po starcie jest nieszkodliwe", () => {
    const cancelled = vi.fn();
    const kept = vi.fn();
    const cancel = enqueue(cancelled, { priority: "shell" });
    const cancelKept = enqueue(kept, { priority: "islands" });
    cancel();
    interact();
    frame();
    frame();
    expect(cancelled).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
    expect(() => cancelKept()).not.toThrow();
  });

  it("odwołanie ostatniego czekającego wpisu zdejmuje wspólny nasłuch interakcji", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const cancel = enqueue(vi.fn(), { priority: "overlays" });
    cancel();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointerdown", "keydown", "touchstart", "scroll", "wheel"]),
    );
  });

  it("wyjątek zadania nie zatrzymuje kolejki", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("zadanie");
    const next = vi.fn();
    enqueue(
      () => {
        throw failure;
      },
      { priority: "shell", release: "immediate" },
    );
    enqueue(next, { priority: "islands", release: "immediate" });

    frame();
    expect(reportError).toHaveBeenCalledWith(failure);
    frame();
    expect(next).toHaveBeenCalledOnce();
  });

  it("na serwerze (brak window) jest no-opem", () => {
    vi.stubGlobal("window", undefined);
    const task = vi.fn();
    const cancel = enqueue(task, { priority: "shell", release: "immediate" });
    expect(() => cancel()).not.toThrow();
    expect(task).not.toHaveBeenCalled();
  });
});
