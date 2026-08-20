// Dwie sekcje zwijane paneli właściwości. Różnią się nie stylem, a KONTRAKTEM
// z użytkownikiem: `CollapsibleDetails` to natywne `<details open>` (treść jest
// w DOM od początku, więc Ctrl+F w przeglądarce ją znajduje), a
// `CollapsibleSection` montuje treść dopiero po otwarciu. Test pilnuje obu
// kontraktów osobno, bo pomyłka w którą stronę jest niewidoczna na zrzucie
// ekranu, a psuje albo wyszukiwanie, albo koszt renderu wielkiego panelu.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CollapsibleDetails, CollapsibleSection } from "../Collapsible";

describe("CollapsibleDetails", () => {
  it("jest otwarty od razu i trzyma treść w DOM", () => {
    const { container } = render(
      <CollapsibleDetails title="Tło">
        <p>zawartość sekcji</p>
      </CollapsibleDetails>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Tło")).toBeInTheDocument();
    expect(screen.getByText("zawartość sekcji")).toBeInTheDocument();
  });

  it("tytuł siedzi w summary, czyli w elemencie klikalnym", () => {
    const { container } = render(
      <CollapsibleDetails title="Odstępy">
        <span>x</span>
      </CollapsibleDetails>,
    );
    expect(container.querySelector("summary")?.textContent).toContain("Odstępy");
  });
});

describe("CollapsibleSection", () => {
  it("startuje zamknięta i nie montuje treści", () => {
    render(
      <CollapsibleSection title="Typografia">
        <p>pola typografii</p>
      </CollapsibleSection>,
    );
    expect(screen.getByRole("button", { name: /Typografia/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("pola typografii")).toBeNull();
  });

  it("startuje otwarta, gdy defaultOpen", () => {
    render(
      <CollapsibleSection title="Typografia" defaultOpen>
        <p>pola typografii</p>
      </CollapsibleSection>,
    );
    expect(screen.getByRole("button", { name: /Typografia/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("pola typografii")).toBeInTheDocument();
  });

  it("przełącza się w obie strony", () => {
    render(
      <CollapsibleSection title="Tło">
        <p>pola tła</p>
      </CollapsibleSection>,
    );
    const toggle = screen.getByRole("button", { name: /Tło/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("pola tła")).toBeInTheDocument();
    fireEvent.click(toggle);
    // Zamknięcie MUSI odmontować treść - inaczej ukryte pola dalej renderują
    // podglądy i panel z 20 sekcjami kosztuje tyle, co 20 otwartych.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("pola tła")).toBeNull();
  });

  it("stan otwarcia zmienia klasy nagłówka i ramki", () => {
    const { container } = render(
      <CollapsibleSection title="Ramka">
        <p>pola ramki</p>
      </CollapsibleSection>,
    );
    const toggle = screen.getByRole("button", { name: /Ramka/ });
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain("border-border/80");
    expect(toggle.className).toContain("hover:text-brand");
    fireEvent.click(toggle);
    expect(frame.className).toContain("shadow-sm");
    expect(toggle.className).toContain("bg-brand/5");
  });
});
