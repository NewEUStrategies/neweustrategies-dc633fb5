// Inwariant: strona buildera ma DOKŁADNIE JEDEN nagłówek poziomu 1.
//
// Bez tego testu poprzednia korekta („usuń jeden z dwóch h1") mogła przejść na
// produkcję jako regres a11y: dokument bez własnego nagłówka zostawał zupełnie
// bez `h1`, a informacja o tytule wylądowała w `aria-label` na `<div>` bez roli
// - czyli w miejscu, którego czytniki ekranu nie eksponują (audyt 2026-08-06,
// korekta 2).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderPageShell } from "@/components/pages/BuilderPageShell";

describe("BuilderPageShell", () => {
  it("dokument bez własnego h1 dostaje nagłówek sr-only z tytułu", () => {
    render(
      <BuilderPageShell title="Nasze programy" hasOwnTopHeading={false}>
        <p>treść dokumentu</p>
      </BuilderPageShell>,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Nasze programy");
    // sr-only, nie `hidden`: nagłówek MUSI zostać w drzewie dostępności.
    expect(headings[0].className).toContain("sr-only");
  });

  it("dokument z własnym h1 nie dostaje drugiego", () => {
    render(
      <BuilderPageShell title="Nasze programy" hasOwnTopHeading>
        <h1>Programy 2026</h1>
      </BuilderPageShell>,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Programy 2026");
  });

  it("nagłówek zastępczy stoi PRZED treścią dokumentu", () => {
    const { container } = render(
      <BuilderPageShell title="Tytuł strony" hasOwnTopHeading={false}>
        <p>pierwszy akapit</p>
      </BuilderPageShell>,
    );
    const order = [...container.querySelectorAll("h1, p")].map((el) => el.tagName);
    expect(order).toEqual(["H1", "P"]);
  });

  it("nie zostawia aria-label na kontenerze bez roli (nazwa jest w nagłówku)", () => {
    const { container } = render(
      <BuilderPageShell title="Tytuł strony" hasOwnTopHeading={false}>
        <p>treść</p>
      </BuilderPageShell>,
    );
    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("przekazuje szablon i nadpisanie nagłówka witryny oraz renderuje warstwę stopki", () => {
    const { container } = render(
      <BuilderPageShell
        title="Tytuł"
        hasOwnTopHeading
        headerOverride="transparent"
        footer={<div data-testid="footer-layer" />}
      >
        <h1>Własny</h1>
      </BuilderPageShell>,
    );
    const root = container.querySelector('[data-page-template="builder"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-page-header-override")).toBe("transparent");
    expect(screen.getByTestId("footer-layer")).toBeInTheDocument();
  });

  it("brak nadpisania nagłówka zapisuje wartość domyślną", () => {
    const { container } = render(
      <BuilderPageShell title="Tytuł" hasOwnTopHeading={false}>
        <p>treść</p>
      </BuilderPageShell>,
    );
    expect(
      container
        .querySelector('[data-page-template="builder"]')
        ?.getAttribute("data-page-header-override"),
    ).toBe("default");
  });
});
