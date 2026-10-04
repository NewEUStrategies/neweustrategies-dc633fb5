// Pierwsza interakcja: jeden współdzielony nasłuch (capture + passive),
// tylko zdarzenia zaufane, dostarczenie raz, spóźnieni subskrybenci, lepka
// aktywacja, SSR.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIRST_INTERACTION_EVENTS,
  __resetFirstInteractionForTests,
  getFirstInteraction,
  onFirstInteraction,
} from "../firstInteraction";

const flushMicrotasks = () => Promise.resolve();

/** happy-dom nie ma `navigator.userActivation` - definiujemy go na czas testu. */
function stubUserActivation(hasBeenActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    get: () => ({ hasBeenActive, isActive: false }),
  });
}

function listenerCalls(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter(([type]) =>
    FIRST_INTERACTION_EVENTS.some((candidate) => candidate === type),
  );
}

beforeEach(() => {
  __resetFirstInteractionForTests();
});

afterEach(() => {
  __resetFirstInteractionForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userActivation");
  document.body.innerHTML = "";
});

describe("onFirstInteraction", () => {
  it.each(["pointerdown", "keydown", "touchstart", "wheel"])(
    "%s jest pierwszą interakcją i niesie typ, cel oraz znacznik czasu",
    (type) => {
      const button = document.createElement("button");
      document.body.append(button);
      const callback = vi.fn();
      onFirstInteraction(callback);

      button.dispatchEvent(new Event(type, { bubbles: true }));

      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0][0]).toMatchObject({ type, target: button });
      expect(typeof callback.mock.calls[0][0].timeStamp).toBe("number");
      expect(getFirstInteraction()).toMatchObject({ type, target: button });
    },
  );

  it("przewinięcie dokumentu (także przeciągnięcie paska) jest pierwszą interakcją", () => {
    const callback = vi.fn();
    onFirstInteraction(callback);

    // Przewinięcie widoku: zdarzenie na `document`, bąbelkuje do `window`.
    document.dispatchEvent(new Event("scroll", { bubbles: true }));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toMatchObject({ type: "scroll", target: document });
  });

  it("przewinięcie ELEMENTU (programowe scrollTo autoodtwarzanej karuzeli) nie jest interakcją", () => {
    const track = document.createElement("div");
    document.body.append(track);
    const callback = vi.fn();
    onFirstInteraction(callback);

    // `scroll` elementu nie bąbelkuje, ale dociera do capture na `window`.
    track.dispatchEvent(new Event("scroll"));
    expect(callback).not.toHaveBeenCalled();
    expect(getFirstInteraction()).toBeNull();

    track.dispatchEvent(new Event("wheel", { bubbles: true }));
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toMatchObject({ type: "wheel", target: track });
  });

  it("zdarzenie wysłane skryptem (isTrusted === false) nie jest interakcją", () => {
    const callback = vi.fn();
    onFirstInteraction(callback);
    for (const type of ["pointerdown", "keydown", "wheel"]) {
      const synthetic = new Event(type, { bubbles: true });
      Object.defineProperty(synthetic, "isTrusted", { value: false });
      window.dispatchEvent(synthetic);
    }
    const scroll = new Event("scroll", { bubbles: true });
    Object.defineProperty(scroll, "isTrusted", { value: false });
    document.dispatchEvent(scroll);
    expect(callback).not.toHaveBeenCalled();
    expect(getFirstInteraction()).toBeNull();

    // Zaufane (w przeglądarce `true`; atrapa happy-dom nie ma pola) - liczy się.
    window.dispatchEvent(new Event("pointerdown"));
    expect(callback).toHaveBeenCalledOnce();
  });

  it("inne zdarzenia (mousemove, click) nie są pierwszą interakcją", () => {
    const callback = vi.fn();
    onFirstInteraction(callback);
    window.dispatchEvent(new Event("mousemove"));
    window.dispatchEvent(new Event("click"));
    expect(callback).not.toHaveBeenCalled();
    expect(getFirstInteraction()).toBeNull();
  });

  it("wszyscy subskrybenci dzielą JEDEN komplet nasłuchów w fazie capture i pasywnych", () => {
    const add = vi.spyOn(window, "addEventListener");
    onFirstInteraction(vi.fn());
    onFirstInteraction(vi.fn());
    onFirstInteraction(vi.fn());

    const calls = listenerCalls(add);
    expect(calls.map(([type]) => type)).toEqual([...FIRST_INTERACTION_EVENTS]);
    for (const [, , options] of calls) {
      expect(options).toMatchObject({ capture: true, passive: true });
    }
  });

  it("handler strony zatrzymujący propagację nie ukrywa interakcji (capture na window jest pierwszy)", () => {
    const link = document.createElement("a");
    document.body.append(link);
    const order: string[] = [];
    link.addEventListener("pointerdown", (event) => {
      order.push("strona");
      event.stopPropagation();
    });
    onFirstInteraction(() => order.push("subskrybent"));

    link.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(order).toEqual(["subskrybent", "strona"]);
  });

  it("dostarcza raz i zdejmuje nasłuchy po pierwszej interakcji", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const callback = vi.fn();
    onFirstInteraction(callback);

    document.dispatchEvent(new Event("scroll", { bubbles: true }));
    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("keydown"));

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0].type).toBe("scroll");
    expect(listenerCalls(remove).map(([type]) => type)).toEqual([...FIRST_INTERACTION_EVENTS]);
  });

  it("odpięcie ostatniego subskrybenta przed interakcją zdejmuje nasłuchy", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const cancelFirst = onFirstInteraction(first);
    const cancelSecond = onFirstInteraction(second);

    cancelFirst();
    expect(listenerCalls(remove)).toHaveLength(0);
    cancelSecond();
    cancelSecond();
    expect(listenerCalls(remove)).toHaveLength(FIRST_INTERACTION_EVENTS.length);

    window.dispatchEvent(new Event("pointerdown"));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("spóźniony subskrybent dostaje zapisaną interakcję w mikrozadaniu, po zwróceniu odpięcia", async () => {
    onFirstInteraction(vi.fn());
    window.dispatchEvent(new Event("keydown"));

    const late = vi.fn();
    onFirstInteraction(late);
    expect(late).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(late).toHaveBeenCalledOnce();
    expect(late.mock.calls[0][0].type).toBe("keydown");

    const cancelled = vi.fn();
    onFirstInteraction(cancelled)();
    await flushMicrotasks();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("wyjątek jednego subskrybenta nie zatrzymuje pozostałych", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("subskrybent");
    const after = vi.fn();
    onFirstInteraction(() => {
      throw failure;
    });
    onFirstInteraction(after);

    window.dispatchEvent(new Event("touchstart"));

    expect(after).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  it("lepka aktywacja sprzed subskrypcji (klik przed hydratacją) dostarcza sygnał od razu", async () => {
    stubUserActivation(true);
    const callback = vi.fn();
    onFirstInteraction(callback);
    expect(callback).not.toHaveBeenCalled();

    await flushMicrotasks();

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0][0]).toMatchObject({ type: "activation", target: null });
    expect(getFirstInteraction()?.type).toBe("activation");
  });

  it("bez lepkiej aktywacji nic nie przychodzi samo", async () => {
    stubUserActivation(false);
    const callback = vi.fn();
    onFirstInteraction(callback);
    await flushMicrotasks();
    expect(callback).not.toHaveBeenCalled();
  });

  it("cel trzymany słabo: getFirstInteraction zwraca żywy węzeł, także bez WeakRef (stary silnik)", async () => {
    for (const weakRef of [true, false]) {
      __resetFirstInteractionForTests();
      const button = document.createElement("button");
      document.body.append(button);
      const event = new Event("pointerdown", { bubbles: true });
      const callback = vi.fn();
      onFirstInteraction(callback);

      // happy-dom sam używa `WeakRef` (np. getter `body`), więc atrapę „starego
      // silnika" zakładamy wyłącznie na czas dyspozycji zdarzenia.
      if (!weakRef) vi.stubGlobal("WeakRef", undefined);
      button.dispatchEvent(event);
      vi.unstubAllGlobals();

      expect(callback.mock.calls[0][0].target).toBe(button);
      expect(getFirstInteraction()?.target).toBe(button);
      const late = vi.fn();
      onFirstInteraction(late);
      await flushMicrotasks();
      expect(late.mock.calls[0][0].target).toBe(button);
    }
  });

  it("na serwerze (brak window) jest no-opem", () => {
    vi.stubGlobal("window", undefined);
    const cancel = onFirstInteraction(vi.fn());
    expect(typeof cancel).toBe("function");
    expect(() => cancel()).not.toThrow();
    expect(getFirstInteraction()).toBeNull();
  });
});
