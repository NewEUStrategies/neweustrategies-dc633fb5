// CO DOWODZI TEN PLIK: „?" przy polu edytora to jedyne miejsce, w którym
// redaktor dowiaduje się, CO dane pole robi (np. że nadpisanie layoutu dziedziczy
// z globalnych ustawień). Trzy reguły muszą się trzymać, bo każda z nich psuje
// pracę w sposób, którego typy nie widzą:
//   1. `type="button"`. Podpowiedzi siedzą wewnątrz formularza edytora. Przycisk
//      bez jawnego typu jest przyciskiem WYSYŁAJĄCYM - klik w „?" wysłałby
//      formularz (przeładowanie strony i utrata niezapisanej treści).
//   2. Dostępna nazwa równa treści podpowiedzi. Bez `aria-label` czytnik ekranu
//      mówi „przycisk" i cała pomoc kontekstowa przestaje istnieć dla osoby
//      niewidzącej (sama ikona nie ma tekstu).
//   3. Atom działa BEZ opakowania w `TooltipProvider`. Radix rzuca wyjątek, gdy
//      providera brakuje, a wyjątek w renderze panelu edytora = biała strona
//      przez globalną granicę błędu (dokładnie to zdarzyło się już na podglądzie
//      wiadomości - patrz komentarz w src/components/ui/tooltip.tsx). Ten test
//      jest zaporą przed powrotem takiego crashu.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InfoHint } from "../InfoHint";

const HINT = "Puste = dziedzicz z ustawień globalnych.";

afterEach(cleanup);

describe("InfoHint", () => {
  it("nie wysyła formularza edytora: to przycisk typu button", () => {
    render(<InfoHint text={HINT} />);
    expect(screen.getByRole("button", { name: HINT })).toHaveAttribute("type", "button");
  });

  it("cała treść podpowiedzi jest dostępną nazwą przycisku (ikona nie ma tekstu)", () => {
    render(<InfoHint text={HINT} />);
    expect(screen.getByRole("button", { name: HINT })).toBeInTheDocument();
  });

  it("działa bez `TooltipProvider` w drzewie - brak providera nie może wywalić panelu", () => {
    render(<InfoHint text={HINT} />);
    expect(screen.getByRole("button", { name: HINT })).toBeInTheDocument();
  });

  it("wewnątrz wspólnego `TooltipProvider` zachowuje się identycznie", () => {
    render(
      <TooltipProvider>
        <InfoHint text="Pierwsza" />
        <InfoHint text="Druga" />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Pierwsza" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Druga" })).toBeInTheDocument();
  });

  it("treść podpowiedzi pokazuje się po dojściu FOKUSEM, nie tylko po najechaniu myszą", () => {
    // Redaktor pracujący z klawiatury musi mieć dostęp do tej samej pomocy, co
    // użytkownik myszy - inaczej pole zostaje bez wyjaśnienia.
    render(<InfoHint text={HINT} />);
    const trigger = screen.getByRole("button", { name: HINT });
    fireEvent.focus(trigger);
    // Radix montuje dymek w portalu poza kontenerem testu, więc szukamy po
    // całym dokumencie; sama nazwa przycisku (aria-label) nie jest tekstem DOM.
    expect(
      Array.from(document.querySelectorAll("*")).some(
        (el) => el.childElementCount === 0 && el.textContent === HINT,
      ),
    ).toBe(true);
  });
});
