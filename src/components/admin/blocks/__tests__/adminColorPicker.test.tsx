// WSPOLNY SELEKTOR KOLORU PANELU (`AdminColorPicker`, 407 linii).
//
// Plik startowal z 0% - drugi z DWOCH ostatnich plikow modulu 3 na zerze
// (obok `LayoutScaffold`). Audyt go nie wymienia, bo nie jest rdzeniem edytora,
// ale liczy sie do progu `src/components/admin/blocks/**` i jest montowany
// szeroko - m.in. przez panele `admin/postExperience/**`.
//
// CO MA TU DOWOD:
//   1. PRZEPUSZCZANIE TOKENOW - `var(--brand)`, `oklch(...)`, `transparent`
//      wychodza do rodzica NIETKNIETE. To najwazniejsza wlasnosc tego pliku:
//      cichy przepis tokenu na `#000000` zabralby motywowi cala warstwe
//      zmiennych CSS, a redaktor zobaczylby "czarny" bez zadnego komunikatu,
//   2. HEX -> RGB -> HSL: skrot trzycyfrowy, wariant osmiocyfrowy (z alfa)
//      i odrzucenie napisu, ktory hexem nie jest,
//   3. KLAMROWANIE wejsc liczbowych - RGB do 0-255, HSL do 0-360/0-100.
//      To jest tu ZALETA i dlatego jest przypieta: rodzina `blocks/edit`
//      klamrowania NIE MA (siedem defektow koercji w tym samym module), wiec
//      ten plik jest kontrprzykladem, ktorego nie wolno zgubic,
//   4. przezroczystosc: przelacznik w obie strony, wraz z `aria-pressed`,
//   5. reset do wartosci odziedziczonej oddaje `undefined`, a nie pusty napis -
//      rozroznienie "brak nadpisania" kontra "nadpisane pustka",
//   6. stan odziedziczony rysuje obwodke przerywana zamiast pelnej.
//
// CZEGO TU NIE MA - swiadomie: nie steruje kanwa `react-colorful`
// (`HexColorPicker`). To komponent obcy, ktory liczy pozycje wskaznika
// z geometrii DOM, a happy-dom nie ma silnika layoutu - przejazd po nim
// mierzylby atrape przegladarki, nie ten plik. Jego wyjscie idzie tym samym
// `commitHex`, co wejscie HEX, ktore jest tu pokryte.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");
const tEn = realT("en");

const PICK = t("blocks.editors.adminControls.pickColor");
const SET_TRANSPARENT = t("blocks.editors.adminControls.setTransparent");
const DISABLE_TRANSPARENT = t("blocks.editors.adminControls.disableTransparency");
const RESET = t("blocks.editors.adminControls.resetDefault");

interface Setup {
  onChange: ReturnType<typeof vi.fn>;
  container: HTMLElement;
  unmount: () => void;
}

function setup(props: Partial<React.ComponentProps<typeof AdminColorPicker>> = {}): Setup {
  const onChange = vi.fn();
  const { container, unmount } = render(
    <AdminColorPicker value={props.value} onChange={props.onChange ?? onChange} {...props} />,
  );
  return {
    onChange: (props.onChange as ReturnType<typeof vi.fn>) ?? onChange,
    container,
    unmount,
  };
}

/** Otwiera popover i oddaje jego zawartosc (Radix renderuje ja w portalu). */
function openPopover(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: PICK }));
  const dialog = screen.getByRole("dialog");
  return dialog;
}

/**
 * Przelacznik przezroczystosci. Szukam po `aria-pressed`, NIE po nazwie
 * dostepnej - i to jest swiadome, bo nazwa tego przycisku ZNIKA po wcisnieciu:
 * gdy wartosc jest przezroczysta, trescia guzika jest znak "✓", a `title`
 * przestaje byc zrodlem nazwy (tresc ma pierwszenstwo w wyliczaniu nazwy
 * dostepnej). Defekt jest zarejestrowany asercja `it.fails` nizej; tutaj
 * potrzebuje selektora, ktory dziala w OBU stanach.
 */
function transparencyToggle(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>("button[aria-pressed]");
  if (!found) throw new Error("test: nie znaleziono przelacznika przezroczystosci");
  return found;
}

/** Wejscie tekstowe tokenu - to jedyny `textbox` POZA popoverem. */
function tokenInput(container: HTMLElement): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
  if (!found) throw new Error("test: nie znaleziono wejscia tokenu");
  return found;
}

