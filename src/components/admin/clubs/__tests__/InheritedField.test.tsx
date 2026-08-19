// Atom `InheritedField`: JAWNE dziedziczenie ustawienia działu z klubu.
//
// CO TO DOWODZI. To nie dekoracja, a reguła interfejsu opisana w nagłówku
// komponentu: pole z wartością odziedziczoną wygląda identycznie jak pole
// ustawione ręcznie, więc bez etykiety i bez wyszarzenia administrator
// zmienia ustawienie KLUBU i „bez powodu" nic się nie dzieje - bo dział ma
// nadpisanie. Test pilnuje trzech rzeczy, które o tym decydują:
//   1. wariant „odziedziczone" vs „nadpisane" niesie INNY klucz i18n
//      i INNĄ ikonę (spięte vs rozerwane ogniwo),
//   2. pole odziedziczone jest realnie nieaktywne (`pointer-events-none`),
//      a nie tylko przygaszone - inaczej klik przechodzi i cicho nadpisuje,
//   3. przełącznik emituje NEGACJĘ obecnego stanu, nie stałą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie testuje, skąd bierze się `inherited` -
// to kolumny `*_inherited` z RPC i rozwiązywanie dziedziczenia po stronie
// bazy (pgTAP `community_groups`), ani samego `ClubGroupsTab`, który ten atom
// składa. Nie sprawdza treści tłumaczeń - asercje idą na klucze.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { InheritedField } from "@/components/admin/clubs/atoms/InheritedField";

const INHERIT_KEY = "club.inheritedFromClub";
const OVERRIDE_KEY = "adminClubs.groups.override";

function toggle(): HTMLElement {
  return screen.getByRole("button");
}

/** Kontener dzieci - rodzeństwo nagłówka, więc szukamy przez samo dziecko. */
function fieldBox(): HTMLElement {
  const child = screen.getByTestId("pole");
  const parent = child.parentElement;
  if (parent === null) throw new Error("test: pole nie ma kontenera");
  return parent;
}

describe("InheritedField - wariant odziedziczony", () => {
  it("mówi WPROST, że wartość pochodzi z klubu", () => {
    render(
      <InheritedField label="Widoczność" inherited onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    expect(screen.getByText("Widoczność")).toBeTruthy();
    expect(toggle().textContent).toContain(INHERIT_KEY);
    expect(toggle().textContent).not.toContain(OVERRIDE_KEY);
  });

  it("blokuje pole ODCINAJĄC ZDARZENIA, nie tylko je przygaszając", () => {
    // Sam `opacity` przepuszcza klik i pozwala nadpisać wartość „przypadkiem",
    // co jest dokładnie tym błędem, przed którym ten atom ma chronić.
    render(
      <InheritedField label="Widoczność" inherited onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    const box = fieldBox();
    expect(box.className).toContain("pointer-events-none");
    expect(box.className).toContain("opacity-55");
  });

  it("kliknięcie przełącznika prosi o NADPISANIE (`false` -> `true`)", () => {
    const onToggleInherit = vi.fn();
    render(
      <InheritedField label="Widoczność" inherited onToggleInherit={onToggleInherit}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    fireEvent.click(toggle());
    expect(onToggleInherit).toHaveBeenCalledTimes(1);
    expect(onToggleInherit).toHaveBeenCalledWith(false);
  });
});

describe("InheritedField - wariant nadpisany", () => {
  it("mówi WPROST, że wartość jest ustawiona na dziale", () => {
    render(
      <InheritedField label="Widoczność" inherited={false} onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    expect(toggle().textContent).toContain(OVERRIDE_KEY);
    expect(toggle().textContent).not.toContain(INHERIT_KEY);
  });

  it("pole jest AKTYWNE - nadpisanie ma się dać edytować", () => {
    render(
      <InheritedField label="Widoczność" inherited={false} onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    const box = fieldBox();
    expect(box.className).not.toContain("pointer-events-none");
    expect(box.className).not.toContain("opacity-55");
  });

  it("kliknięcie przełącznika prosi o POWRÓT do dziedziczenia (`true`)", () => {
    const onToggleInherit = vi.fn();
    render(
      <InheritedField label="Widoczność" inherited={false} onToggleInherit={onToggleInherit}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    fireEvent.click(toggle());
    expect(onToggleInherit).toHaveBeenCalledWith(true);
  });

  it("przełącznik nadpisania jest wyróżniony kolorem akcji", () => {
    render(
      <InheritedField label="Widoczność" inherited={false} onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    expect(toggle().className).toContain("text-primary");
  });
});

describe("InheritedField - stany brzegowe", () => {
  it("`disabled` blokuje sam PRZEŁĄCZNIK, nie tylko pole", () => {
    // Bez tego administrator bez uprawnień do zmiany ustawień klubu widzi
    // przycisk, którego każde użycie kończy się odmową z RPC.
    const onToggleInherit = vi.fn();
    render(
      <InheritedField label="Widoczność" inherited disabled onToggleInherit={onToggleInherit}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    const button = toggle();
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onToggleInherit).not.toHaveBeenCalled();
  });

  it("`hint` renderuje się tylko wtedy, gdy jest - brak podpowiedzi nie zostawia pustego akapitu", () => {
    const { container, unmount } = render(
      <InheritedField
        label="Widoczność"
        inherited
        hint="Dział nie może być szerszy niż klub"
        onToggleInherit={() => {}}
      >
        <input data-testid="pole" />
      </InheritedField>,
    );
    expect(screen.getByText("Dział nie może być szerszy niż klub")).toBeTruthy();
    expect(container.querySelectorAll("p").length).toBe(1);
    unmount();

    const bare = render(
      <InheritedField label="Widoczność" inherited onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    expect(bare.container.querySelectorAll("p").length).toBe(0);
  });

  it("przełącznik jest `type=button` - w formularzu nie może wysyłać", () => {
    // Ten atom żyje wewnątrz formularza edycji działu; `type` domyślny
    // („submit") zapisywałby dział przy każdym przełączeniu dziedziczenia.
    render(
      <InheritedField label="Widoczność" inherited onToggleInherit={() => {}}>
        <input data-testid="pole" />
      </InheritedField>,
    );
    expect(toggle().getAttribute("type")).toBe("button");
  });
});
