// Molekuła `ClubLayoutPicker`: wybór układu strony klubu jako RADIOGROUP.
//
// CO TO DOWODZI. Cztery miniatury zamiast droplisty to cała wartość tego
// komponentu (patrz nagłówek pliku), ale wartością użytkową jest tylko wtedy,
// gdy: (1) klik emituje ID TEGO układu, którego miniaturę widać - pomyłka
// w mapowaniu `CLUB_LAYOUTS` -> podglądy daje panel, który zapisuje „karty”
// przy kliknięciu w „magazyn” i nikt tego nie zauważy w recenzji; (2) wybór
// jest ogłoszony czytnikowi ekranu przez `aria-checked`, bo `<button>` sam
// niczego o stanie nie mówi; (3) `disabled` faktycznie odcina zmianę, a nie
// tylko przygasza kafel.
//
// Miniatura każdego układu ma DOMYŚLNIE INNĄ strukturę (lista = kolumna,
// karty = siatka 2x2, magazyn i edytorial = wyróżniony blok) - test pilnuje
// tego przez liczbę pasków, bo to jedyna rzecz, która odróżnia podglądy bez
// zaglądania w klasy Tailwinda.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza, jak układ wygląda na PUBLICZNEJ
// stronie klubu (to `ClubHub` i `clubHubLayout`), ani czy `layout` z RPC jest
// poprawnie zawężany (`isClubLayout` w `types.ts`). Asercje idą na klucze
// i18n, nie na polskie nazwy układów.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-clubs-admin", () => ({ ensureAdminClubsI18n: () => undefined }));

import { ClubLayoutPicker } from "@/components/admin/clubs/molecules/ClubLayoutPicker";
import { CLUB_LAYOUTS, type ClubLayout } from "@/lib/clubs/types";

function options(): HTMLElement[] {
  return screen.getAllByRole("radio");
}

/** Kafel układu - identyfikowany po kluczu i18n nazwy, nie po pozycji. */
function tile(layout: ClubLayout): HTMLElement {
  const found = options().find((option) =>
    (option.textContent ?? "").includes(`adminClubs.layout.${layout}`),
  );
  if (found === undefined) throw new Error(`test: brak kafla układu ${layout}`);
  return found;
}

describe("ClubLayoutPicker - kontrakt radiogroup", () => {
  it("jest grupą radiową z opisem i wystawia kafel na KAŻDY układ ze słownika", () => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("aria-label")).toBe("adminClubs.layout.label");
    expect(options()).toHaveLength(CLUB_LAYOUTS.length);
  });

  it.each(CLUB_LAYOUTS)("kafel %s niesie klucz nazwy i klucz podpowiedzi", (layout) => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    const element = tile(layout);
    expect(element.textContent).toContain(`adminClubs.layout.${layout}`);
    expect(element.textContent).toContain(`adminClubs.layoutHint.${layout}`);
  });

  it.each(CLUB_LAYOUTS)("wybór %s emituje DOKŁADNIE swoje id", (layout) => {
    // Regresja, którą to łapie: przestawienie mapy podglądów albo `key`
    // sprawia, że panel zapisuje inny układ, niż pokazuje miniatura.
    const onChange = vi.fn();
    render(<ClubLayoutPicker value="list" onChange={onChange} />);
    fireEvent.click(tile(layout));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(layout);
  });

  it.each(CLUB_LAYOUTS)("aktywny układ %s jest zaznaczony, pozostałe nie", (layout) => {
    render(<ClubLayoutPicker value={layout} onChange={() => {}} />);
    expect(tile(layout).getAttribute("aria-checked")).toBe("true");
    for (const other of CLUB_LAYOUTS.filter((candidate) => candidate !== layout)) {
      expect(tile(other).getAttribute("aria-checked")).toBe("false");
    }
  });

  it("aktywny kafel niesie pierścień wyboru, pozostałe tylko podświetlenie najazdu", () => {
    render(<ClubLayoutPicker value="magazine" onChange={() => {}} />);
    // `ring-2` jest tu rozstrzygające: `hover:border-primary/50` na kaflach
    // niewybranych też zawiera napis „border-primary”, więc sama krawędź nie
    // odróżnia stanów - odróżnia je pierścień, który widać BEZ najazdu.
    expect(tile("magazine").className).toContain("ring-2 ring-primary/30");
    expect(tile("list").className).not.toContain("ring-primary/30");
    expect(tile("list").className).toContain("hover:border-primary/50");
  });
});

