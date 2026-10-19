// `ProvenanceNote` - pochodzenie liczb huba: historia od dnia wdrożenia
// (z pełnym wynikiem po 12 miesiącach), udział kwot po cenie katalogowej,
// chwila przeliczenia, wyłącznie transakcje produkcyjne.
//
// DOWÓD DATY LOKALNEJ. `data_since` to DZIEŃ, nie chwila. Test biegnie w strefie
// na zachód od Greenwich (America/New_York), gdzie `new Date("2026-03-01")`
// (północ UTC) to wieczór 28 lutego - naiwna implementacja pokazałaby
// „28 lutego". Zegar jest zamrożony na dacie BEZWZGLĘDNEJ, więc test nie jest
// bombą zegarową.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { ProvenanceNote } from "@/components/admin/revenue/atoms/ProvenanceNote";

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/New_York";
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 19 października 2026, południe czasu lokalnego testu.
  vi.setSystemTime(new Date(2026, 9, 19, 12, 0, 0));
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("pl");
});

function items(): string[] {
  const list = screen.getByRole("list", { name: "Pochodzenie danych" });
  return [...list.querySelectorAll("li")].map((li) => li.textContent ?? "");
}

describe("ProvenanceNote", () => {
  it("historia krótsza niż 12 miesięcy: data LOKALNA i dzień pełnego wyniku", () => {
    render(<ProvenanceNote dataSince="2026-03-01" />);

    expect(items()).toEqual(["Historia od 1 marca 2026 - wynik pełny od 1 marca 2027"]);
  });

  it("po 12 miesiącach historii notka mówi tylko, od kiedy są dane", () => {
    render(<ProvenanceNote dataSince="2025-10-01" />);

    expect(items()).toEqual(["Dane od 1 października 2025"]);
  });

  it("dzień przestępny przechodzi na 1 marca, bez arytmetyki na milisekundach", () => {
    vi.setSystemTime(new Date(2024, 2, 10, 12));
    render(<ProvenanceNote dataSince="2024-02-29" />);

    expect(items()[0]).toBe("Historia od 29 lutego 2024 - wynik pełny od 1 marca 2025");
  });

  it("napis spoza kalendarza nie jest datą - notka go pomija", () => {
    const { container } = render(<ProvenanceNote dataSince="2026-02-30" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("udział kwot po cenie katalogowej w procentach; komplet cen z operatora - bez ostrzeżenia", () => {
    render(<ProvenanceNote basisMix={{ provider: 3, catalog: 1 }} />);
    expect(items()).toEqual([
      "25% kwot policzono po cenie katalogowej, a nie po cenie z operatora płatności",
    ]);
    cleanup();

    const { container } = render(<ProvenanceNote basisMix={{ provider: 4, catalog: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("chwila przeliczenia i środowisko produkcyjne", () => {
    render(<ProvenanceNote computedAt="2026-10-19T08:30:00Z" environment="live" />);

    const [computed, live] = items();
    expect(computed).toMatch(/^Przeliczono 19 paź/);
    expect(live).toBe("Tylko transakcje produkcyjne - bez płatności testowych");
  });

  it("bez danych nie rysuje niczego (pusta lista byłaby szumem dla czytnika)", () => {
    const { container } = render(<ProvenanceNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it("wersja angielska", async () => {
    await i18n.changeLanguage("en");
    render(<ProvenanceNote dataSince="2026-03-01" environment="live" />);

    const list = screen.getByRole("list", { name: "Data provenance" });
    expect(list).toHaveTextContent("History since 1 March 2026 - full result from 1 March 2027");
    expect(list).toHaveTextContent("Production transactions only - no test payments");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = render(
      <ProvenanceNote
        dataSince="2026-03-01"
        basisMix={{ provider: 1, catalog: 1 }}
        computedAt="2026-10-19T08:30:00Z"
        environment="live"
      />,
    );
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
