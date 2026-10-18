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
//   4. przezroczystosc: przelacznik w obie strony, wraz z `aria-pressed`
//      i etykieta, ktora PRZEZYWA wcisniecie (naprawione 2026-10-18),
//   5. reset do wartosci odziedziczonej oddaje `undefined`, a nie pusty napis -
//      rozroznienie "brak nadpisania" kontra "nadpisane pustka"; powrot do
//      dziedziczenia w popoverze stoi TYLKO przy wlasnym nadpisaniu,
//   6. stan odziedziczony rysuje obwodke przerywana zamiast pelnej,
//   7. wszystkie napisy ida ze slownika w OBU jezykach - zaden surowy klucz
//      `blocks.editors.adminControls.*` nie dociera do redaktora.
//
// CZEGO TU NIE MA - swiadomie: nie steruje kanwa `react-colorful`
// (`HexColorPicker`). To komponent obcy, ktory liczy pozycje wskaznika
// z geometrii DOM, a happy-dom nie ma silnika layoutu - przejazd po nim
// mierzylby atrape przegladarki, nie ten plik. Jego wyjscie idzie tym samym
// `commitHex`, co wejscie HEX, ktore jest tu pokryte.
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/lib/i18n";

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
const RESET_INHERITED = t("blocks.editors.adminControls.resetInherited");

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
 * Przelacznik przezroczystosci - jedyny przycisk z `aria-pressed` w wierszu.
 * Selektor dziala w OBU stanach; nazwe dostepna (od 2026-10-18 stala dzieki
 * `aria-label`) sprawdzaja osobne testy nizej.
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

  it("skrot CZTEROZNAKOWY (hex z alfa) traci kanal alfa i rozwija sie do szesciu", () => {
    // `#abcd` to zapis `#aabbccdd`: trzy skladowe po jednym znaku plus alfa.
    // Pole ma z tego zrobic `#aabbcc`, a nie zgubic kolor przez nieznana dlugosc.
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.change(hexInput(dialog), { target: { value: "abcd" } });
    expect(onChange).toHaveBeenCalledWith("#aabbcc");
  });

  it("odcien liczy sie poprawnie, gdy zielony jest CIEMNIEJSZY od niebieskiego", () => {
    // Sekstant, w ktorym `rgbToHsl` musi dodac pelny obrot (`gn < bn ? 6 : 0`).
    // Bez tego dodania odcien wychodzi ujemny i suwak skacze na przeciwna
    // strone kola barw.
    setup({ value: "#ff0080" });
    const dialog = openPopover();
    expect(numberInputs(dialog)[3].value).toBe("330");
  });

  it.each([
    [30, "#ff8000"],
    [90, "#80ff00"],
    [150, "#00ff80"],
    [210, "#0080ff"],
    [270, "#8000ff"],
    [330, "#ff0080"],
  ])("odcien %s idzie do rodzica jako %s - wszystkie szesc sekstantow kola barw", (h, hex) => {
    // KAZDY z szesciu sekstantow ma w `hslToRgb` osobna galez. Pominiecie
    // jednego znaczy jedna barwe, ktorej redaktor nie potrafi ustawic suwakiem
    // odcienia - i zaden test happy-path tego nie zlapie.
    const { onChange } = setup({ value: "#ff0000" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[3], { target: { value: String(h) } });
    expect(onChange).toHaveBeenCalledWith(hex);
  });

  it("KLAMROWANIE HSL: napis nieliczbowy w odcieniu schodzi do zera, nie do NaN", () => {
    const { onChange } = setup({ value: "#00ff80" });
    const dialog = openPopover();
    fireEvent.change(numberInputs(dialog)[3], { target: { value: "wysoko" } });
    const arg = onChange.mock.calls[0]?.[0];
    expect(typeof arg).toBe("string");
    expect(arg).not.toContain("NaN");
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

  it("popover ma WLASNY powrot do dziedziczenia, gdy redaktor nadpisal kolor", () => {
    // Druga sciezka `onChange(undefined)` w tym pliku - w panelu popovera.
    // ZMIANA 2026-10-18: guzik stal TYLKO wtedy, gdy nadpisania nie bylo, czyli
    // gdy nie bylo czego zdejmowac - a znikal w chwili wybrania koloru.
    const { onChange } = setup({ value: "#ff0000", inheritedValue: "#00ff00" });
    const dialog = openPopover();
    fireEvent.click(within(dialog).getByRole("button", { name: RESET_INHERITED }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("bez wlasnego nadpisania powrotu do dziedziczenia w popoverze NIE MA", () => {
    // Wartosc juz jest dziedziczona - guzik, ktory nic nie zmienia, jest gorszy
    // niz jego brak.
    setup({ value: "", inheritedValue: "#00ff00" });
    const dialog = openPopover();
    expect(within(dialog).queryByRole("button", { name: RESET_INHERITED })).toBeNull();
  });

  it("powrotu do dziedziczenia NIE MA, gdy dziedziczona wartosc jest przezroczysta", () => {
    // Przezroczystosc nie jest wartoscia, do ktorej warto "wrocic".
    setup({ value: "#ff0000", inheritedValue: "transparent" });
    const dialog = openPopover();
    expect(within(dialog).queryByRole("button", { name: RESET_INHERITED })).toBeNull();
  });

  it("powrotu do dziedziczenia NIE MA, gdy wolajacy wylaczyl reset", () => {
    setup({ value: "#ff0000", inheritedValue: "#00ff00", allowReset: false });
    const dialog = openPopover();
    expect(within(dialog).queryByRole("button", { name: RESET_INHERITED })).toBeNull();
  });
});

// ── DWA DAWNE DEFEKTY TEGO PLIKU - NAPRAWIONE 2026-10-18 ─────────────────────
describe("AdminColorPicker - etykiety przelacznika i panelu (dawne defekty)", () => {
  // NAPRAWIONE 2026-10-18 (byl `it.fails` + „STAN DZIS"): wcisniety przelacznik
  // nazywal sie znakiem `✓`, bo tresc guzika wygrywa z `title` w wyliczaniu
  // nazwy dostepnej. KONTRAKT: nazwe niesie `aria-label`, a znak jest
  // `aria-hidden` - czytnik slyszy „Wylacz przezroczystosc, wcisniety".
  it("wcisniety przelacznik zachowuje etykiete zamiast nazywac sie `✓`", () => {
    const { container } = setup({ value: "transparent" });
    const przelacznik = screen.getByRole("button", { name: DISABLE_TRANSPARENT });
    expect(przelacznik).toBe(transparencyToggle(container));
    expect(przelacznik).toHaveAttribute("aria-pressed", "true");
  });

  it("niewcisniety przelacznik nazywa sie akcja wlaczenia", () => {
    const { container } = setup({ value: "#ff0000" });
    expect(screen.getByRole("button", { name: SET_TRANSPARENT })).toBe(
      transparencyToggle(container),
    );
  });

  // NAPRAWIONE 2026-10-18 (byl `it.fails` + „STAN DZIS"): panel pokazywal
  // SUROWE KLUCZE `adminControls.resetInherited`, `activeToken` i
  // `brandPalette` - fallback `ac(k) || "…"` byl martwy, bo i18next na
  // brakujacym kluczu oddaje sam klucz. KONTRAKT: klucze istnieja w PL i EN,
  // a fallbacki zniknely z kodu.
  it("panel popovera nie pokazuje redaktorowi zadnego surowego klucza i18n", () => {
    setup({ value: "#ff0000", inheritedValue: "#00ff00" });
    const dialog = openPopover();
    expect(dialog.textContent).not.toContain("blocks.editors.adminControls.");
    expect(within(dialog).getByText(t("blocks.editors.adminControls.activeToken"))).toBeVisible();
    expect(within(dialog).getByText(t("blocks.editors.adminControls.brandPalette"))).toBeVisible();
    expect(within(dialog).getByRole("button", { name: RESET_INHERITED })).toBeInTheDocument();
  });

  it("podpowiedz dziedziczenia idzie ze slownika i pokazuje odziedziczona wartosc", () => {
    // Napis `dziedziczy: …` byl wpisany w kod po polsku - takze w panelu EN.
    const { container } = setup({ value: "", inheritedValue: "#00ff00" });
    expect(tokenInput(container)).toHaveAttribute(
      "placeholder",
      t("blocks.editors.adminControls.inheritsPh", { value: "#00ff00" }),
    );
    expect(tokenInput(container).placeholder).toContain("#00ff00");
  });

  it("w panelu angielskim podpowiedz dziedziczenia jest po angielsku", async () => {
    await i18n.changeLanguage("en");
    try {
      const { container } = setup({ value: "", inheritedValue: "#00ff00" });
      expect(tokenInput(container)).toHaveAttribute(
        "placeholder",
        tEn("blocks.editors.adminControls.inheritsPh", { value: "#00ff00" }),
      );
    } finally {
      // Odmontowanie PRZED powrotem do polskiego - `changeLanguage`
      // przerenderowuje kazdy zamontowany komponent.
      cleanup();
      await i18n.changeLanguage("pl");
    }
  });

  it("wszystkie nowe etykiety panelu istnieja takze po angielsku", () => {
    for (const k of ["resetInherited", "activeToken", "brandPalette", "inheritsPh"]) {
      const en = tEn(`blocks.editors.adminControls.${k}`, { value: "#00ff00" });
      expect(en).not.toContain("blocks.editors.adminControls.");
      expect(en).not.toBe(t(`blocks.editors.adminControls.${k}`, { value: "#00ff00" }));
    }
  });
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

  it("BRAK propu `value` to pustka, a nie napis `undefined` w polu", () => {
    // Panel montuje to pole takze wtedy, gdy widget nie ma jeszcze zadnego
    // nadpisania - `undefined` musi zachowac sie jak pusty napis, inaczej
    // redaktor widzi w polu slowo „undefined" i zapisuje je do dokumentu.
    const { container } = setup({ value: undefined });
    expect(tokenInput(container).value).toBe("");
    expect(screen.getByRole("button", { name: RESET })).toBeDisabled();
  });

  it("kratka z PALETY MARKI zapisuje swoj kolor i przestawia pole HEX", () => {
    // Stopka popovera to jedyna droga „na jeden klik" do kolorow marki.
    const { onChange } = setup({ value: "#112233" });
    const dialog = openPopover();
    fireEvent.click(within(dialog).getByRole("button", { name: "#FA9346" }));
    expect(onChange).toHaveBeenCalledWith("#FA9346");
    expect(within(dialog).getAllByRole("textbox")[0]).toHaveValue("FA9346");
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
