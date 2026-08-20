import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  focusBlockEditable,
  requestBlockFocus,
  reapplyPendingBlockFocus,
} from "@/lib/blocks/focus";

// Przenoszenie karetki działa na DOM celowo (bloki mają różne implementacje pól),
// więc jego gałęzie to głównie „elementu jeszcze nie ma" i „offset poza treścią".
// Ramię „nie ma" NIE jest błędem, tylko sygnałem do PONOWIENIA - jeśli zwróci
// `true` przez pomyłkę, świeżo wstawiony blok zostaje bez karetki i redaktor
// musi kliknąć, żeby pisać dalej.

function mountHost(id: string, inner: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-block-id", id);
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("focusBlockEditable - brak elementu", () => {
  it("brak HOSTA bloku zwraca false (wołający ponawia)", () => {
    expect(focusBlockEditable("b_nieistnieje", "end")).toBe(false);
  });

  it("host BEZ pola edytowalnego zwraca false (pole montuje się później)", () => {
    mountHost("b_1", "<div>sam podgląd</div>");
    expect(focusBlockEditable("b_1", "end")).toBe(false);
  });

  it("host, który SAM jest polem edytowalnym, jest używany bez szukania w środku", () => {
    const el = document.createElement("div");
    el.setAttribute("data-block-id", "b_self");
    el.setAttribute("contenteditable", "true");
    el.textContent = "treść";
    document.body.appendChild(el);
    expect(focusBlockEditable("b_self", "end")).toBe(true);
    expect(document.activeElement).toBe(el);
  });

  it("marker [data-block-editable] będący SAM polem jest używany wprost", () => {
    mountHost("b_m", '<textarea data-block-editable="true">x</textarea>');
    expect(focusBlockEditable("b_m", "end")).toBe(true);
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("marker BEZ pola w środku zwraca false, nie sięga poza marker", () => {
    mountHost(
      "b_m2",
      '<div data-block-editable="true"><span>nieedytowalne</span></div><textarea>obce</textarea>',
    );
    expect(focusBlockEditable("b_m2", "end")).toBe(false);
  });

  it.each([
    ['<input type="text" value="abc">', "INPUT"],
    ['<input value="abc">', "INPUT"],
    ["<textarea>abc</textarea>", "TEXTAREA"],
    ['<div contenteditable="true">abc</div>', "DIV"],
  ])("rozpoznaje pole %s jako %s", (inner, tagName) => {
    mountHost("b_f", inner);
    expect(focusBlockEditable("b_f", "end")).toBe(true);
    expect(document.activeElement?.tagName).toBe(tagName);
  });
});

describe("focusBlockEditable - pola formularza", () => {
  it.each([
    ["end", 3],
    ["start", 0],
    [1, 1],
  ] as const)("umiejscowienie %s daje offset %i w textarea", (pos, expected) => {
    mountHost("b_t", "<textarea>abc</textarea>");
    focusBlockEditable("b_t", pos);
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(expected);
  });

  it("offset POWYŻEJ długości treści jest klampowany na koniec", () => {
    mountHost("b_t", "<textarea>abc</textarea>");
    focusBlockEditable("b_t", 99);
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(3);
  });

  it("offset UJEMNY jest klampowany na zero", () => {
    mountHost("b_t", "<textarea>abc</textarea>");
    focusBlockEditable("b_t", -5);
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(0);
  });

  it("pole PUSTE przyjmuje offset 0 bez błędu", () => {
    mountHost("b_t", "<textarea></textarea>");
    expect(focusBlockEditable("b_t", "end")).toBe(true);
  });

  it("pole, które RZUCA na setSelectionRange, nadal dostaje sam fokus", () => {
    mountHost("b_t", '<input type="text" value="abc">');
    const input = document.querySelector("input") as HTMLInputElement;
    vi.spyOn(input, "setSelectionRange").mockImplementation(() => {
      throw new Error("input type nie wspiera selekcji");
    });
    expect(focusBlockEditable("b_t", "end")).toBe(true);
    expect(document.activeElement).toBe(input);
  });
});

describe("focusBlockEditable - contentEditable", () => {
  it("offset znakowy trafia w węzeł tekstowy", () => {
    mountHost("b_ce", '<div contenteditable="true">abcdef</div>');
    expect(focusBlockEditable("b_ce", 3)).toBe(true);
    const sel = window.getSelection();
    expect(sel?.rangeCount).toBe(1);
    expect(sel?.getRangeAt(0).startOffset).toBe(3);
  });

  it("offset przechodzi przez KILKA węzłów tekstowych (punkt złączenia po scaleniu)", () => {
    mountHost("b_ce", '<div contenteditable="true">abc<b>def</b>ghi</div>');
    focusBlockEditable("b_ce", 5);
    const sel = window.getSelection();
    // 5 = 3 znaki pierwszego węzła + 2 znaki wnętrza <b>.
    expect(sel?.getRangeAt(0).startOffset).toBe(2);
  });

  it("offset POZA treścią ląduje na końcu zawartości", () => {
    mountHost("b_ce", '<div contenteditable="true">abc</div>');
    expect(focusBlockEditable("b_ce", 99)).toBe(true);
    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  it("offset UJEMNY jest klampowany na zero", () => {
    mountHost("b_ce", '<div contenteditable="true">abc</div>');
    focusBlockEditable("b_ce", -3);
    expect(window.getSelection()?.getRangeAt(0).startOffset).toBe(0);
  });

  it("pole BEZ węzłów tekstowych ląduje na końcu zawartości, nie rzuca", () => {
    mountHost("b_ce", '<div contenteditable="true"><br></div>');
    expect(focusBlockEditable("b_ce", 2)).toBe(true);
  });

  it.each(["start", "end"] as const)("umiejscowienie %s zwija zakres w contentEditable", (pos) => {
    mountHost("b_ce", '<div contenteditable="true">abc</div>');
    expect(focusBlockEditable("b_ce", pos)).toBe(true);
    expect(window.getSelection()?.getRangeAt(0).collapsed).toBe(true);
  });

  it("brak API selekcji nie wywala funkcji - zwraca true po samym fokusie", () => {
    mountHost("b_ce", '<div contenteditable="true">abc</div>');
    vi.spyOn(window, "getSelection").mockReturnValue(null);
    expect(focusBlockEditable("b_ce", "end")).toBe(true);
  });

  it("brak API selekcji przy offsecie znakowym też nie wywala", () => {
    mountHost("b_ce", '<div contenteditable="true">abc</div>');
    vi.spyOn(window, "getSelection").mockReturnValue(null);
    expect(focusBlockEditable("b_ce", 1)).toBe(true);
  });
});

describe("requestBlockFocus - ponawianie przez klatki", () => {
  it("trafia od razu, gdy blok już jest w DOM", () => {
    mountHost("b_now", "<textarea>abc</textarea>");
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    requestBlockFocus("b_now", "end");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    // Jedno wywołanie - brak ponowień, bo pierwsza próba się udała.
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("PONAWIA, dopóki blok się nie zamontuje", () => {
    let frame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      frame += 1;
      if (frame === 3) mountHost("b_late", "<textarea>abc</textarea>");
      cb(frame);
      return frame;
    });
    requestBlockFocus("b_late", "end");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("przerywa po wyczerpaniu limitu prób, gdy blok się nigdy nie zamontuje", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    requestBlockFocus("b_nigdy", "end");
    // Pierwsze wywołanie + 29 ponowień = 30 prób (MAX_ATTEMPTS).
    expect(raf).toHaveBeenCalledTimes(30);
  });

  it("NOWSZE żądanie przejmuje karetkę - stara pętla wygasa bez fokusu", () => {
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    requestBlockFocus("b_stary", "end");
    requestBlockFocus("b_nowy", "end");
    mountHost("b_stary", "<textarea>stary</textarea>");
    mountHost("b_nowy", '<input type="text" value="nowy">');
    // Odpalamy pętlę STAREGO żądania - musi się wycofać, bo pendingFocus wskazuje nowe.
    queue[0](0);
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    queue[1](0);
    expect(document.activeElement?.tagName).toBe("INPUT");
  });
});

describe("reapplyPendingBlockFocus", () => {
  it("BEZ oczekującego żądania nic nie robi", () => {
    mountHost("b_x", "<textarea>abc</textarea>");
    reapplyPendingBlockFocus("b_x");
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  it("dla INNEGO bloku niż oczekujący nic nie robi", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    requestBlockFocus("b_a", "end");
    mountHost("b_b", "<textarea>abc</textarea>");
    reapplyPendingBlockFocus("b_b");
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  it("nakłada oczekujący fokus ponownie (po setContent edytora inline)", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    requestBlockFocus("b_c", 2);
    mountHost("b_c", "<textarea>abcdef</textarea>");
    reapplyPendingBlockFocus("b_c");
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(2);
  });

  it("żądanie PRZEDAWNIONE jest porzucane, nie nakładane", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    // Zegar sterowany jawnie - żadnego czekania i żadnego Date.now() w asercjach.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
    requestBlockFocus("b_d", "end");
    // TTL oczekującego fokusu to 800 ms - przesuwamy zegar poza to okno.
    vi.setSystemTime(new Date("2026-08-19T10:00:01.000Z"));
    mountHost("b_d", "<textarea>abc</textarea>");
    reapplyPendingBlockFocus("b_d");
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  it("po porzuceniu przedawnionego żądania kolejne wywołanie też nic nie robi", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
    requestBlockFocus("b_e", "end");
    vi.setSystemTime(new Date("2026-08-19T10:00:02.000Z"));
    mountHost("b_e", "<textarea>abc</textarea>");
    reapplyPendingBlockFocus("b_e");
    reapplyPendingBlockFocus("b_e");
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });
});
