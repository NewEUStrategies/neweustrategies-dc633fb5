// RichHtmlView: dwa źródła przypisów w jednym wyjściu.
//   LIVE  - shortcode [fn]…[/fn] wpisany w treści widgetu musi natychmiast
//           renderować marker <sup> i podpinać bąbelek (tooltip).
//   BAKED - wpisy zmigrowane z WP mają statyczne <sup> + listę w HTML;
//           widget odzyskuje je z DOM i również montuje tooltipy.
// Live wygrywa nad baked (stan autora jest źródłem prawdy).
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { RichHtmlView } from "../RichHtmlView";

afterEach(cleanup);

describe("RichHtmlView - przypisy live ([fn]...[/fn])", () => {
  it("expands the shortcode into an anchored marker and shows a tooltip on focus", () => {
    const { container } = render(
      <RichHtmlView html="<p>Teza główna[fn]Źródło: raport <b>NES</b>[/fn].</p>" />,
    );

    const marker = container.querySelector('sup.fn-ref a[data-fn="1"]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent("[1]");

    // Fokus na markerze otwiera bąbelek z treścią przypisu.
    fireEvent.focusIn(marker as Element);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Źródło: raport NES");
    // JEDEN SPÓJNY TOOLTIP - i asercje na tym, co jest REGUŁĄ, nie na wartości
    // w pikselach. Poprzednia wersja tego testu zamrażała `max-w-[280px]`
    // i `text-[9px]`; oba zniknęły, gdy bąbelek dostał szerokość zależną od
    // okna, a test został z martwymi literałami. Pytanie, na które ma
    // odpowiadać, jest inne: czy bąbelek NIE MOŻE wyjść za ekran.
    //
    //   * szerokość ograniczona oknem, nie stałą - długi przypis na telefonie
    //     nie wypada poza widok;
    //   * wysokość ograniczona oknem PLUS przewijanie - przypis na dwadzieścia
    //     linijek się przewija, a nie obcina;
    //   * marka i promień 6 px - jeden bąbelek w całym serwisie.
    expect(tooltip.className).toContain("max-w-[min(34rem,calc(100vw-1.5rem))]");
    expect(tooltip.className).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(tooltip.className).toContain("overflow-y-auto");
    expect(tooltip.className).toContain("border-brand");
    expect(tooltip.className).toContain("rounded-[6px]");
  });
});

describe("RichHtmlView - przypisy baked (migracja WP)", () => {
  it("recovers notes from the baked footnotes list and mounts tooltips", () => {
    const baked = [
      '<p>Stary wpis<sup class="fn-ref"><a href="#fn-1" id="fnref-1" data-fn="1">[1]</a></sup>.</p>',
      '<ol data-footnotes-list="">',
      '<li id="fn-1"><span>Przypis z migracji</span></li>',
      "</ol>",
    ].join("");
    const { container } = render(<RichHtmlView html={baked} />);

    const marker = container.querySelector('a[data-fn="1"]');
    expect(marker).not.toBeNull();
    fireEvent.focusIn(marker as Element);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Przypis z migracji");
  });
});

describe("RichHtmlView - treść bez przypisów", () => {
  it("renders sanitized HTML without any tooltip layer", () => {
    const { container } = render(
      <RichHtmlView html="<p>Czysty akapit</p>" className="prose" style={{ color: "#333" }} />,
    );
    expect(container.querySelector("p")).toHaveTextContent("Czysty akapit");
    expect(container.querySelector("[data-footnote-tooltip]")).toBeNull();
    const host = container.querySelector(".prose") as HTMLElement;
    expect(host.style.color).toBe("#333");
  });

  it("renders decorative status icons while preserving readable labels", () => {
    const { container } = render(
      <RichHtmlView html="<ul><li>✅ Gotowe</li></ul>" className="cms-rich-content" />,
    );
    expect(container.querySelector(".cms-inline-status-icon--success")).not.toBeNull();
    expect(container.textContent).toContain("Gotowe");
  });
});
