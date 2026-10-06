// Treść karty strumienia przycięta do trzech linii (`ClubFeedText`).
//
// CO TEN PLIK DOWODZI.
// (1) „…więcej" pojawia się TYLKO po pomiarze przepełnienia - krótki tekst
//     nie dostaje martwej obietnicy.
// (2) Przycięcie jest wysokością w jednostkach linii (`3lh`), a rozwinięcie
//     przechodzi przez zmierzoną wysokość do braku limitu - treść dociągnięta
//     później nie zostanie ucięta.
// (3) Rozwinięcie przenosi fokus na treść, bo przycisk znika.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { ClubFeedText } from "@/components/clubs/atoms/ClubFeedText";

function stubHeights(scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Zdejmuje podmienione gettery - wracają te z prototypu happy-dom.
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

describe("ClubFeedText", () => {
  it("krótki tekst nie dostaje „…więcej”", () => {
    stubHeights(48, 48);
    render(<ClubFeedText>Krótko.</ClubFeedText>);
    expect(screen.queryByTestId("club-feed-more")).toBeNull();
  });

  it("długi tekst jest przycięty do trzech linii i rozwija się płynnie", () => {
    stubHeights(240, 72);
    const { container } = render(
      <ClubFeedText className="text-sm leading-6">Bardzo długi tekst…</ClubFeedText>,
    );
    const body = container.querySelector<HTMLElement>("[data-feed-text]");
    expect(body?.getAttribute("data-feed-text")).toBe("collapsed");
    expect(body?.style.maxHeight).toBe("calc(3 * 1lh)");

    const more = screen.getByTestId("club-feed-more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(body?.id);
    fireEvent.click(more);

    expect(body?.getAttribute("data-feed-text")).toBe("opening");
    expect(body?.style.maxHeight).toBe("240px");
    expect(document.activeElement).toBe(body);
    expect(screen.queryByTestId("club-feed-more")).toBeNull();

    act(() => vi.advanceTimersByTime(400));
    expect(body?.getAttribute("data-feed-text")).toBe("open");
    expect(body?.style.maxHeight).toBe("");
  });

  it("zwinięty tekst kładzie linie na siatce (bez odstępów) i nie jest przewijalnym pudełkiem", () => {
    stubHeights(240, 72);
    const { container } = render(<ClubFeedText>Tekst</ClubFeedText>);
    const body = container.querySelector<HTMLElement>("[data-feed-text]");
    expect(body?.className).toContain("[&_*]:my-0!");
    expect(body?.className).toContain("overflow-clip");
    fireEvent.click(screen.getByTestId("club-feed-more"));
    // Po rozwinięciu odstępy wracają, a wysokość docelowa jest mierzona z nimi.
    expect(body?.className).not.toContain("[&_*]:my-0!");
  });

  it("fokus na linku w ukrytej części rozwija tekst, nie zabierając fokusu", () => {
    stubHeights(240, 72);
    const { container } = render(
      <ClubFeedText>
        Długi tekst <a href="/watek">Czytaj cały wątek</a>
      </ClubFeedText>,
    );
    const link = screen.getByRole("link", { name: "Czytaj cały wątek" });
    link.focus();
    // happy-dom nie emituje `focusin` przy `focus()` - przeglądarka tak, a na
    // nim stoi `onFocus` Reacta.
    fireEvent.focusIn(link);
    expect(container.querySelector("[data-feed-text]")?.getAttribute("data-feed-text")).toBe(
      "opening",
    );
    expect(document.activeElement).toBe(link);
  });

  it("liczba linii jest parametrem", () => {
    stubHeights(10, 10);
    const { container } = render(<ClubFeedText lines={5}>Tekst</ClubFeedText>);
    expect(container.querySelector<HTMLElement>("[data-feed-text]")?.style.maxHeight).toBe(
      "calc(5 * 1lh)",
    );
  });
});
