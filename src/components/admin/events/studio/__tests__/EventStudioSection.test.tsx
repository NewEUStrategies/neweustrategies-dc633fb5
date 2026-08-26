// Kontrakt WIZUALNY prymitywow studia wydarzenia.
//
// Testujemy trzy rzeczy, ktore latwo zgubic przy kolejnym refaktorze layoutu:
// 1. numer sekcji liczy CSS (klasa z `counter-increment`), a nie licznik w
//    renderze - licznik w renderze przeskakiwal w StrictMode 01 -> 03;
// 2. zaokraglenie ma byc dokladnie 6 px, bo to reguła projektu, a `rounded-lg`
//    /`rounded-md` zaleza od tokenu, ktory ktos moze przestawic;
// 3. wiersz nadal renderuje swoje dzieci - warstwa wizualna nie moze zjesc
//    zawartosci ustawien.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventStudioChoiceCard, EventStudioPage, EventStudioRow } from "../EventStudioSection";

describe("EventStudioSection", () => {
  it("numeruje sekcje licznikiem CSS, po jednym znaczniku na wiersz", () => {
    const { container } = render(
      <EventStudioPage title="Grupy i uprawnienia">
        <EventStudioRow label="Grupy uczestnikow">
          <p>pierwsza</p>
        </EventStudioRow>
        <EventStudioRow label="Widocznosc publiczna">
          <p>druga</p>
        </EventStudioRow>
      </EventStudioPage>,
    );

    const markers = container.querySelectorAll('[class*="counter-increment"]');
    expect(markers).toHaveLength(2);
    // Reset licznika stoi na powloce strony, inaczej numeracja ciagnelaby sie
    // miedzy ekranami studia.
    expect(container.querySelector('[class*="counter-reset"]')).not.toBeNull();
    expect(screen.getByText("pierwsza")).toBeInTheDocument();
    expect(screen.getByText("druga")).toBeInTheDocument();
  });

  it("trzyma zaokraglenie 6 px na karcie wyboru", () => {
    const { container } = render(
      <EventStudioChoiceCard
        id="choice-a"
        name="choice"
        checked
        label="Opis i agenda"
        onSelect={() => {}}
      />,
    );

    expect(container.querySelector(".rounded-\\[6px\\]")).not.toBeNull();
  });
});
