// Kontrakt nawigacji przypisów: marker w treści -> sekcja końcowa,
// numer w sekcji -> powrót do markera. Oba skoki przechwycone (preventDefault)
// i wykonane płynnym scrollem z offsetem pod sticky header.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FootnotesList } from "@/components/Footnotes";
import { FootnoteTooltips } from "@/components/Footnotes";
import { useRef } from "react";

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>
        <p>
          Treść
          <sup className="fn-ref">
            <a href="#fn-1" id="fnref-1" data-fn="1" title="Nota">
              [1]
            </a>
          </sup>
        </p>
      </div>
      <FootnotesList notes={[{ id: 1, html: "Nota źródłowa" }]} lang="pl" />
      <FootnoteTooltips notes={[{ id: 1, html: "Nota źródłowa" }]} containerRef={ref} />
    </div>
  );
}

describe("nawigacja przypisów", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("klik w marker przewija do wpisu w sekcji przypisów", async () => {
    render(<Harness />);
    const marker = screen.getByRole("link", { name: "[1]" });
    await userEvent.click(marker);
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.getElementById("fn-1")).not.toBeNull();
  });

  it("klik w numer w sekcji wraca do markera w treści", async () => {
    render(<Harness />);
    const back = screen.getAllByTitle("Wróć do odsyłacza")[0];
    await userEvent.click(back);
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.getElementById("fnref-1")).not.toBeNull();
  });
});
