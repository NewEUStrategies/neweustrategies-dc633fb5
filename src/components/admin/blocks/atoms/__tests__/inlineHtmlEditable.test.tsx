// POLE INLINE HTML (`InlineHtmlEditable`) - jednopolowy `contentEditable`,
// którym edytor listy (`ListBlockEdit`) edytuje każdą pozycję listy.
//
// CO MA TU DOWÓD
//   * wartość z ZEWNĄTRZ (dokument, cofnięcie) trafia do DOM-u kanwy dopiero
//     po sanityzacji - `<script>` i `onerror` z importu nie wykonają się
//     w panelu redakcji,
//   * pole nie nadpisuje DOM-u wartością, którą samo przed chwilą oddało -
//     inaczej po każdym znaku karetka wracałaby na początek pozycji,
//   * ...ale ponowienie (powrót do wpisu po cofnięciu z zewnątrz) trafia do
//     DOM-u - pole porównuje wartość z tym, co DOM POKAZUJE, nie z wpisem,
//   * wklejenie HTML (Word, strona WWW) wchodzi oczyszczone: pogrubienie
//     zostaje znacznikiem, skrypt znika, a domyślne wklejenie przeglądarki
//     (surowy HTML) jest anulowane,
//   * wklejenie ZWYKŁEGO TEKSTU zachowuje każdy znak. `&`, `<` i `>` są tu
//     znakami treści („Procter & Gamble", „inflacja < 2%"), więc muszą wejść
//     jako encje, a nie zniknąć,
//   * kontrakt z edytorem listy: rola `textbox`, `data-field`, ref elementu
//     (nawigacja strzałkami) i przekazany `onKeyDown`.
//
// GRANICE. `document.execCommand("insertHTML")` to API przeglądarki, którego
// happy-dom nie wykonuje - test podmienia je i czyta, CO pole kazało wstawić.
// Sanityzator jest prawdziwy (`@/lib/sanitize`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { InlineHtmlEditable } from "../InlineHtmlEditable";

let wstawione: Array<[string, boolean | undefined, string | undefined]> = [];
const realExecCommand = document.execCommand;

beforeEach(() => {
  wstawione = [];
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: (cmd: string, ui?: boolean, value?: string) => {
      wstawione.push([cmd, ui, value]);
      return true;
    },
  });
});

afterEach(() => {
  Object.defineProperty(document, "execCommand", { configurable: true, value: realExecCommand });
});

function zamontuj(value: string) {
  const onChange = vi.fn<(html: string) => void>();
  const onKeyDown = vi.fn();
  const editableRef = vi.fn<(el: HTMLDivElement | null) => void>();
  const view = render(
    <InlineHtmlEditable
      value={value}
      placeholder="Pozycja listy…"
      data-field="list-item"
      onChange={onChange}
      onKeyDown={onKeyDown}
      editableRef={editableRef}
    />,
  );
  return { ...view, onChange, onKeyDown, editableRef, pole: screen.getByRole("textbox") };
}

/** Wkleja do pola zawartość schowka w podanych formatach. */
function wklej(pole: HTMLElement, schowek: Record<string, string>): Event {
  const zdarzenie = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(zdarzenie, "clipboardData", {
    value: { getData: (typ: string) => schowek[typ] ?? "" },
  });
  fireEvent(pole, zdarzenie);
  return zdarzenie;
}