describe("ClubLayoutPicker - kliknięcie i klawiatura", () => {
  it("kliknięcie w AKTYWNY kafel jest bezpieczne - emituje tę samą wartość", () => {
    // Reguła świadoma: komponent jest bezstanowy, więc powtórny wybór woła
    // `onChange` z NIEZMIENIONĄ wartością. Rodzic ustawia identyczny stan,
    // czyli dla użytkownika to no-op - i o to tu chodzi. Gdyby handler
    // emitował „następny” układ albo `undefined`, ten test padłby.
    const onChange = vi.fn();
    render(<ClubLayoutPicker value="cards" onChange={onChange} />);
    fireEvent.click(tile("cards"));
    expect(onChange).toHaveBeenCalledWith("cards");
  });

  it("Enter i Spacja na kaflu wybierają układ - kafel jest `<button>`, nie `<div>`", () => {
    const onChange = vi.fn();
    render(<ClubLayoutPicker value="list" onChange={onChange} />);
    const target = tile("editorial");
    expect(target.tagName).toBe("BUTTON");
    // `fireEvent.click` odwzorowuje domyślną aktywację `<button>` klawiaturą
    // (Enter/Spacja) - to zachowanie przeglądarki, nie kodu komponentu,
    // dlatego asercja pilnuje ELEMENTU, który je zapewnia, oraz jego fokusu.
    expect(target.className).toContain("focus-visible:ring-2");
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledWith("editorial");
  });

  it("każdy kafel jest `type=button` - panel klubu to formularz", () => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    for (const option of options()) {
      expect(option.getAttribute("type")).toBe("button");
    }
  });
});

describe("ClubLayoutPicker - stan zablokowany", () => {
  it("`disabled` odcina wybór, a nie tylko przygasza kafle", () => {
    const onChange = vi.fn();
    render(<ClubLayoutPicker value="list" disabled onChange={onChange} />);
    for (const option of options()) {
      expect(option.hasAttribute("disabled")).toBe(true);
      expect(option.className).toContain("cursor-not-allowed");
    }
    fireEvent.click(tile("cards"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("bez `disabled` kafle nie udają zablokowanych", () => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    for (const option of options()) {
      expect(option.hasAttribute("disabled")).toBe(false);
      expect(option.className).not.toContain("cursor-not-allowed");
    }
  });
});

describe("ClubLayoutPicker - miniatury różnią się STRUKTURĄ", () => {
  /** Liczba pasków „wiersza tekstu” w miniaturze danego kafla. */
  function barCount(layout: ClubLayout): number {
    return tile(layout).querySelectorAll("[style*='width']").length;
  }

  it("każdy podgląd rysuje paski o zadanej szerokości", () => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    for (const layout of CLUB_LAYOUTS) {
      expect(barCount(layout), `podgląd ${layout} nie narysował pasków`).toBeGreaterThan(0);
    }
  });

  it("lista, karty, magazyn i edytorial to CZTERY różne układy, nie ten sam podgląd", () => {
    // Gdyby mapa `PREVIEW` wskazywała jeden komponent dla kilku układów,
    // panel obiecywałby wybór, którego nie widać - a to jest cała wartość
    // tej molekuły.
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    const shapes = CLUB_LAYOUTS.map((layout) => {
      const element = tile(layout);
      return `${barCount(layout)}|${element.querySelectorAll(".grid").length}|${
        element.querySelectorAll(".border-primary\\/40").length
      }`;
    });
    expect(new Set(shapes).size, `podglądy się powtarzają: ${shapes.join(" ")}`).toBe(
      CLUB_LAYOUTS.length,
    );
  });

  it("magazyn i edytorial wyróżniają JEDEN blok - to ich cała różnica wobec listy", () => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    expect(tile("magazine").querySelectorAll(".border-primary\\/40")).toHaveLength(1);
    expect(tile("editorial").querySelectorAll(".border-primary\\/40")).toHaveLength(1);
    expect(tile("list").querySelectorAll(".border-primary\\/40")).toHaveLength(0);
  });

  it("paski `strong` i zwykłe mają różne wypełnienie - hierarchia tytuł/treść", () => {
    render(<ClubLayoutPicker value="list" onChange={() => {}} />);
    const preview = tile("list");
    expect(preview.querySelectorAll(".bg-foreground\\/50").length).toBeGreaterThan(0);
    expect(preview.querySelectorAll(".bg-foreground\\/20").length).toBeGreaterThan(0);
  });
});
