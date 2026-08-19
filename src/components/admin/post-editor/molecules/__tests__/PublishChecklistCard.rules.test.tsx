// Checklista publikacji w sidebarze edytora: atom wiersza, karta i sekcja
// zwijana. Wszystkie trzy stały na 0%, a niosą jedyny sygnał, po którym
// redaktor poznaje, czego brakuje, zanim kliknie „Publikuj" - ta sama ocena
// zasila miękką bramkę przy przejściu w published/scheduled, więc rozjazd
// karty z bramką znaczyłby, że panel obiecuje co innego, niż egzekwuje zapis.
import "@/lib/i18n-admin-post-panes";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChecklistItem, PublishChecklist } from "@/lib/content/publishChecklist";
import { ChecklistItemRow } from "../../atoms/ChecklistItemRow";
import { SidebarSection } from "../../atoms/SidebarSection";
import { PublishChecklistCard } from "../PublishChecklistCard";

/** Bez rzutowania - identyfikatory pozycji są unią, więc literówka w teście
 *  ma być błędem kompilacji, nie cicho nieprzetłumaczoną etykietą. */
function item(over: Partial<ChecklistItem> = {}): ChecklistItem {
  return { id: "titlePl", level: "required", ok: false, ...over };
}

function checklist(over: Partial<PublishChecklist> = {}): PublishChecklist {
  const items = over.items ?? [
    item({ id: "titlePl", level: "required", ok: true }),
    item({ id: "descriptionPl", level: "required", ok: false }),
    item({ id: "cover", level: "recommended", ok: false }),
  ];
  return {
    missingRequired: items.filter((i) => i.level === "required" && !i.ok),
    missingRecommended: items.filter((i) => i.level === "recommended" && !i.ok),
    requiredOk: items.every((i) => i.level !== "required" || i.ok),
    score: 50,
    ...over,
    items,
  };
}

describe("ChecklistItemRow", () => {
  it("pozycję spełnioną przekreśla, niespełnionej nie", () => {
    // Przekreślenie jest jedynym odróżnieniem „zrobione" od „do zrobienia"
    // przy tej samej etykiecie - bez niego lista czyta się jak lista braków.
    const done = render(<ChecklistItemRow item={item({ ok: true })} />);
    expect(screen.getByText(/./).className).toContain("line-through");
    done.unmount();

    render(<ChecklistItemRow item={item({ ok: false })} />);
    expect(screen.getByText(/./).className).not.toContain("line-through");
  });

  it("odróżnia brak WYMAGANY od zalecanego innym znacznikiem stanu", () => {
    // Wymagany brak blokuje publikację (miękka bramka pyta), zalecany nie -
    // gdyby wyglądały tak samo, redaktor nie wiedziałby, co musi uzupełnić.
    const required = render(<ChecklistItemRow item={item({ level: "required", ok: false })} />);
    const requiredIcon = required.container.querySelector("svg")?.getAttribute("class");
    required.unmount();

    const recommended = render(
      <ChecklistItemRow item={item({ level: "recommended", ok: false })} />,
    );
    const recommendedIcon = recommended.container.querySelector("svg")?.getAttribute("class");

    expect(requiredIcon).toBeTruthy();
    expect(recommendedIcon).toBeTruthy();
    expect(recommendedIcon).not.toBe(requiredIcon);
  });

  it("etykieta pochodzi ze słownika, a nie z identyfikatora technicznego", () => {
    render(<ChecklistItemRow item={item({ id: "titlePl" })} />);
    // Gdyby klucz nie istniał, i18next oddałby surowy klucz z kropkami.
    expect(screen.getByText(/./).textContent).not.toContain("adminPostPanes.");
  });
});

describe("PublishChecklistCard", () => {
  it("rozdziela pozycje wymagane od zalecanych", () => {
    render(<PublishChecklistCard checklist={checklist()} />);
    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(within(lists[0]).getAllByRole("listitem")).toHaveLength(2);
    expect(within(lists[1]).getAllByRole("listitem")).toHaveLength(1);
  });

  it("wynik jest odczytywalny dla czytnika ekranu, nie tylko jako pasek", () => {
    // Sam kolorowy pasek nie niesie liczby - bez `aria-valuenow` użytkownik
    // czytnika nie dowie się, jak blisko kompletu jest wpis.
    render(<PublishChecklistCard checklist={checklist({ score: 73 })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "73");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText("73/100")).toBeInTheDocument();
  });

  it("kolor paska zmienia się na progach 80 i 50", () => {
    const colorAt = (score: number) => {
      const view = render(<PublishChecklistCard checklist={checklist({ score })} />);
      const fill = view.container.querySelector('[role="progressbar"] > div');
      const cls = fill?.className ?? "";
      view.unmount();
      return cls;
    };

    // Progi są deklaracją produktową („zielony = gotowe do publikacji"),
    // więc przesunięcie któregokolwiek zmienia sygnał dla redakcji.
    expect(colorAt(80)).toContain("emerald");
    expect(colorAt(79)).toContain("amber");
    expect(colorAt(50)).toContain("amber");
    expect(colorAt(49)).toContain("destructive");
  });

  it("szerokość paska odpowiada wynikowi", () => {
    const { container } = render(<PublishChecklistCard checklist={checklist({ score: 35 })} />);
    const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement | null;
    expect(fill?.style.width).toBe("35%");
  });

  it("komplet spełnionych pozycji nie gubi żadnej sekcji", () => {
    const all = [
      item({ id: "titlePl", level: "required", ok: true }),
      item({ id: "tags", level: "recommended", ok: true }),
    ];
    render(<PublishChecklistCard checklist={checklist({ items: all, score: 100 })} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("SidebarSection", () => {
  it("domyślnie jest rozwinięta i pokazuje treść", () => {
    render(
      <SidebarSection title="Ustawienia">
        <p>zawartość</p>
      </SidebarSection>,
    );
    expect(screen.getByText("zawartość")).toBeInTheDocument();
  });

  it("kliknięcie nagłówka CHOWA treść, a ponowne ją przywraca", () => {
    // Sekcja jest nośnikiem stanu, nie samą ozdobą - zwinięcie musi usunąć
    // treść z drzewa, a nie tylko ją przykryć.
    render(
      <SidebarSection title="Ustawienia">
        <p>zawartość</p>
      </SidebarSection>,
    );
    const header = screen.getByRole("button");

    fireEvent.click(header);
    expect(screen.queryByText("zawartość")).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByText("zawartość")).toBeInTheDocument();
  });

  it("można ją otworzyć domyślnie zwiniętą", () => {
    render(
      <SidebarSection title="Ustawienia" defaultOpen={false}>
        <p>zawartość</p>
      </SidebarSection>,
    );
    expect(screen.queryByText("zawartość")).not.toBeInTheDocument();
  });

  it("ikona jest opcjonalna i nie jest wymagana do działania", () => {
    const Icon = () => <svg data-testid="ikona" />;
    render(
      <SidebarSection title="Ustawienia" icon={Icon}>
        <p>zawartość</p>
      </SidebarSection>,
    );
    expect(screen.getByTestId("ikona")).toBeInTheDocument();
    expect(screen.getByText(/Ustawienia/)).toBeInTheDocument();
  });
});
