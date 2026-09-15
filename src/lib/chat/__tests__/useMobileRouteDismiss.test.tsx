// Wyjście na inną stronę składa czat TYLKO na telefonie.
//
// Trzy obietnice, których nie pilnuje nic innego:
//  1. montaż nie woła `dismiss` (inaczej czat gasłby w klatce otwarcia),
//  2. na szerokim ekranie nawigacja nie rusza skrzynki,
//  3. jedna nawigacja to DOKŁADNIE jedno wywołanie, także gdy rodzic
//     przerysuje się w międzyczasie ze świeżym domknięciem.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  MOBILE_DOCK_MEDIA_QUERY,
  isMobileDockViewport,
  useMobileRouteDismiss,
} from "../useMobileRouteDismiss";

function mockViewport(mobile: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: mobile && query === MOBILE_DOCK_MEDIA_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function Probe({ pathname, dismiss }: { pathname: string; dismiss: () => void }) {
  useMobileRouteDismiss(pathname, dismiss);
  return null;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMobileRouteDismiss", () => {
  it("montaż nie składa czatu", () => {
    mockViewport(true);
    const dismiss = vi.fn();

    render(<Probe pathname="/messages" dismiss={dismiss} />);

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("zmiana ścieżki na telefonie woła zamknięcie dokładnie raz", () => {
    mockViewport(true);
    const dismiss = vi.fn();

    const view = render(<Probe pathname="/messages" dismiss={dismiss} />);
    view.rerender(<Probe pathname="/klub" dismiss={dismiss} />);

    expect(dismiss).toHaveBeenCalledTimes(1);

    // Świeże domknięcie z tej samej ścieżki nie może dać drugiego wywołania.
    view.rerender(<Probe pathname="/klub" dismiss={() => dismiss()} />);

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("na szerokim ekranie nawigacja nie rusza czatu", () => {
    mockViewport(false);
    const dismiss = vi.fn();

    const view = render(<Probe pathname="/messages" dismiss={dismiss} />);
    view.rerender(<Probe pathname="/klub" dismiss={dismiss} />);

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("brak matchMedia (SSR / stare środowisko) nie wybucha i nie składa czatu", () => {
    vi.stubGlobal("matchMedia", undefined);

    expect(isMobileDockViewport()).toBe(false);
  });
});
