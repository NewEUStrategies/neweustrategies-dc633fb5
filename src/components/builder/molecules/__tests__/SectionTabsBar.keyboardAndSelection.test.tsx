// PASEK ZAKŁADEK SEKCJI (`SectionTabsBar`) - KLAWIATURA, WYBÓR I DANE Z CMS.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Renderer sekcji (`builderRenderer.tabs.test.tsx`) dowodzi PANELU: która
// treść jest widoczna po kliknięciu i jak panel wskazuje przycisk. Tu dowodzimy
// samego paska, czyli tego, co czytelnik naprawdę obsługuje:
// * wzorzec ARIA „tabs": `tablist` z orientacją, `tab` z nazwą, `aria-selected`,
//   `aria-controls` na panel i ROVING TABINDEX (tylko aktywna zakładka w
//   kolejności Tab) - bez tego czytnik ekranu i klawiatura gubią pasek,
// * klawiaturę z wzorca APG: strzałki z zawijaniem na końcach, Home/End,
//   strzałki pionowe TYLKO w orientacji pionowej, `preventDefault` wyłącznie dla
//   obsłużonych klawiszy (inaczej strzałka w dół przewijałaby stronę albo
//   przestawała ją przewijać) i wyłącznik `keyboard`,
// * wybór myszą i przeciąganiem: klik NIE dociera do kanwy buildera (zaznaczenie
//   sekcji), a przeciągnięcie widgetu nad nieaktywną zakładkę otwiera ją, żeby
//   dało się upuścić treść na inną zakładkę,
// * dane z CMS (kolumna jsonb): etykieta z rezerwą językową i bez pustego
//   przycisku, rozmiary przycięte do zakresu pól panelu, kolor zakładki
//   wygrywający z akcentem globalnym.
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Bez atrap: komponent jest czysty (propsy -> DOM), a `DynamicIcon` dla nazwy
// z zestawu bazowego renderuje SVG synchronicznie. Kolor sprawdzamy w stylu
// inline, bo to on JEST kontraktem „kolor z panelu trafia na zakładkę" - klasy
// CSS paska są stałe i nie niosą danych.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SectionTabItem, SectionTabsConfig } from "@/lib/builder/types";
import { SectionTabsBar } from "../SectionTabsBar";

afterEach(cleanup);

const POZYCJE: SectionTabItem[] = [
  { id: "a", label_pl: "Program" },
  { id: "b", label_pl: "Prelegenci" },
  { id: "c", label_pl: "Bilety" },
];

function konfig(extra: Partial<SectionTabsConfig> = {}): SectionTabsConfig {
  return { enabled: true, items: POZYCJE, ...extra } as SectionTabsConfig;
}

function renderPasek(
  props: {
    tabs?: SectionTabsConfig;
    activeId?: string;
    lang?: "pl" | "en";
    keyboard?: boolean;
  } = {},
) {
  const onSelect = vi.fn();
  const view = render(
    <SectionTabsBar
      sectionId="sek"
      tabs={props.tabs ?? konfig()}
      lang={props.lang ?? "pl"}
      activeId={props.activeId ?? "a"}
      onSelect={onSelect}
      keyboard={props.keyboard}
    />,
  );
  return { ...view, onSelect };
}

const zakladka = (nazwa: string) => screen.getByRole("tab", { name: nazwa });

