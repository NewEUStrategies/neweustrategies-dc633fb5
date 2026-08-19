// CO DOWODZI TEN PLIK: wiersz checklisty publikacji to JEDYNE miejsce, w którym
// redaktor widzi, czego brakuje we wpisie przed publikacją - i jaka jest waga
// braku. Bramka publikacji jest MIĘKKA (patrz komentarz w
// src/lib/content/publishChecklist.ts): nikt nie zatrzyma wpisu, jeśli wiersz
// skłamie. Dlatego pilnujemy trzech reguł widocznych dla użytkownika:
//   1. ikona koduje stan: spełnione -> potwierdzenie, brak wymaganego -> krzyżyk
//      (alarm), brak zalecanego -> kółko (informacja). Rozjazd tego mapowania
//      sprawia, że brak OKŁADKI wygląda jak drobiazg, a redakcja publikuje wpis
//      bez obrazka do social mediów.
//   2. spełnienie wygrywa nad poziomem - pozycja `ok` NIGDY nie ma pokazywać
//      alarmu, bo redaktor zacząłby szukać braku, którego nie ma.
//   3. etykieta jest WYLICZANA z identyfikatora pozycji, nie z ręcznego switcha
//      - dzięki temu nowa pozycja checklisty dostaje etykietę bez dotykania
//      atomu (a literówka w id widać jako surowy klucz, nie jako puste miejsce).
//
// Asercje idą po KLUCZACH i18n (stub tłumaczeń zwraca klucz), bo parytetu
// i istnienia kluczy pilnują osobne bramki, a test przywiązany do polskiego
// copy pękałby przy każdej korekcie redakcyjnej.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ChecklistItem, ChecklistItemId } from "@/lib/content/publishChecklist";
import { translateKey as k } from "@/test/post-editor/fixtures";
import { ChecklistItemRow } from "../ChecklistItemRow";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
// Nakładka i18n jest importowana tylko dla side-effectu (rejestracja zasobów) -
// w teście nie chcemy inicjalizować całego i18n.
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

// Ikony podmieniamy na znaczniki `data-icon`, żeby asercja mówiła „atom wybrał
// ikonę potwierdzenia", a nie „atom dołożył klasę text-emerald-600". Kolor jest
// szczegółem wykończenia, WYBÓR ikony jest kontraktem stanu.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  const stub = (name: string) => (props: Record<string, unknown>) => (
    <svg data-icon={name} aria-hidden={props["aria-hidden"] as boolean | undefined} />
  );
  return { ...actual, Check: stub("check"), X: stub("x"), Circle: stub("circle") };
});

function item(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return { id: "cover", level: "required", ok: true, ...overrides };
}

/** Wiersz żyje wyłącznie wewnątrz <ul> karty - renderujemy go w tym kontekście. */
function renderRow(i: ChecklistItem) {
  return render(
    <ul>
      <ChecklistItemRow item={i} />
    </ul>,
  );
}

/** Który wariant ikony trafił do DOM (dokładnie jeden na wiersz). */
function iconNames(): string[] {
  return Array.from(document.querySelectorAll("svg[data-icon]")).map(
    (el) => el.getAttribute("data-icon") ?? "",
  );
}

afterEach(cleanup);

describe("ChecklistItemRow - ikona koduje stan pozycji", () => {
  it("pozycja spełniona: potwierdzenie i żadnego alarmu", () => {
    renderRow(item({ ok: true, level: "required" }));
    expect(iconNames()).toEqual(["check"]);
  });

  it("brak pozycji WYMAGANEJ: krzyżyk - to on odróżnia blokadę gotowości od porady", () => {
    renderRow(item({ ok: false, level: "required" }));
    expect(iconNames()).toEqual(["x"]);
  });

  it("brak pozycji ZALECANEJ jest łagodniejszy: kółko, nie krzyżyk", () => {
    renderRow(item({ ok: false, level: "recommended" }));
    expect(iconNames()).toEqual(["circle"]);
  });

  it("spełnienie wygrywa nad poziomem: zalecana i spełniona to też potwierdzenie", () => {
    renderRow(item({ ok: true, level: "recommended" }));
    expect(iconNames()).toEqual(["check"]);
  });
});

describe("ChecklistItemRow - etykieta pochodzi z identyfikatora pozycji", () => {
  // Pełny słownik identyfikatorów z publishChecklist.ts. Gdyby atom miał
  // ręczne mapowanie id -> etykieta, ten test pokazałby brakującą gałąź
  // natychmiast po dodaniu nowej pozycji checklisty.
  const ALL_IDS: ChecklistItemId[] = [
    "titlePl",
    "cover",
    "category",
    "descriptionPl",
    "takeaways",
    "tags",
    "enVersion",
    "indexable",
    "sponsoredDisclosure",
  ];

  it.each(ALL_IDS)("pozycja %s dostaje własny klucz etykiety", (id) => {
    renderRow(item({ id }));
    expect(screen.getByRole("listitem")).toHaveTextContent(
      k(`adminPostPanes.publishChecklist.items.${id}`),
    );
  });

  it("wiersz jest pozycją listy, więc czytnik ekranu potrafi je zliczyć", () => {
    renderRow(item({ id: "tags", level: "recommended", ok: false }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("ChecklistItemRow - dostępność stanu", () => {
  // SWIADEK DEFEKTU (D1): stan pozycji jest przekazywany WYŁĄCZNIE ikoną,
  // a ikona jest `aria-hidden`. Czytnik ekranu odczytuje dla pozycji spełnionej
  // i brakującej DOKŁADNIE ten sam tekst, więc niewidzący redaktor nie dowie
  // się z checklisty niczego. Test opisuje stan OBECNY - gdy ktoś doda tekst
  // alternatywny (np. „spełnione"/„brak" w warstwie tylko dla czytnika), ten
  // test celowo pęknie i trzeba go przepisać na nowe, lepsze zachowanie.
  it("stan NIE dociera do czytnika ekranu: ten sam tekst dla spełnionej i brakującej pozycji", () => {
    const { unmount } = renderRow(item({ id: "cover", ok: true }));
    const satisfied = screen.getByRole("listitem").textContent;
    unmount();

    renderRow(item({ id: "cover", ok: false }));
    const missing = screen.getByRole("listitem").textContent;

    expect(satisfied).toBe(missing);
    expect(satisfied?.trim()).toBe(k("adminPostPanes.publishChecklist.items.cover"));
  });

  it("ikona jest ukryta dla technologii asystujących (nie dubluje etykiety)", () => {
    renderRow(item({ ok: false, level: "required" }));
    expect(document.querySelector("svg[data-icon='x']")).toHaveAttribute("aria-hidden", "true");
  });
});
