// CO DOWODZI TEN PLIK: sidebar edytora wpisu to kilkanaście sekcji jedna pod
// drugą (ustawienia, autorzy, seria, linki podglądu, nadpisania layoutu). Ten
// atom decyduje, KTÓRE z nich są widoczne po wejściu w edytor i co się dzieje po
// kliknięciu nagłówka. Reguły, które muszą się trzymać:
//   1. `defaultOpen` steruje pierwszym renderem. Gdyby wszystkie sekcje
//      otwierały się domyślnie, redaktor dostaje kilometrowy sidebar i traci
//      z oczu przycisk publikacji; gdyby żadna - musi klikać, żeby zobaczyć
//      status wpisu.
//   2. Klik nagłówka PRZEŁĄCZA sekcję w obie strony (nie tylko otwiera).
//   3. Zwinięcie ODMONTOWUJE zawartość, a nie ukrywa ją CSS-em. To zachowanie
//      widoczne dla użytkownika: stan niezatwierdzonych pól w zwiniętej sekcji
//      przepada, a treść zwiniętej sekcji nie jest znajdowana przez Ctrl+F.
//      Test opisuje to jawnie, żeby ewentualna zmiana na `hidden` była decyzją,
//      nie przypadkiem.
//   4. Ikona jest opcjonalna - kilka sekcji jej nie ma i nie może to zostawiać
//      dziury w nagłówku.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SidebarSection } from "../SidebarSection";

/** Atrapa ikony: sprawdzamy PRZEKAZANIE ikony, nie jej wygląd. */
function StubIcon({ className }: { className?: string }) {
  return <svg data-testid="section-icon" className={className} />;
}

afterEach(cleanup);

describe("SidebarSection - widoczność zawartości", () => {
  it("domyślnie sekcja jest otwarta - status wpisu widać bez klikania", () => {
    render(
      <SidebarSection title="Ustawienia">
        <p>zawartość sekcji</p>
      </SidebarSection>,
    );
    expect(screen.getByText("zawartość sekcji")).toBeInTheDocument();
  });

  it("`defaultOpen={false}` startuje zwinięta - sidebar nie zalewa ekranu", () => {
    render(
      <SidebarSection title="Autorzy" defaultOpen={false}>
        <p>zawartość sekcji</p>
      </SidebarSection>,
    );
    expect(screen.queryByText("zawartość sekcji")).toBeNull();
    // Nagłówek musi zostać widoczny, inaczej nie da się sekcji rozwinąć.
    expect(screen.getByRole("heading", { name: "Autorzy" })).toBeInTheDocument();
  });

  it("klik nagłówka przełącza sekcję w OBIE strony", () => {
    render(
      <SidebarSection title="Seria">
        <p>zawartość sekcji</p>
      </SidebarSection>,
    );
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle);
    expect(screen.queryByText("zawartość sekcji")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText("zawartość sekcji")).toBeInTheDocument();
  });

  it("rozwinięcie sekcji startującej jako zwinięta pokazuje zawartość", () => {
    render(
      <SidebarSection title="Linki podglądu" defaultOpen={false}>
        <button type="button">Wygeneruj link</button>
      </SidebarSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Linki podglądu" }));
    expect(screen.getByRole("button", { name: "Wygeneruj link" })).toBeInTheDocument();
  });

  it("zwinięcie ODMONTOWUJE zawartość: niezatwierdzony tekst w polu przepada", () => {
    render(
      <SidebarSection title="Nadpisania layoutu">
        <input aria-label="Klasa" defaultValue="" />
      </SidebarSection>,
    );
    fireEvent.change(screen.getByLabelText("Klasa"), { target: { value: "roboczy wpis" } });
    expect(screen.getByLabelText("Klasa")).toHaveValue("roboczy wpis");

    const toggle = screen.getByRole("button", { name: "Nadpisania layoutu" });
    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(screen.getByLabelText("Klasa")).toHaveValue("");
  });
});

describe("SidebarSection - nagłówek", () => {
  it("tytuł jest nagłówkiem poziomu 3 (spójna oś dokumentu w sidebarze)", () => {
    render(
      <SidebarSection title="Ustawienia">
        <p>x</p>
      </SidebarSection>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Ustawienia" })).toBeInTheDocument();
  });

  it("ikona jest opcjonalna: podana - renderowana, pominięta - brak śladu", () => {
    const { unmount } = render(
      <SidebarSection title="Ustawienia" icon={StubIcon}>
        <p>x</p>
      </SidebarSection>,
    );
    expect(screen.getByTestId("section-icon")).toBeInTheDocument();
    unmount();

    render(
      <SidebarSection title="Ustawienia">
        <p>x</p>
      </SidebarSection>,
    );
    expect(screen.queryByTestId("section-icon")).toBeNull();
  });

  it("cały nagłówek jest jednym przyciskiem - klik w tytuł też przełącza", () => {
    render(
      <SidebarSection title="Ustawienia">
        <p>zawartość sekcji</p>
      </SidebarSection>,
    );
    fireEvent.click(screen.getByRole("heading", { name: "Ustawienia" }));
    expect(screen.queryByText("zawartość sekcji")).toBeNull();
  });

  // SWIADEK DEFEKTU (D3): przycisk zwijania nie ma `aria-expanded` ani
  // `aria-controls`, więc czytnik ekranu ogłasza go jako zwykły przycisk -
  // osoba niewidząca nie wie, czy sekcja jest otwarta, ani że przycisk czymś
  // steruje. Stan jest przekazywany WYŁĄCZNIE obrotem strzałki (klasa CSS).
  // Test opisuje stan OBECNY - po dodaniu `aria-expanded` celowo pęknie.
  it("stan otwarcia NIE jest wystawiony technologiom asystującym", () => {
    render(
      <SidebarSection title="Ustawienia">
        <p>zawartość sekcji</p>
      </SidebarSection>,
    );
    const toggle = screen.getByRole("button", { name: "Ustawienia" });
    expect(toggle).not.toHaveAttribute("aria-expanded");
    expect(toggle).not.toHaveAttribute("aria-controls");

    fireEvent.click(toggle);
    // Po zwinięciu również nic - to jest właśnie luka, nie chwilowy stan.
    expect(toggle).not.toHaveAttribute("aria-expanded");
    expect(screen.queryByText("zawartość sekcji")).toBeNull();
  });
});