describe("SectionTabsBar - wzorzec ARIA tabs", () => {
  it("tablist z orientacją, zakładki z nazwą, stanem i powiązaniem z panelem", () => {
    renderPasek({ activeId: "b" });
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("horizontal");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Program",
      "Prelegenci",
      "Bilety",
    ]);
    const aktywna = zakladka("Prelegenci");
    expect(aktywna.getAttribute("aria-selected")).toBe("true");
    expect(zakladka("Program").getAttribute("aria-selected")).toBe("false");
    // Identyfikatory MUSZĄ zgadzać się z panelem renderera
    // (`sec-<sekcja>-panel-<zakładka>` / `aria-labelledby` na przycisk).
    expect(aktywna.id).toBe("sec-sek-tab-b");
    expect(aktywna.getAttribute("aria-controls")).toBe("sec-sek-panel-b");
  });

  it("roving tabindex: w kolejności Tab jest wyłącznie aktywna zakładka", () => {
    renderPasek({ activeId: "c" });
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("orientacja pionowa trafia do aria-orientation", () => {
    renderPasek({ tabs: konfig({ orientation: "vertical" }) });
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
  });

  it.each([
    ["pusta lista pozycji", { items: [] }],
    ["brak listy pozycji", { items: undefined }],
  ])("%s nie renderuje pustego paska", (_opis, extra) => {
    const { container } = renderPasek({ tabs: konfig(extra as Partial<SectionTabsConfig>) });
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it("ikona zakładki jest dekoracją - nie zmienia nazwy dostępnej", () => {
    renderPasek({
      tabs: konfig({ items: [{ id: "a", label_pl: "Kalendarz", icon: "calendar" }] }),
    });
    const tab = zakladka("Kalendarz");
    expect(tab.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("SectionTabsBar - klawiatura (APG)", () => {
  it.each([
    ["ArrowRight z pierwszej", "a", "ArrowRight", "b"],
    ["ArrowRight z ostatniej zawija na pierwszą", "c", "ArrowRight", "a"],
    ["ArrowLeft ze środkowej", "b", "ArrowLeft", "a"],
    ["ArrowLeft z pierwszej zawija na ostatnią", "a", "ArrowLeft", "c"],
    ["Home", "c", "Home", "a"],
    ["End", "a", "End", "c"],
  ])("%s wybiera właściwą zakładkę i blokuje domyślną akcję", (_opis, start, key, cel) => {
    const { onSelect } = renderPasek({ activeId: start });
    const aktywna = screen.getAllByRole("tab").find((t) => t.tabIndex === 0)!;
    expect(fireEvent.keyDown(aktywna, { key })).toBe(false);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(cel);
  });

  it("w orientacji pionowej działają strzałki góra/dół", () => {
    const { onSelect } = renderPasek({ tabs: konfig({ orientation: "vertical" }), activeId: "b" });
    fireEvent.keyDown(zakladka("Prelegenci"), { key: "ArrowDown" });
    fireEvent.keyDown(zakladka("Prelegenci"), { key: "ArrowUp" });
    expect(onSelect.mock.calls).toEqual([["c"], ["a"]]);
  });

  it("ODMOWA: w orientacji poziomej strzałka w dół nie przełącza i nie blokuje przewijania", () => {
    const { onSelect } = renderPasek({ activeId: "b" });
    expect(fireEvent.keyDown(zakladka("Prelegenci"), { key: "ArrowDown" })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([["Enter"], ["a"], ["Tab"]])(
    "ODMOWA: klawisz %s spoza wzorca nie przełącza i nie jest blokowany",
    (key) => {
      const { onSelect } = renderPasek();
      expect(fireEvent.keyDown(zakladka("Program"), { key })).toBe(true);
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it("ODMOWA: keyboard={false} wyłącza nawigację strzałkami", () => {
    const { onSelect } = renderPasek({ keyboard: false });
    expect(fireEvent.keyDown(zakladka("Program"), { key: "ArrowRight" })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ODMOWA: aktywny identyfikator spoza listy (stan przejściowy po edycji) nie wybiera nic", () => {
    // Renderer koryguje aktywną zakładkę efektem PO renderze; w tym oknie
    // strzałka nie może wylosować zakładki z indeksu -1.
    const { onSelect } = renderPasek({ activeId: "usunieta" });
    fireEvent.keyDown(zakladka("Program"), { key: "ArrowRight" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("SectionTabsBar - mysz i przeciąganie w kanwie", () => {
  it("klik wybiera zakładkę, a klik, mousedown i pointerdown nie docierają do kanwy", () => {
    const kanwa = vi.fn();
    const onSelect = vi.fn();
    render(
      <div onClick={kanwa} onMouseDown={kanwa} onPointerDown={kanwa}>
        <SectionTabsBar
          sectionId="sek"
          tabs={konfig()}
          lang="pl"
          activeId="a"
          onSelect={onSelect}
        />
      </div>,
    );
    const tab = zakladka("Bilety");
    fireEvent.pointerDown(tab);
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
    // Kanwa zaznaczałaby sekcję i przestawiała panel właściwości przy każdym
    // przełączeniu zakładki.
    expect(kanwa).not.toHaveBeenCalled();
  });

  it("przeciągnięcie treści nad NIEAKTYWNĄ zakładkę otwiera ją (upuszczenie na inną zakładkę)", () => {
    const { onSelect } = renderPasek({ activeId: "a" });
    fireEvent.dragEnter(zakladka("Bilety"), { dataTransfer: { types: ["text/plain"] } });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("c");
  });

  it.each([
    ["nad aktywną zakładką", "Program", ["text/plain"]],
    ["bez przenoszonych danych (np. zaznaczenie tekstu)", "Bilety", []],
  ])("ODMOWA: przeciąganie %s nie przełącza", (_opis, nazwa, types) => {
    const { onSelect } = renderPasek({ activeId: "a" });
    fireEvent.dragEnter(zakladka(nazwa), { dataTransfer: { types } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("dragover jest anulowany - inaczej przeglądarka nie pozwoli upuścić na zakładkę", () => {
    renderPasek();
    expect(fireEvent.dragOver(zakladka("Bilety"))).toBe(false);
  });
});

describe("SectionTabsBar - dane z CMS", () => {
  it.each<[string, "pl" | "en", Partial<SectionTabItem>, string]>([
    ["EN z angielską etykietą", "en", { label_pl: "Program", label_en: "Agenda" }, "Agenda"],
    [
      "EN z pustą angielską spada na polską",
      "en",
      { label_pl: "Program", label_en: "  " },
      "Program",
    ],
    ["PL bez polskiej bierze angielską", "pl", { label_en: "Agenda" }, "Agenda"],
    ["brak obu etykiet daje napis zastępczy, nie pusty przycisk", "pl", {}, "Tab"],
  ])("etykieta: %s", (_opis, lang, etykiety, oczekiwana) => {
    renderPasek({ lang, tabs: konfig({ items: [{ id: "a", ...etykiety } as SectionTabItem] }) });
    expect(screen.getByRole("tab").textContent).toBe(oczekiwana);
  });

  it.each([
    ["za duże wartości do górnej granicy pola", 200, 100, "48px", "32"],
    ["za małe wartości do dolnej granicy pola", 1, 2, "8px", "10"],
  ])("rozmiary z bazy przycięte: %s", (_opis, fontSize, iconSize, font, ikona) => {
    renderPasek({
      tabs: konfig({
        fontSize,
        iconSize,
        items: [{ id: "a", label_pl: "Kalendarz", icon: "calendar" }],
      }),
    });
    const tab = zakladka("Kalendarz");
    expect(tab.style.fontSize).toBe(font);
    expect(tab.querySelector("svg")?.getAttribute("width")).toBe(ikona);
  });

  it("kolor zakładki wygrywa z akcentem globalnym, a reszta zakładek bierze akcent", () => {
    const tabs = konfig({
      variant: "pills-solid",
      accentColor: "rgb(0, 0, 255)",
      items: [
        { id: "a", label_pl: "Własny", color: "rgb(255, 0, 0)" },
        { id: "b", label_pl: "Akcent" },
      ],
    });
    const { rerender, onSelect } = renderPasek({ activeId: "a", tabs });
    expect(zakladka("Własny").style.background).toBe("rgb(255, 0, 0)");
    rerender(
      <SectionTabsBar sectionId="sek" lang="pl" activeId="b" onSelect={onSelect} tabs={tabs} />,
    );
    expect(zakladka("Akcent").style.background).toBe("rgb(0, 0, 255)");
    // Nieaktywna zakładka nie dostaje tła - wyróżnienie niesie tylko aktywna.
    expect(zakladka("Własny").style.background).toBe("transparent");
  });

  it("pusty akcent z panelu nie zostawia pustego koloru - wraca token marki", () => {
    // HTML serwera, nie DOM happy-dom: parser stylu happy-dom odrzuca `var()`
    // w skrócie `background`, więc odczyt z `element.style` byłby pusty.
    const html = renderToStaticMarkup(
      <SectionTabsBar
        sectionId="sek"
        lang="pl"
        activeId="a"
        onSelect={() => {}}
        tabs={konfig({ variant: "pills-solid", accentColor: "   " })}
      />,
    );
    expect(html).toContain("background:var(--brand, currentColor)");
  });

  const AKCENT = "rgb(12, 34, 56)";

  it.each([
    "underline",
    "underline-thick",
    "underline-gradient",
    "underline-dot",
    "boxed-top",
  ] as const)("wariant %s: wskaźnik widać tylko na aktywnej zakładce", (variant) => {
    renderPasek({ activeId: "b", tabs: konfig({ variant, accentColor: AKCENT }) });
    const wskaznik = (nazwa: string) =>
      zakladka(nazwa).querySelector<HTMLElement>('span[aria-hidden="true"]')!;
    expect(wskaznik("Prelegenci").style.opacity).toBe("1");
    expect(wskaznik("Program").style.opacity).toBe("0");
  });

  it("wskaźnik niesie akcent z panelu - także jako gradient wariantu underline-gradient", () => {
    // HTML serwera: happy-dom odrzuca `linear-gradient` w skrócie `background`.
    const html = (variant: string) =>
      renderToStaticMarkup(
        <SectionTabsBar
          sectionId="sek"
          lang="pl"
          activeId="a"
          onSelect={() => {}}
          tabs={konfig({ variant, accentColor: AKCENT } as Partial<SectionTabsConfig>)}
        />,
      );
    expect(html("underline")).toContain(`background:${AKCENT}`);
    expect(html("underline-gradient")).toContain(`background:linear-gradient(90deg, ${AKCENT},`);
  });

  it.each(["pills", "pills-solid", "bordered", "segmented", "minimal"] as const)(
    "wariant %s: akcent niesie sam przycisk aktywnej zakładki, nie nieaktywnej",
    (variant) => {
      renderPasek({ activeId: "b", tabs: konfig({ variant, accentColor: AKCENT }) });
      expect(zakladka("Prelegenci").getAttribute("style")).toContain(AKCENT);
      expect(zakladka("Program").getAttribute("style")).not.toContain(AKCENT);
    },
  );

  it("wariant ghost (i nieznany z bazy) podświetla tło tylko aktywnej zakładki", () => {
    for (const variant of ["ghost", "z-nowszej-wersji"]) {
      cleanup();
      renderPasek({ activeId: "b", tabs: konfig({ variant } as Partial<SectionTabsConfig>) });
      expect(zakladka("Prelegenci").style.background).not.toBe("transparent");
      expect(zakladka("Program").style.background).toBe("transparent");
    }
  });
});
