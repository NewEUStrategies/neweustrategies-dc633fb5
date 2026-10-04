// Kolejka po pierwszej interakcji: kolejność klas, jedno zadanie na klatkę,
// zawsze po końcu gestu i po handlerach interakcji, `target` pod palcem na
// początku, tor pilny w mikrozadaniu, promise zadania trzyma kolejkę (z
// limitem), `postTask` z priorytetem klasy, karta w tle, odwołanie, wyjątki.
// Klatki sterowane ręcznie (`frame()`), makrozadania - fałszywymi zegarami,
// mikrozadania - prawdziwe (`flushMicrotasks()`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetFirstInteractionForTests, onFirstInteraction } from "../firstInteraction";
import {
  FRAME_FALLBACK_MS,
  GESTURE_FALLBACK_MS,
  QUEUE_PRIORITIES,
  TASK_SETTLE_CAP_MS,
  __resetPostInteractionQueueForTests,
  enqueue,
  watchGestures,
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

/** Pełne dotknięcie/kliknięcie: `pointerdown` -> `pointerup` -> `click`. */
function tap(target: EventTarget = window): void {
  interact(target, "pointerdown");
  interact(target, "pointerup");
  interact(target, "click");
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

    tap();
    expect(order).toEqual([]);

    for (let step = 1; step <= QUEUE_PRIORITIES.length; step += 1) {
      frame();
      expect(order).toHaveLength(step);
    }
    expect(order).toEqual([...QUEUE_PRIORITIES]);
    frame();
    expect(order).toHaveLength(QUEUE_PRIORITIES.length);
  });

  it("zadanie biegnie po CAŁYM geście (pointerdown -> pointerup -> click), po jego handlerach i po klatce", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const order: string[] = [];
    button.addEventListener("pointerdown", () => order.push("pointerdown"));
    button.addEventListener("click", () => order.push("click"));
    enqueue(() => order.push("zadanie"), { priority: "shell" });

    interact(button, "pointerdown");
    for (let i = 0; i < 5; i += 1) frame();
    // Wstrzymany krok czeka na timerze końca gestu, nie odpytuje klatek.
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(GESTURE_FALLBACK_MS - 50);
    frame();
    expect(order).toEqual(["pointerdown"]);

    interact(button, "pointerup");
    frame();
    expect(order).toEqual(["pointerdown"]);

    interact(button, "click");
    expect(order).toEqual(["pointerdown", "click"]);
    frame();
    expect(order).toEqual(["pointerdown", "click", "zadanie"]);
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

    tap(button);
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
    interact(input, "keyup");
    // Pole tekstowe nie dostaje `click` - gest kończy zapas po `keyup`.
    vi.advanceTimersByTime(GESTURE_FALLBACK_MS);
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

  it("przewinięcie (cel = dokument) niczego nie promuje i niczego nie wstrzymuje", () => {
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
    tap();

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
    tap(button);

    const order: string[] = [];
    enqueue(() => order.push("shell"), { priority: "shell" });
    enqueue(() => order.push("islandB"), { priority: "islands", target: islandB });
    enqueue(() => order.push("islandA"), { priority: "islands", target: islandA });
    for (let i = 0; i < 3; i += 1) frame();

    expect(order).toEqual(["islandA", "shell", "islandB"]);
  });

  it("promocja celu dotyczy wyłącznie PIERWSZEJ interakcji", () => {
    const islandA = document.createElement("section");
    const islandB = document.createElement("section");
    const button = document.createElement("button");
    islandB.append(button);
    document.body.append(islandA, islandB);
    onFirstInteraction(() => {});
    interact(document, "scroll");

    const order: string[] = [];
    enqueue(() => order.push("islandA"), { priority: "islands", target: islandA });
    enqueue(() => order.push("islandB"), { priority: "islands", target: islandB });
    tap(button);
    frame();
    frame();

    expect(order).toEqual(["islandA", "islandB"]);
  });

  it("interakcja zapisana wcześniej przez innego subskrybenta zwalnia wpis bez czekania", () => {
    onFirstInteraction(() => {});
    interact(document, "scroll");
    const task = vi.fn();
    enqueue(task, { priority: "islands" });
    frame();
    expect(task).toHaveBeenCalledOnce();
  });
});

