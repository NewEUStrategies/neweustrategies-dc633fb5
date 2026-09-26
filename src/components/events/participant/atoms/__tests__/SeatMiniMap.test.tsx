// Atom „mini-mapa miejsca uczestnika" - rysuje TYLKO to, co oddała baza.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW - każdy punkt to gwarancja, która znika.
//   1. Kadr (viewBox) obejmuje miejsca własnej sekcji i scenę z marginesem
//      jednej podziałki; bez sceny kadr zamyka się na samych miejscach.
//   2. „Moje” miejsce jest wyróżnione większym promieniem i znacznikiem, a
//      obrót sekcji przenosi punkty tak samo jak na planie organizatora.
//   3. Grafika ma nazwę z pełną etykietą miejsca (mapa nie jest jedynym
//      nośnikiem informacji).
//   4. Render serwerowy jest deterministyczny i hydratuje się bez rozjazdu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-event-seating", () => ({ ensureEventSeatingI18n: () => undefined }));

import { SeatMiniMap } from "@/components/events/participant/atoms/SeatMiniMap";
import type { MySeatGeometry } from "@/lib/events/mySeatsApi";
import { mySeatCard } from "@/test/events/seatingFixtures";

const geometria = (over: Partial<MySeatGeometry> = {}): MySeatGeometry => ({
  ...mySeatCard().geometry,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("SeatMiniMap", () => {
  it("kadruje miejsca i scenę, a „moje” miejsce wyróżnia", () => {
    const { container } = render(<SeatMiniMap geometry={geometria()} label="Rząd A, miejsce 2" />);

    const mapa = screen.getByRole("img", {
      name: "eventSeating.map.label(seat=Rząd A, miejsce 2)",
    });
    // Miejsca (100..200, 200), scena (100,20)-(500,80), margines 50.
    expect(mapa.getAttribute("viewBox")).toBe("50 -30 500 280");
    expect(screen.getByText("eventSeating.map.stage")).toBeTruthy();
    const kola = [...container.querySelectorAll("circle")];
    expect(kola.map((kolo) => kolo.getAttribute("cx"))).toEqual(["100", "150", "200"]);
    expect(kola.map((kolo) => kolo.getAttribute("data-mine"))).toEqual([null, "true", null]);
    expect(Number(kola[1]?.getAttribute("r"))).toBeCloseTo(19 * 1.35, 5);
    expect(Number(kola[0]?.getAttribute("r"))).toBe(19);
    // Czcionka sceny: 40% wysokości sceny, w granicach 12..48.
    expect(container.querySelector("text")?.getAttribute("font-size")).toBe("24");
  });

  it("bez sceny kadr zamyka się na samych miejscach", () => {
    const { container } = render(<SeatMiniMap geometry={geometria({ stage: null })} label="x" />);

    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("50 150 200 100");
    expect(container.querySelector("rect")).toBeNull();
    expect(container.querySelector("text")).toBeNull();
  });

  it("obrót sekcji przenosi punkty jak na planie organizatora", () => {
    const base = geometria();
    const { container } = render(
      <SeatMiniMap
        geometry={{ ...base, stage: null, section: { ...base.section, rotationDeg: 90 } }}
        label="x"
      />,
    );

    const punkty = [...container.querySelectorAll("circle")].map((kolo) => [
      kolo.getAttribute("cx"),
      kolo.getAttribute("cy"),
    ]);
    expect(punkty).toEqual([
      ["100", "200"],
      ["100", "250"],
      ["100", "300"],
    ]);
  });

  it("render serwerowy jest deterministyczny i hydratuje się bez rozjazdu", async () => {
    const drzewo = () => <SeatMiniMap geometry={geometria()} label="Rząd A, miejsce 2" />;
    expect(renderToString(drzewo())).toBe(renderToString(drzewo()));

    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args[0]);
    });
    const container = document.createElement("div");
    container.innerHTML = renderToString(drzewo());
    document.body.appendChild(container);
    const serwerowy = container.innerHTML;

    await act(async () => {
      hydrateRoot(container, drzewo());
    });

    expect(errors, errors.map(String).join(" | ")).toEqual([]);
    expect(container.innerHTML).toBe(serwerowy);
  });
});
