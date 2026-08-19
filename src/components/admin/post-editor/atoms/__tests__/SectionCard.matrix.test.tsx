// CO DOWODZI TEN PLIK: `SectionCard` to rama sekcji szczegółów wpisu (wnioski,
// audio) - jedna dla wszystkich, żeby chrome sekcji nie rozjechał się między
// kartami. Istniejący `SectionCard.test.tsx` sprawdza, że tytuł, opis, ikona
// i klasa ciała docierają na miejsce. Tu domykamy trzy reguły STRUKTURALNE,
// których złamanie widzi użytkownik, a typy nie:
//   1. tytuł jest nagłówkiem poziomu 3 - sekcje wpisu są rodzeństwem w osi
//      dokumentu, więc czytnik ekranu i tryb czytania muszą je wymieniać obok
//      siebie, nie zagnieżdżać;
//   2. opis pojawia się TYLKO, gdy go podano (puste `<p>` zostawiałoby dziurę
//      w gęstym nagłówku i przesuwało treść);
//   3. treść żyje POZA nagłówkiem - nagłówek ma wyciszone tło i obramowanie,
//      więc pola formularza wpuszczone do niego wyglądałyby na nieaktywne.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SectionCard } from "../SectionCard";

afterEach(cleanup);

describe("SectionCard - oś dokumentu i nagłówek", () => {
  it("tytuł jest nagłówkiem poziomu 3", () => {
    render(
      <SectionCard title="Wnioski">
        <p>treść</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Wnioski" })).toBeInTheDocument();
  });

  it("tytuł może być węzłem Reacta, nie tylko tekstem (licznik przy nazwie sekcji)", () => {
    render(
      <SectionCard
        title={
          <>
            Wnioski <span>3/5</span>
          </>
        }
      >
        <p>treść</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Wnioski 3/5");
  });

  it("bez opisu nagłówek nie zostawia pustego akapitu", () => {
    const { container } = render(
      <SectionCard title="Wnioski">
        <p>treść</p>
      </SectionCard>,
    );
    // Jedyny akapit w karcie to treść przekazana przez wywołującego.
    const paragraphs = Array.from(container.querySelectorAll("p"));
    expect(paragraphs.map((p) => p.textContent)).toEqual(["treść"]);
  });
});

describe("SectionCard - rozdział nagłówka od treści", () => {
  it("treść nie jest wpuszczona do wyciszonego nagłówka", () => {
    render(
      <SectionCard title="Audio" description="Lektor PL/EN">
        <input aria-label="Adres pliku audio" />
      </SectionCard>,
    );
    const header = screen.getByRole("heading", { name: "Audio" }).closest("header");
    const field = screen.getByLabelText("Adres pliku audio");
    expect(header).not.toBeNull();
    expect(header?.contains(field)).toBe(false);
    // Opis natomiast NALEŻY do nagłówka - to podtytuł sekcji, nie treść.
    expect(header?.contains(screen.getByText("Lektor PL/EN"))).toBe(true);
  });

  it("karta jest wyodrębnionym regionem sekcji (element <section>)", () => {
    const { container } = render(
      <SectionCard title="Audio">
        <p>treść</p>
      </SectionCard>,
    );
    expect(container.querySelector("section")).not.toBeNull();
  });
});