describe("strażnik gestu", () => {
  it("podmiana powłoki (zadanie shell) nie zdejmuje przycisku przed click - delegowany click go widzi", () => {
    const shell = document.createElement("div");
    const accept = document.createElement("button");
    accept.dataset.consentAction = "accept";
    shell.append(accept);
    document.body.append(shell);
    const decisions: string[] = [];
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.isConnected && target.dataset.consentAction) {
        decisions.push(target.dataset.consentAction);
      }
    });
    enqueue(() => shell.replaceWith(document.createElement("div")), {
      priority: "shell",
      target: shell,
    });

    interact(accept, "pointerdown");
    for (let i = 0; i < 6; i += 1) frame();
    expect(accept.isConnected).toBe(true);

    interact(accept, "pointerup");
    frame();
    interact(accept, "click");
    expect(decisions).toEqual(["accept"]);
    frame();
    expect(accept.isConnected).toBe(false);
  });

  it("sam pointerdown (np. page.mouse.down() w e2e P1.1): zadanie po GESTURE_FALLBACK_MS", () => {
    const task = vi.fn();
    enqueue(task, { priority: "analytics" });

    interact(window, "pointerdown");
    vi.advanceTimersByTime(GESTURE_FALLBACK_MS - 1);
    frame();
    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    frame();
    expect(task).toHaveBeenCalledOnce();
    expect(performance.now()).toBeLessThan(1_000);
  });

  it("Spacja: keydown wstrzymuje, keyup czeka na click, click kończy gest; bez keyup - zapas", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const task = vi.fn();
    enqueue(task, { priority: "shell" });

    interact(button, "keydown");
    for (let i = 0; i < 4; i += 1) frame();
    interact(button, "keyup");
    frame();
    expect(task).not.toHaveBeenCalled();
    interact(button, "click");
    frame();
    expect(task).toHaveBeenCalledOnce();

    const second = vi.fn();
    enqueue(second, { priority: "shell" });
    interact(button, "keydown");
    vi.advanceTimersByTime(GESTURE_FALLBACK_MS - 1);
    frame();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    frame();
    expect(second).toHaveBeenCalledOnce();
  });

  it("Enter: click w trakcie keydown kończy gest od razu, keyup nic już nie wstrzymuje", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const task = vi.fn();
    enqueue(task, { priority: "shell" });

    interact(button, "keydown");
    interact(button, "click");
    frame();
    expect(task).toHaveBeenCalledOnce();

    const next = vi.fn();
    interact(button, "keyup");
    enqueue(next, { priority: "islands" });
    frame();
    expect(next).toHaveBeenCalledOnce();
  });

  it("autopowtórzenie trzymanego klawisza nie przedłuża wstrzymania", () => {
    const task = vi.fn();
    enqueue(task, { priority: "islands", release: "immediate" });
    interact(window, "keydown");
    vi.advanceTimersByTime(GESTURE_FALLBACK_MS - 50);
    window.dispatchEvent(new KeyboardEvent("keydown", { repeat: true }));
    vi.advanceTimersByTime(50);
    frame();
    expect(task).toHaveBeenCalledOnce();
  });

  it("pointerup bez click (przeciągnięcie): zadanie GESTURE_FALLBACK_MS po pointerup", () => {
    const task = vi.fn();
    enqueue(task, { priority: "islands" });
    interact(window, "pointerdown");
    vi.advanceTimersByTime(100);
    interact(window, "pointerup");
    vi.advanceTimersByTime(GESTURE_FALLBACK_MS - 1);
    frame();
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    frame();
    expect(task).toHaveBeenCalledOnce();
  });

  it("przewijanie palcem (pointercancel) kończy gest od razu; touchend po nim niczego nie wstrzymuje", () => {
    const task = vi.fn();
    enqueue(task, { priority: "islands" });
    interact(window, "pointerdown");
    interact(window, "touchstart");
    interact(window, "pointercancel");
    frame();
    expect(task).toHaveBeenCalledOnce();

    const next = vi.fn();
    interact(window, "touchend");
    enqueue(next, { priority: "islands" });
    frame();
    expect(next).toHaveBeenCalledOnce();
  });

  it("wheel nie wstrzymuje kolejki", () => {
    const task = vi.fn();
    enqueue(task, { priority: "analytics" });
    interact(window, "wheel");
    frame();
    expect(task).toHaveBeenCalledOnce();
  });

  it("dotyczy wszystkich wpisów: release immediate (IO, punkt ciszy) przy wciśniętym przycisku czeka na click", () => {
    const task = vi.fn();
    const stop = watchGestures();
    interact(window, "pointerdown");
    enqueue(task, { priority: "islands", release: "immediate" });
    for (let i = 0; i < 4; i += 1) frame();
    expect(task).not.toHaveBeenCalled();
    interact(window, "pointerup");
    interact(window, "click");
    frame();
    expect(task).toHaveBeenCalledOnce();
    stop();
  });

  it("wciśnięcie między zaplanowaniem kroku a jego startem też go wstrzymuje", () => {
    const task = vi.fn();
    enqueue(task, { priority: "islands", release: "immediate" });
    expect(frames).toHaveLength(1);
    interact(window, "pointerdown");
    frame();
    frame();
    expect(task).not.toHaveBeenCalled();
    interact(window, "pointerup");
    interact(window, "click");
    frame();
    expect(task).toHaveBeenCalledOnce();
  });

  it("zdarzenia wysłane skryptem (isTrusted === false) nie są gestem", () => {
    const task = vi.fn();
    enqueue(task, { priority: "islands", release: "immediate" });
    const synthetic = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(synthetic, "isTrusted", { value: false });
    window.dispatchEvent(synthetic);
    frame();
    expect(task).toHaveBeenCalledOnce();
  });

  it("nasłuch gestów żyje, dopóki kolejka ma wpisy albo watchGestures go trzyma", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const gestureCalls = (spy: typeof add | typeof remove) =>
      spy.mock.calls.filter(([type]) => type === "pointerup" || type === "click").length;

    enqueue(vi.fn(), { priority: "islands", release: "immediate" });
    expect(gestureCalls(add)).toBe(2);
    frame();
    expect(gestureCalls(remove)).toBe(2);

    const stop = watchGestures();
    expect(gestureCalls(add)).toBe(4);
    stop();
    stop();
    expect(gestureCalls(remove)).toBe(4);
  });
});