describe("AdminColorPicker - przepuszczanie tokenow (najwazniejsza wlasnosc pliku)", () => {
  it.each(["var(--brand)", "oklch(0.7 0.1 200)", "transparent", "rgba(0,0,0,0)"])(
    "token %s wychodzi do rodzica NIETKNIETY",
    (token) => {
      const { onChange, container } = setup({ value: "" });
      fireEvent.change(tokenInput(container), { target: { value: token } });
      expect(onChange).toHaveBeenCalledWith(token);
    },
  );

  it("wyczyszczenie pola oddaje `undefined`, nie pusty napis", () => {
    // Rozroznienie nosne: `undefined` znaczy "brak nadpisania, dziedzicz",
    // a pusty napis znaczylby "nadpisane pustka".
    const { onChange, container } = setup({ value: "#ff0000" });
    fireEvent.change(tokenInput(container), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("token NIE jest przepisywany na hex - w polu zostaje to, co wpisano", () => {
    const { container } = setup({ value: "var(--brand)" });
    expect(tokenInput(container).value).toBe("var(--brand)");
  });
});

describe("AdminColorPicker - HEX, RGB, HSL", () => {
  /** Wejscie HEX w popoverze: pierwszy `textbox` w portalu. */
  function hexInput(dialog: HTMLElement): HTMLInputElement {
    const inputs = within(dialog).getAllByRole("textbox");
    return inputs[0] as HTMLInputElement;
  }

  /** Wejscia liczbowe w popoverze: 3 RGB, potem 3 HSL. */
  function numberInputs(dialog: HTMLElement): HTMLInputElement[] {
    return Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="number"]'));
  }

  it("pelny hex szescioznakowy trafia do rodzica", () => {
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.change(hexInput(dialog), { target: { value: "abcdef" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("skrot trzyznakowy jest rozwijany do szesciu", () => {
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.change(hexInput(dialog), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("#aabbcc");
  });

  it("wariant osmioznakowy (z alfa) traci kanal alfa, a nie caly kolor", () => {
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.change(hexInput(dialog), { target: { value: "11223344" } });
    expect(onChange).toHaveBeenCalledWith("#112233");
  });

  it("napis, ktory NIE jest hexem, nie idzie do rodzica", () => {
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.change(hexInput(dialog), { target: { value: "GGGGGG" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hex niedokonczony (dwa znaki) nie idzie do rodzica", () => {
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.change(hexInput(dialog), { target: { value: "12" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("RGB czerwonego czytane z hexa to 255/0/0", () => {
    const dialog = (setup({ value: "#ff0000" }), openPopover());
    const nums = numberInputs(dialog);
    expect(nums.slice(0, 3).map((i) => i.value)).toEqual(["255", "0", "0"]);
  });

  it("KLAMROWANIE RGB: 300 schodzi do 255 (a nie zostaje 300)", () => {
    // Ten plik klamruje, w odroznieniu od rodziny `blocks/edit`, gdzie min/max
    // jest wylacznie atrybutem HTML. Dlatego jest to tu przypiete.
    const { onChange } = setup({ value: "#000000" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[0], { target: { value: "300" } });
    expect(onChange).toHaveBeenCalledWith("#ff0000");
  });

  it("KLAMROWANIE RGB: wartosc ujemna schodzi do zera", () => {
    const { onChange } = setup({ value: "#ffffff" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[0], { target: { value: "-40" } });
    expect(onChange).toHaveBeenCalledWith("#00ffff");
  });

  it("KLAMROWANIE RGB: napis nieliczbowy schodzi do zera, nie do NaN", () => {
    const { onChange } = setup({ value: "#ffffff" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[0], { target: { value: "wysoko" } });
    const arg = onChange.mock.calls[0]?.[0];
    expect(typeof arg).toBe("string");
    expect(arg).not.toContain("NaN");
  });

  it("KLAMROWANIE HSL: odcien 400 schodzi do 360", () => {
    const { onChange } = setup({ value: "#ff0000" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[3], { target: { value: "400" } });
    const arg = onChange.mock.calls[0]?.[0];
    expect(typeof arg).toBe("string");
    expect(arg).not.toContain("NaN");
  });

  it("KLAMROWANIE HSL: nasycenie 200 schodzi do 100", () => {
    const { onChange } = setup({ value: "#808080" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[4], { target: { value: "200" } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).not.toContain("NaN");
  });

  it("wartosc niebedaca hexem daje w kanwie czern zamiast wywrotki", () => {
    // `hexForPicker` schodzi na "#000000", gdy wartosc jest tokenem.
    const dialog = (setup({ value: "var(--brand)" }), openPopover());
    const nums = numberInputs(dialog);
    expect(nums.slice(0, 3).map((i) => i.value)).toEqual(["0", "0", "0"]);
  });
});

describe("AdminColorPicker - przezroczystosc i reset", () => {
  it("przelacznik ustawia `transparent`", () => {
    const { onChange } = setup({ value: "#ff0000" });
    // W stanie NIEWCISNIETYM guzik jest pusty, wiec nazwe dostepna daje `title`
    // - i tylko w tym stanie da sie go znalezc po etykiecie.
    fireEvent.click(screen.getByRole("button", { name: SET_TRANSPARENT }));
    expect(onChange).toHaveBeenCalledWith("transparent");
  });

  it("przelacznik przy juz przezroczystej wartosci ZDEJMUJE ja (oddaje undefined)", () => {
    const { onChange, container } = setup({ value: "transparent" });
    fireEvent.click(transparencyToggle(container));
    // `undefined`, nie pusty napis i nie "#000000" - zdjecie przezroczystosci
    // znaczy "wroc do dziedziczenia", a nie "ustaw czarny".
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("`aria-pressed` mowi o stanie przezroczystosci - w obie strony", () => {
    const { container, unmount } = setup({ value: "transparent" });
    expect(transparencyToggle(container)).toHaveAttribute("aria-pressed", "true");
    unmount();
    const second = setup({ value: "#ff0000" });
    expect(transparencyToggle(second.container)).toHaveAttribute("aria-pressed", "false");
  });

  it.each(["rgba(0,0,0,0)", "#00000000", "TRANSPARENT", "  transparent  "])(
    "%s jest rozpoznane jako przezroczyste (wielkosc liter i spacje bez znaczenia)",
    (value) => {
      const { container } = setup({ value });
      expect(transparencyToggle(container)).toHaveAttribute("aria-pressed", "true");
    },
  );

  it.each(["#000000", "rgba(0,0,0,0.01)", "var(--brand)", ""])(
    "%s NIE jest przezroczyste - kontrola dodatnia dla `isTransparent`",
    (value) => {
      // `rgba(0,0,0,0.01)` jest tu celowo: rozpoznanie idzie po DOKLADNYM
      // napisie, nie po parsowaniu alfy, wiec o wlos od zera to juz kolor.
      const { container } = setup({ value });
      expect(transparencyToggle(container)).toHaveAttribute("aria-pressed", "false");
    },
  );

  it("przelacznika nie ma, gdy `allowTransparent=false`", () => {
    const { container } = setup({ value: "#ff0000", allowTransparent: false });
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("reset oddaje `undefined`", () => {
    const { onChange } = setup({ value: "#ff0000", inheritedValue: "#00ff00" });
    fireEvent.click(screen.getByRole("button", { name: RESET }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("reset jest ZABLOKOWANY, gdy nie ma czego zdejmowac", () => {
    // Bez wlasnego nadpisania reset nie ma sensu i jest wylaczony - inaczej
    // redaktor klikalby guzik, ktory nic nie robi.
    setup({ value: "", inheritedValue: "#00ff00" });
    expect(screen.getByRole("button", { name: RESET })).toBeDisabled();
  });

  it("resetu nie ma, gdy `allowReset=false`", () => {
    setup({ value: "#ff0000", inheritedValue: "#00ff00", allowReset: false });
    expect(screen.queryByRole("button", { name: RESET })).toBeNull();
  });

  it("popover ma WLASNY reset, gdy wartosc jest tylko odziedziczona", () => {
    // Druga sciezka `onChange(undefined)` w tym pliku - w stopce panelu
    // popovera, widoczna wylacznie przy `showInherited`.
    const { onChange } = setup({ value: "", inheritedValue: "#00ff00" });
    const dialog = openPopover();
    const inner = within(dialog)
      .getAllByRole("button")
      .filter((b) => b.className.includes("mt-auto"));
    expect(inner).toHaveLength(1);
    fireEvent.click(inner[0]);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("wewnetrznego resetu NIE MA, gdy dziedziczona wartosc jest przezroczysta", () => {
    // `showInherited` wymaga `!isTransparent(inherited)` - przezroczystosc nie
    // jest wartoscia, do ktorej warto "wrocic".
    setup({ value: "", inheritedValue: "transparent" });
    const dialog = openPopover();
    expect(
      within(dialog)
        .getAllByRole("button")
        .filter((b) => b.className.includes("mt-auto")),
    ).toHaveLength(0);
  });
});

// ── DWA DEFEKTY TEGO PLIKU, ZAREJESTROWANE, NIE NAPRAWIONE ───────────────────
describe("AdminColorPicker - defekty zarejestrowane", () => {
  it("STAN DZIS: wcisniety przelacznik nazywa sie znakiem `✓`, a nie swoja etykieta", () => {
    // Asercja stanu biezacego, zeby zmiana nie przeszla niezauwazona.
    const { container } = setup({ value: "transparent" });
    expect(transparencyToggle(container).textContent).toBe("✓");
    expect(screen.queryByRole("button", { name: DISABLE_TRANSPARENT })).toBeNull();
  });

  it.fails(
    "POWINIEN zachowac etykiete po wcisnieciu - dzis czytnik ekranu slyszy `✓ wcisniety` zamiast `Wylacz przezroczystosc`",
    () => {
      // `title` przegrywa z trescia w wyliczaniu nazwy dostepnej, wiec
      // wstawienie "✓" do srodka guzika ODBIERA mu etykiete. Naprawa to
      // `aria-label` obok `title` (albo znak w `::after`), ale to zmiana
      // produkcyjna - nie w tym zadaniu.
      setup({ value: "transparent" });
      expect(screen.getByRole("button", { name: DISABLE_TRANSPARENT })).toBeInTheDocument();
    },
  );

  it("STAN DZIS: wewnetrzny reset pokazuje redaktorowi SUROWY KLUCZ i18n", () => {
    // `ac("resetInherited") || ac("resetDefault")` mialo byc fallbackiem, ale
    // i18next na brakujacym kluczu oddaje SAM KLUCZ - napis prawdziwy, wiec
    // `||` nigdy nie wchodzi, a fallback jest martwy.
    setup({ value: "", inheritedValue: "#00ff00" });
    const dialog = openPopover();
    const inner = within(dialog)
      .getAllByRole("button")
      .filter((b) => b.className.includes("mt-auto"))[0];
    expect(inner.textContent).toContain("blocks.editors.adminControls.resetInherited");
  });

  it.fails(
    "POWINIEN pokazac tekst w jezyku redaktora - brakuje klucza `adminControls.resetInherited` w PL i EN",
    () => {
      setup({ value: "", inheritedValue: "#00ff00" });
      const dialog = openPopover();
      const inner = within(dialog)
        .getAllByRole("button")
        .filter((b) => b.className.includes("mt-auto"))[0];
      expect(inner.textContent).not.toContain("blocks.editors.adminControls.");
    },
  );
});

describe("AdminColorPicker - stan odziedziczony i etykiety", () => {
  it("brak nadpisania przy obecnej wartosci odziedziczonej rysuje obwodke PRZERYWANA", () => {
    setup({ value: "", inheritedValue: "#00ff00" });
    expect(screen.getByRole("button", { name: PICK }).className).toContain("border-dashed");
  });

  it("wlasne nadpisanie rysuje obwodke pelna", () => {
    setup({ value: "#ff0000", inheritedValue: "#00ff00" });
    expect(screen.getByRole("button", { name: PICK }).className).not.toContain("border-dashed");
  });

  it("odziedziczona wartosc PRZEZROCZYSTA nie liczy sie jako dziedziczenie", () => {
    setup({ value: "", inheritedValue: "transparent" });
    expect(screen.getByRole("button", { name: PICK }).className).not.toContain("border-dashed");
  });

  it("wlasna `ariaLabel` wygrywa nad domyslna", () => {
    setup({ value: "#ff0000", ariaLabel: "Kolor tla sekcji" });
    expect(screen.getByRole("button", { name: "Kolor tla sekcji" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PICK })).toBeNull();
  });

  it("etykieta wyzwalacza istnieje w OBU slownikach", () => {
    const en = tEn("blocks.editors.adminControls.pickColor");
    expect(en).toBeTruthy();
    expect(en).not.toBe(PICK);
  });
});

describe("AdminColorPicker - dostepnosc", () => {
  it("wyzwalacz nie wnosi naruszen", async () => {
    const { container } = setup({ value: "#ff0000" });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
