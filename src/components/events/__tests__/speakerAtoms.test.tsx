// Atomy prelegenta: awatar i rząd gwiazdek.
//
// Cały katalog `components/events` nie miał do 18.08.2026 ani jednego testu.
// Oba komponenty są małe, ale niosą reguły, które widać wyłącznie na ekranie:
// awatar decyduje, czy przy braku zdjęcia zobaczymy sensowne inicjały czy
// pustą plamę, a gwiazdki - czy ocena zaokrągla się przewidywalnie.
//
// DOSTĘPNOŚĆ jest tu asercją, nie komentarzem: obie ozdoby są `aria-hidden`,
// bo powielają informację podaną obok tekstem. Czytnik ekranu, który ogłasza
// „AK" po nazwisku prelegenta albo pięć razy „gwiazdka", jest gorszy niż cisza.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpeakerAvatar } from "@/components/events/SpeakerAvatar";
import { SpeakerStars } from "@/components/events/SpeakerStars";
import { PX_BY_SIZE } from "@/components/events/speakerAvatarSizes";

describe("SpeakerAvatar - inicjały", () => {
  it("bierze pierwszą literę imienia i nazwiska", () => {
    render(<SpeakerAvatar name="Anna Kowalska" />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("z jednego członu bierze tylko jedną literę", () => {
    render(<SpeakerAvatar name="Cher" />);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("przy trzech członach bierze PIERWSZY i OSTATNI, nie dwa pierwsze", () => {
    // „Anna Maria Kowalska" to AK, nie AM - nazwisko niesie więcej niż drugie imię.
    render(<SpeakerAvatar name="Anna Maria Kowalska" />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("ignoruje nadmiarowe odstępy", () => {
    render(<SpeakerAvatar name="  Anna   Kowalska  " />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("podnosi inicjały do wielkich liter", () => {
    render(<SpeakerAvatar name="anna kowalska" />);
    expect(screen.getByText("AK")).toBeInTheDocument();
  });

  it("pusta nazwa daje znak zapytania, a nie pustą plamę", () => {
    // Wiersz bez nazwiska zdarza się przy imporcie agendy - kwadrat bez
    // żadnego znaku wygląda jak błąd ładowania.
    render(<SpeakerAvatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("zastępcze inicjały są UKRYTE przed czytnikiem ekranu", () => {
    const { container } = render(<SpeakerAvatar name="Anna Kowalska" />);
    expect(container.querySelector("span[aria-hidden]")).toBeInTheDocument();
  });
});

describe("SpeakerAvatar - zdjęcie", () => {
  it("ze zdjęciem renderuje obraz zamiast inicjałów", () => {
    render(<SpeakerAvatar name="Anna Kowalska" photoUrl="https://cdn.example/a.jpg" />);
    expect(screen.queryByText("AK")).not.toBeInTheDocument();
    expect(screen.getByRole("presentation", { hidden: true })).toBeTruthy();
  });

  it("zamawia kadr 2x względem realnego boku - inaczej twarz jest rozmyta", () => {
    // Sedno `speakerAvatarSizes`: bez podwojenia ekran o gęstości 2x skaluje
    // oryginał w przeglądarce i portret prelegenta wygląda na nieostry.
    const { container } = render(
      <SpeakerAvatar name="Anna" photoUrl="https://cdn.example/a.jpg" size="lg" />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src") ?? "").toContain(String(PX_BY_SIZE.lg * 2));
  });

  it("zdjęcie ma PUSTY tekst alternatywny - nazwisko stoi obok", () => {
    const { container } = render(
      <SpeakerAvatar name="Anna Kowalska" photoUrl="https://cdn.example/a.jpg" />,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("dokłada własne klasy wywołującego", () => {
    const { container } = render(<SpeakerAvatar name="Anna" className="ring-2" />);
    expect(container.querySelector(".ring-2")).toBeInTheDocument();
  });

  it.each(["sm", "md", "lg", "xl"] as const)("rozmiar %s ma zdefiniowany bok w px", (size) => {
    expect(PX_BY_SIZE[size]).toBeGreaterThan(0);
    const { container } = render(<SpeakerAvatar name="Anna" size={size} />);
    expect(container.firstElementChild).toBeTruthy();
  });
});

describe("SpeakerStars", () => {
  /** Ile gwiazdek jest wypełnionych kolorem akcentu. */
  function filled(container: HTMLElement): number {
    return container.querySelectorAll('[class*="fill-[color:var(--speakers-accent"]').length;
  }

  it("zawsze rysuje pięć gwiazdek", () => {
    const { container } = render(<SpeakerStars rating={3} />);
    expect(container.querySelectorAll("svg")).toHaveLength(5);
  });

  it("wypełnia tyle gwiazdek, ile wynosi ocena", () => {
    expect(filled(render(<SpeakerStars rating={3} />).container)).toBe(3);
  });

  it("zaokrągla ocenę do pełnych gwiazdek", () => {
    expect(filled(render(<SpeakerStars rating={3.4} />).container)).toBe(3);
    expect(filled(render(<SpeakerStars rating={3.5} />).container)).toBe(4);
  });

  it("przycina ocenę do zakresu 0-5", () => {
    // Średnia liczona po stronie klienta potrafi wyjść poza zakres przy
    // pustym mianowniku albo błędnym imporcie.
    expect(filled(render(<SpeakerStars rating={9} />).container)).toBe(5);
    expect(filled(render(<SpeakerStars rating={-2} />).container)).toBe(0);
  });

  it("ocena NaN nie wypełnia żadnej gwiazdki", () => {
    expect(filled(render(<SpeakerStars rating={Number.NaN} />).container)).toBe(0);
  });

  it("rząd gwiazdek jest UKRYTY przed czytnikiem ekranu", () => {
    // Pięć powtórzeń słowa „gwiazdka" nie niesie oceny; liczba stoi obok.
    const { container } = render(<SpeakerStars rating={4} />);
    expect(container.querySelector("span[aria-hidden]")).toBeInTheDocument();
  });
});