describe("InlineHtmlEditable - wartość z zewnątrz", () => {
  it("wstawia do DOM-u sanityzowany HTML: formatowanie zostaje, skrypt i onerror nie", () => {
    const { pole } = zamontuj(
      '<strong>Ważne</strong> <img src="x" onerror="alert(1)"><script>alert(2)</script>',
    );
    expect(pole.querySelector("strong")?.textContent).toBe("Ważne");
    expect(pole.innerHTML).not.toContain("onerror");
    expect(pole.querySelector("script")).toBeNull();
  });

  it("nowa wartość z zewnątrz (np. cofnięcie) PODMIENIA treść pola", () => {
    const { pole, rerender, onChange } = zamontuj("Pierwsza wersja");
    rerender(<InlineHtmlEditable value="Wersja <em>po cofnięciu</em>" onChange={onChange} />);
    expect(pole.textContent).toBe("Wersja po cofnięciu");
    expect(pole.querySelector("em")).not.toBeNull();
    // Podmiana z zewnątrz to nie jest edycja redaktora - pole jej nie odsyła.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("InlineHtmlEditable - pisanie", () => {
  it("wpis oddaje bieżący HTML pola wywołującemu", () => {
    const { pole, onChange } = zamontuj("");
    pole.innerHTML = "Nowa <b>pozycja</b>";
    fireEvent.input(pole);
    expect(onChange).toHaveBeenCalledWith("Nowa <b>pozycja</b>");
  });

  it("powrót WŁASNEJ wartości przez propsy nie przebudowuje DOM-u (karetka zostaje)", () => {
    const { pole, rerender, onChange } = zamontuj("");
    pole.innerHTML = "Pisze dalej";
    const wezel = pole.firstChild;
    fireEvent.input(pole);
    rerender(<InlineHtmlEditable value="Pisze dalej" onChange={onChange} />);
    // Ten sam węzeł tekstowy = DOM nie był nadpisany, więc zaznaczenie
    // przeglądarki (karetka w środku słowa) nie zostało zgubione.
    expect(pole.firstChild).toBe(wezel);
  });

  it("wartość z zewnątrz RÓWNOWAŻNA pokazanej (po sanityzacji) nie przebudowuje DOM-u", () => {
    // Dokument może oddać wpis w innej, ale równoważnej postaci (np. z
    // doklejonym skryptem, który sanityzator i tak usunie) - pole nie ma
    // wtedy czego zmieniać, więc nie wolno mu zgubić karetki.
    const { pole, rerender, onChange } = zamontuj("");
    pole.innerHTML = "Tekst";
    const wezel = pole.firstChild;
    fireEvent.input(pole);
    rerender(<InlineHtmlEditable value="Tekst<script>alert(1)</script>" onChange={onChange} />);
    expect(pole.firstChild).toBe(wezel);
    expect(pole.innerHTML).toBe("Tekst");
  });

  // NAPRAWIONE 2026-10-18: pole pamiętało OSTATNI WPIS redaktora także po
  // podmianie treści z zewnątrz. Cofnięcie (wartość inna niż wpis) trafiało do
  // DOM-u, ale ponowienie - czyli powrót do tego samego wpisu - było brane za
  // „echo własnego wpisu" i pomijane: dokument miał „Wpis redaktora", a kanwa
  // dalej pokazywała stan sprzed ponowienia. KONTRAKT: pole porównuje wartość
  // z tym, co DOM aktualnie pokazuje (ostatni wpis ALBO ostatnia podmiana).
  it("cofnięcie, a potem ponowienie wpisu przywraca wpis w DOM-ie", () => {
    const { pole, rerender, onChange } = zamontuj("");
    pole.innerHTML = "Wpis redaktora";
    fireEvent.input(pole);
    rerender(<InlineHtmlEditable value="Wpis redaktora" onChange={onChange} />);
    rerender(<InlineHtmlEditable value="" onChange={onChange} />);
    expect(pole.textContent).toBe("");
    rerender(<InlineHtmlEditable value="Wpis redaktora" onChange={onChange} />);
    expect(pole.textContent).toBe("Wpis redaktora");
    // Podmiany z zewnątrz nie są edycją - pole odesłało wyłącznie wpis.
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("InlineHtmlEditable - wklejanie", () => {
  it("wklejony HTML wchodzi OCZYSZCZONY, a domyślne wklejenie jest anulowane", () => {
    const { pole } = zamontuj("");
    // `<script>` stoi NA KOŃCU celowo: `NodeIterator` happy-dom gubi węzły
    // następujące po usuniętym, więc DOMPurify pod tym środowiskiem nie
    // doszedłby do atrybutów `span` (przeglądarka ich nie gubi).
    const zdarzenie = wklej(pole, {
      "text/html": '<p><b>Ważne</b> <span onclick="x()">dalej</span><script>alert(1)</script></p>',
      "text/plain": "Ważne dalej",
    });
    expect(zdarzenie.defaultPrevented).toBe(true);
    expect(wstawione).toHaveLength(1);
    const [komenda, ui, html] = wstawione[0];
    expect(komenda).toBe("insertHTML");
    expect(ui).toBe(false);
    expect(html).toContain("<b>Ważne</b>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
  });

  it("zwykły tekst bez HTML wchodzi jako tekst - znaki treści zostają encjami", () => {
    // NAPRAWIONE 2026-10-18: pole USUWAŁO `&`, `<` i `>` z tekstu
    // (`text.replace(/[<>&]/g, "")`), więc wklejenie „Procter & Gamble"
    // dawało „Procter  Gamble", a „inflacja < 2%" - „inflacja  2%". Teraz
    // tekst jest escapowany wspólnym `escapeHtmlToText`: znak zostaje,
    // a i tak nie da się nim wstrzyknąć znacznika.
    const { pole } = zamontuj("");
    wklej(pole, { "text/plain": 'Procter & Gamble: inflacja < 2% <b>"nie znacznik"</b>' });
    const [, , html] = wstawione[0];
    expect(html).toBe(
      "Procter &amp; Gamble: inflacja &lt; 2% &lt;b&gt;&quot;nie znacznik&quot;&lt;/b&gt;",
    );
    // Po wstawieniu przez przeglądarkę redaktor widzi dokładnie to, co wkleił.
    const probka = document.createElement("div");
    probka.innerHTML = html ?? "";
    expect(probka.textContent).toBe('Procter & Gamble: inflacja < 2% <b>"nie znacznik"</b>');
  });
});

describe("InlineHtmlEditable - kontrakt z edytorem listy", () => {
  it("oddaje element przez editableRef i niesie data-field oraz placeholder", () => {
    const { pole, editableRef } = zamontuj("Pozycja");
    expect(editableRef).toHaveBeenCalledWith(pole);
    expect(pole).toHaveAttribute("data-field", "list-item");
    expect(pole).toHaveAttribute("data-placeholder", "Pozycja listy…");
    expect(pole).toHaveAttribute("contenteditable", "true");
  });

  it("przekazuje klawisze wywołującemu (Enter / Backspace / strzałki listy)", () => {
    const { pole, onKeyDown } = zamontuj("Pozycja");
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0]).toMatchObject({ key: "Enter" });
  });
});
