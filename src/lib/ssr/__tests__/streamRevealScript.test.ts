// @vitest-environment happy-dom
//
// `STREAM_REVEAL_SCRIPT` (lib/ssr/streamRevealScript.ts) na PRAWDZIWYM runtime Fizz Reacta:
// tekst `$RB/$RV/$RC` jest wycinany z zainstalowanego `react-dom-server`, więc zmiana runtime'u
// w kolejnej wersji Reacta (inna zmienna czasu, inne dławienie) oblewa ten test zamiast po
// cichu przywrócić szkielety na ekranie po FCP.
//
// i18n: brak treści dla użytkownika - narzędzie wydajności.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STREAM_REVEAL_SCRIPT } from "@/lib/ssr/streamRevealScript";

const require = createRequire(import.meta.url);

/** `completeBoundaryScriptFunctionOnly` z serwera Reacta: `$RB=[];$RV=…;$RC=…`. */
function reactRevealRuntime(): string {
  // Ścieżka spoza `exports` pakietu: plik CJS obok `package.json` zainstalowanego react-dom.
  const file = join(
    dirname(require.resolve("react-dom/package.json")),
    "cjs/react-dom-server.edge.production.js",
  );
  const match = /'(\$RB=\[\];\$RV=function[^']*)'/.exec(readFileSync(file, "utf8"));
  if (!match) throw new Error("brak runtime'u $RC w react-dom-server - zmienił się kształt Fizz");
  return (0, eval)(`'${match[1]}'`) as string;
}

/** Skrypt powłoki Reacta (`shellTimeRuntimeScript`) - ustawia `$RT` w pierwszej klatce. */
const SHELL_TIME = "$RT=performance.now();";

type Globals = typeof globalThis & {
  $RT?: unknown;
  $RC?: (b: string, s: string) => void;
  __nesRevealVisibility?: () => void;
};
const g = globalThis as Globals;
const runScript = (code: string) => (0, eval)(code);

function streamedBoundary(): void {
  document.body.innerHTML =
    '<main><!--$?--><template id="B:0"></template><p id="fallback">szkielet</p><!--/$--></main>' +
    '<div hidden id="S:0"><p id="content">treść</p></div>';
}

describe("STREAM_REVEAL_SCRIPT - odsłonięcie granicy strumienia w najbliższej klatce", () => {
  let raf: ReturnType<typeof vi.fn>;
  let timeout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete g.$RT;
    raf = vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    timeout = vi.spyOn(globalThis, "setTimeout");
    streamedBoundary();
  });

  afterEach(() => {
    if (g.__nesRevealVisibility) {
      document.removeEventListener("visibilitychange", g.__nesRevealVisibility);
      delete g.__nesRevealVisibility;
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    timeout.mockRestore();
    delete g.$RT;
    delete (document as { hidden?: boolean }).hidden;
    document.body.innerHTML = "";
  });

  /** Widoczność karty - własna właściwość dokumentu przesłania getter środowiska testowego. */
  const setHidden = (hidden: boolean) =>
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

  it("bez skryptu React 19.2 dławi odsłonięcie po pierwszej klatce (punkt odniesienia)", () => {
    runScript(reactRevealRuntime());
    runScript(SHELL_TIME);
    expect(typeof g.$RT).toBe("number");
    g.$RC!("B:0", "S:0");
    // Odsłonięcie czeka na `setTimeout` (~300 ms po `$RT`), szkielet zostaje na ekranie.
    expect(raf).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(document.getElementById("fallback")).not.toBeNull();
    expect(document.getElementById("content")?.closest("[hidden]")).not.toBeNull();
  });

  it("na widocznej karcie odczyt `$RT` jest pusty, a granica odsłania się w najbliższej klatce", () => {
    setHidden(false);
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(reactRevealRuntime());
    runScript(SHELL_TIME);
    expect(g.$RT).toBeUndefined();
    g.$RC!("B:0", "S:0");
    expect(timeout).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(document.getElementById("fallback")).toBeNull();
    expect(document.getElementById("content")?.closest("[hidden]")).toBeNull();
    expect(document.querySelector("main")?.textContent).toBe("treść");
  });

  it("kolejna granica po odsłonięciu (`$RV` ustawia `$RT`) też idzie w najbliższej klatce", () => {
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(reactRevealRuntime());
    g.$RC!("B:0", "S:0");
    document.body.insertAdjacentHTML(
      "beforeend",
      '<section><!--$?--><template id="B:1"></template><i id="fb1"></i><!--/$--></section>' +
        '<div hidden id="S:1"><b id="c1">druga</b></div>',
    );
    g.$RC!("B:1", "S:1");
    expect(timeout).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(2);
    expect(document.getElementById("fb1")).toBeNull();
    expect(document.getElementById("c1")?.closest("[hidden]")).toBeNull();
  });

  it("na karcie ukrytej po pierwszej klatce zostaje timer Reacta - rAF w tle nie biegnie", () => {
    // Przegląd PR #534: ukryty dokument nie wykonuje `requestAnimationFrame`, więc ścieżka rAF
    // trzymałaby szkielety do powrotu na kartę; timer Reacta przeglądarka wykonuje także w tle.
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(reactRevealRuntime());
    setHidden(false);
    runScript(SHELL_TIME);
    setHidden(true);
    expect(typeof g.$RT).toBe("number");
    g.$RC!("B:0", "S:0");
    expect(raf).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it("po powrocie na kartę kolejna granica znów idzie w najbliższej klatce", () => {
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(reactRevealRuntime());
    runScript(SHELL_TIME);
    setHidden(true);
    expect(typeof g.$RT).toBe("number");
    setHidden(false);
    expect(g.$RT).toBeUndefined();
    g.$RC!("B:0", "S:0");
    expect(timeout).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    expect(document.getElementById("fallback")).toBeNull();
  });

  it("hiding after scheduling reveals queued content in the background without a duplicate flush", () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    setHidden(false);
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(reactRevealRuntime());
    runScript(SHELL_TIME);
    g.$RC?.("B:0", "S:0");
    expect(frames).toHaveLength(1);
    expect(document.getElementById("fallback")).not.toBeNull();
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.runOnlyPendingTimers();
    expect(document.getElementById("fallback")).toBeNull();
    expect(document.querySelector("main")?.textContent).toBe("treść");
    setHidden(false);
    for (const frame of frames) frame(performance.now());
    expect(document.querySelector("main")?.textContent).toBe("treść");
    expect(document.querySelectorAll("#content")).toHaveLength(1);
  });

  it("repeated script execution installs only one visibility listener", () => {
    const add = vi.spyOn(document, "addEventListener");
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(STREAM_REVEAL_SCRIPT);
    expect(add.mock.calls.filter(([event]) => event === "visibilitychange")).toHaveLength(1);
    add.mockRestore();
  });

  it("karta otwarta w tle przed pierwszą klatką: rAF jak w samym Reakcie (wartość jeszcze pusta)", () => {
    setHidden(true);
    runScript(STREAM_REVEAL_SCRIPT);
    runScript(reactRevealRuntime());
    expect(g.$RT).toBeUndefined();
    g.$RC!("B:0", "S:0");
    expect(timeout).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it("skrypt jest jednym klasycznym literałem bez wstawek i nie rzuca przy ponownym wykonaniu", () => {
    expect(STREAM_REVEAL_SCRIPT).not.toMatch(/<\/script/i);
    expect(() => {
      runScript(STREAM_REVEAL_SCRIPT);
      runScript(STREAM_REVEAL_SCRIPT);
    }).not.toThrow();
  });
});