describe("tor pilny (release urgent)", () => {
  it("pointerdown na wyspie: zadanie island-target w pierwszym mikrozadaniu, bez klatki i mimo gestu", async () => {
    const island = document.createElement("section");
    const button = document.createElement("button");
    island.append(button);
    document.body.append(island);
    const open = vi.fn();
    island.addEventListener(
      "pointerdown",
      () => enqueue(open, { priority: "island-target", release: "urgent", target: island }),
      { capture: true },
    );

    interact(button, "pointerdown");
    expect(open).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(open).toHaveBeenCalledOnce();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("odwołany przed mikrozadaniem nie biegnie; wyjątek jest raportowany", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const cancelled = vi.fn();
    enqueue(cancelled, { priority: "island-target", release: "urgent" })();
    const failure = new Error("bramka");
    enqueue(
      () => {
        throw failure;
      },
      { priority: "shell", release: "urgent" },
    );
    await flushMicrotasks();
    expect(cancelled).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  it("promise zadania pilnego (hydratacja wyspy) wstrzymuje zwykły tor do rozstrzygnięcia", async () => {
    const hydration = deferred();
    const paced = vi.fn();
    enqueue(paced, { priority: "islands", release: "immediate" });
    enqueue(() => hydration.promise, { priority: "island-target", release: "urgent" });
    await flushMicrotasks();

    frame();
    frame();
    expect(paced).not.toHaveBeenCalled();
    hydration.resolve();
    await flushMicrotasks();
    frame();
    expect(paced).toHaveBeenCalledOnce();
  });
});

describe("zadanie zwracające promise", () => {
  it("promise wstrzymuje kolejkę: następne zadanie dopiero w klatce po rozstrzygnięciu", async () => {
    const mount = deferred();
    const order: string[] = [];
    enqueue(
      () => {
        order.push("shell:start");
        return mount.promise.then(() => {
          order.push("shell:done");
        });
      },
      { priority: "shell", release: "immediate" },
    );
    enqueue(() => order.push("analytics"), { priority: "analytics", release: "immediate" });

    frame();
    frame();
    frame();
    expect(order).toEqual(["shell:start"]);
    mount.resolve();
    await flushMicrotasks();
    expect(order).toEqual(["shell:start", "shell:done"]);
    frame();
    expect(order).toEqual(["shell:start", "shell:done", "analytics"]);
  });

  it("wiszący konsument nie zatrzymuje kolejki: limit TASK_SETTLE_CAP_MS", () => {
    const next = vi.fn();
    enqueue(() => new Promise<void>(() => {}), { priority: "shell", release: "immediate" });
    enqueue(next, { priority: "analytics", release: "immediate" });

    frame();
    vi.advanceTimersByTime(TASK_SETTLE_CAP_MS - 1);
    frame();
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    frame();
    expect(next).toHaveBeenCalledOnce();
  });

  it("odrzucenie jest raportowane i nie zatrzymuje kolejki", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("import banera");
    const next = vi.fn();
    enqueue(() => Promise.reject(failure), { priority: "shell", release: "immediate" });
    enqueue(next, { priority: "analytics", release: "immediate" });

    frame();
    await flushMicrotasks();
    expect(reportError).toHaveBeenCalledWith(failure);
    frame();
    expect(next).toHaveBeenCalledOnce();
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
  function stubScheduler(): { posted: Array<() => void>; postTask: ReturnType<typeof vi.fn> } {
    const posted: Array<() => void> = [];
    const postTask = vi.fn((callback: () => void) => {
      posted.push(callback);
      return Promise.resolve();
    });
    vi.stubGlobal("scheduler", { postTask });
    return { posted, postTask };
  }

  it("używa scheduler.postTask z priorytetem background dla wysp, nakładek i gtag", () => {
    const { posted, postTask } = stubScheduler();
    const task = vi.fn();
    enqueue(task, { priority: "islands", release: "immediate" });

    frame();
    expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: "background" });
    expect(task).not.toHaveBeenCalled();
    posted.shift()?.();
    expect(task).toHaveBeenCalledOnce();
  });

  it("shell, island-target i header schodzą z priorytetem user-visible", () => {
    const { posted, postTask } = stubScheduler();
    for (const priority of ["header", "island-target", "shell"] as const) {
      enqueue(vi.fn(), { priority, release: "immediate" });
      frame();
      expect(postTask).toHaveBeenLastCalledWith(expect.any(Function), {
        priority: "user-visible",
      });
      posted.shift()?.();
    }
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
    tap();
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
    const urgent = enqueue(task, { priority: "island-target", release: "urgent" });
    const stop = watchGestures();
    expect(() => cancel()).not.toThrow();
    expect(() => urgent()).not.toThrow();
    expect(() => stop()).not.toThrow();
    expect(task).not.toHaveBeenCalled();
  });
});
