// Lekki WYSIWYG pól `i18nHtml`. Pole operuje na `contentEditable` i na
// `document.execCommand`, więc test przypina to, co da się sprawdzić bez
// prawdziwego silnika edycji, a jednocześnie jest tu kontraktem:
//
//  1. KTÓRE polecenie wysyła każdy przycisk paska (pomyłka „bold” <-> „italic”
//     jest niewidoczna w kodzie i natychmiast widoczna dla redakcji);
//  2. że wartość wychodząca z pola jest ZNORMALIZOWANA
//     (`normalizeBuilderRichHtml`), a nie surowym HTML-em z przeglądarki;
//  3. że wklejanie z Worda/Google Docs idzie przez `parseWordInlineHtml`,
//     a wklejanie tekstu - przez `insertText`, nigdy przez `insertHTML`;
//  4. że synchronizacja z zewnątrz NIE nadpisuje pola w trakcie pisania
//     (inaczej karetka skacze na początek przy każdym znaku).
//
// `document.execCommand` nie istnieje w happy-dom - podstawiamy atrapę
// i sprawdzamy WYWOŁANIA. To jedyne API, którym to pole rozmawia z DOM-em,
// więc atrapa nie ukrywa tu żadnej logiki produkcyjnej.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RichHtmlField } from "../RichHtmlField";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

const execCommand = vi.fn(() => true);

beforeEach(() => {
  execCommand.mockClear();
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: execCommand,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rf = (key: string) => `builder.richHtmlField.${key}`;

function renderField(initial = "") {
  const onChange = vi.fn();
  function Host() {
    const [value, setValue] = useState(initial);
    return (
      <RichHtmlField
        value={value}
        ariaLabel="Treść (PL)"
        onChange={(html) => {
          onChange(html);
          setValue(html);
        }}
      />
    );
  }
  render(<Host />);
  return {
    onChange,
    editable: () => screen.getByRole("textbox") as HTMLDivElement,
  };
}

describe("RichHtmlField - pasek narzędzi", () => {
  it.each([
    ["pogrubienie", "bold", ["bold"]],
    ["kursywa", "italic", ["italic"]],
    ["podkreślenie", "underline", ["underline"]],
    ["nagłówek 2", "heading2", ["formatBlock", "H2"]],
    ["nagłówek 3", "heading3", ["formatBlock", "H3"]],
    ["cytat", "quote", ["formatBlock", "BLOCKQUOTE"]],
    ["lista punktowana", "bulletList", ["insertUnorderedList"]],
    ["lista numerowana", "orderedList", ["insertOrderedList"]],
    ["usunięcie linku", "unlink", ["unlink"]],
    ["czyszczenie formatu", "clearFormat", ["removeFormat"]],
    ["cofnięcie", "undo", ["undo"]],
    ["ponowienie", "redo", ["redo"]],
  ])("%s wysyła właściwe polecenie", async (_label, key, expected) => {
    renderField("<p>tekst</p>");
    fireEvent.click(screen.getByLabelText(rf(key)));
    const [cmd, , arg] = execCommand.mock.calls[0] as unknown as [string, boolean, string?];
    expect(cmd).toBe(expected[0]);
    if (expected[1] !== undefined) expect(arg).toBe(expected[1]);
  });

  it("pasek ma nazwę dla czytnika ekranu i separatory poza kolejnością czytania", () => {
    const { editable } = renderField();
    const bar = screen.getByRole("toolbar", { name: "builder.editable.toolbar" });
    expect(bar).toBeInTheDocument();
    expect(bar.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(editable).toBeTruthy();
  });

  it("każdy klik paska domyka synchronizację wartości", async () => {
    const { onChange, editable } = renderField("<p>a</p>");
    editable().innerHTML = "<p>b</p>";
    fireEvent.click(screen.getByLabelText(rf("bold")));
    // `execCommand` nie zawsze wywołuje `input`, więc pole samo domyka zapis -
    // bez tego zmiana zrobiona przyciskiem ginie przy zmianie zakładki.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("<p>b</p>"));
  });
});

describe("RichHtmlField - wstawianie linku", () => {
  /** happy-dom nie ma `window.prompt` - podstawiamy atrapę okna dialogowego. */
  function stubPrompt(answer: string | null): ReturnType<typeof vi.fn> {
    const prompt = vi.fn(() => answer);
    vi.stubGlobal("prompt", prompt);
    return prompt;
  }

  it("pyta o adres i wstawia link", () => {
    const prompt = stubPrompt("https://neweu.test");
    renderField("<p>tekst</p>");
    fireEvent.click(screen.getByLabelText(rf("insertLink")));
    expect(prompt).toHaveBeenCalledWith(rf("urlPrompt"), "https://");
    expect(execCommand).toHaveBeenCalledWith("createLink", false, "https://neweu.test");
  });

  it.each([
    ["anulowanie okna", null],
    ["puste pole", ""],
  ])("nie wstawia linku przy: %s", (_label, answer) => {
    stubPrompt(answer);
    renderField("<p>tekst</p>");
    fireEvent.click(screen.getByLabelText(rf("insertLink")));
    expect(execCommand).not.toHaveBeenCalledWith("createLink", false, expect.anything());
  });
});

describe("RichHtmlField - wklejanie", () => {
  function paste(editable: HTMLElement, html: string, text: string) {
    fireEvent.paste(editable, {
      clipboardData: { getData: (type: string) => (type === "text/html" ? html : text) },
    });
  }

  it("wklejenie z Worda zachowuje strukturę inline", () => {
    const { editable } = renderField();
    paste(
      editable(),
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><p class="MsoNormal">Ala <b>ma</b> kota</p></body></html>',
      "Ala ma kota",
    );
    const [cmd, , arg] = execCommand.mock.calls[0] as unknown as [string, boolean, string];
    expect(cmd).toBe("insertHTML");
    // Struktura zostaje, klasy edytora źródłowego nie.
    // Parser normalizuje znaczniki prezentacyjne na semantyczne
    // (`<b>` -> `<strong>`), a klasy edytora źródłowego wyrzuca.
    expect(arg).toContain("<strong>ma</strong>");
    expect(arg).not.toContain("MsoNormal");
  });

  it("wklejenie zwykłego tekstu idzie przez insertText", () => {
    const { editable } = renderField();
    paste(editable(), "", "zwykły tekst");
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "zwykły tekst");
  });

  it("HTML, który nie wygląda na bogaty, też idzie tekstem", () => {
    const { editable } = renderField();
    paste(editable(), "<span>a</span>", "a");
    const commands = execCommand.mock.calls.map((c) => (c as unknown as [string])[0]);
    // Fragment bez struktury nie jest wart wstawiania jako HTML - inaczej do
    // treści trafiają puste `<span>`-y z każdego kopiuj-wklej.
    expect(commands).toEqual(["insertText"]);
  });
});

describe("RichHtmlField - synchronizacja wartości", () => {
  it("wstawia wartość przychodzącą z zewnątrz po normalizacji", () => {
    const { editable } = renderField("<p>akapit</p>");
    // Normalizacja jest wspólna z rendererem - pole nie może pokazywać innego
    // HTML-a niż ten, który zobaczy czytelnik.
    expect(editable().innerHTML).toBe("<p>akapit</p>");
  });

  it("nowa wartość z zewnątrz podmienia treść pola", () => {
    function Host({ html }: { html: string }) {
      return <RichHtmlField value={html} onChange={vi.fn()} ariaLabel="Treść (PL)" />;
    }
    const { rerender } = render(<Host html="<p>pierwsza</p>" />);
    const el = screen.getByRole("textbox");
    expect(el.innerHTML).toBe("<p>pierwsza</p>");
    rerender(<Host html="<p>druga</p>" />);
    // Zmiana języka panelu albo cofnięcie zmiany MUSI przeładować pole -
    // pomijamy tylko pole aktywne (patrz test poniżej).
    expect(el.innerHTML).toBe("<p>druga</p>");
  });

  it("nie nadpisuje pola, gdy jest ono aktywne", () => {
    const { editable } = renderField("<p>a</p>");
    const el = editable();
    el.focus();
    el.innerHTML = "<p>redaktor pisze</p>";
    fireEvent.input(el);
    // Efekt synchronizujący pomija pole z fokusem - inaczej karetka wracałaby
    // na początek po każdym znaku.
    expect(el.innerHTML).toContain("redaktor pisze");
  });

  it("naprawia listę wpisaną w polu, nie tylko przychodzącą", () => {
    const { onChange, editable } = renderField("<p>a</p>");
    const el = editable();
    // Dwukrotne kliknięcie „lista punktowana” w przeglądarce robi skorupę
    // `<ul><li><ul><li>…`. Pole naprawia ją JESZCZE W DOM-ie, żeby to, co
    // redaktor widzi, było tym, co zapisane - inaczej kanwa i strona
    // pokazywałyby dwa różne wcięcia.
    el.innerHTML = "<ul><li><ul><li>Punkt</li></ul></li></ul>";
    fireEvent.input(el);
    const saved = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(saved).toBe("<ul><li>Punkt</li></ul>");
    expect(el.innerHTML).toBe("<ul><li>Punkt</li></ul>");
  });

  it("pole bez etykiety renderuje się bez nazwy", () => {
    const { container } = render(<RichHtmlField value="<p>a</p>" onChange={vi.fn()} />);
    const editable = container.querySelector('[role="textbox"]');
    expect(editable?.hasAttribute("aria-label")).toBe(false);
  });

  it("zapisuje przy utracie fokusu", () => {
    const { onChange, editable } = renderField("<p>a</p>");
    const el = editable();
    el.innerHTML = "<p>zmiana</p>";
    fireEvent.blur(el);
    expect(onChange).toHaveBeenCalledWith("<p>zmiana</p>");
  });

  it("pusta wartość początkowa nie wywala pola", () => {
    const { editable } = renderField("");
    expect(editable().innerHTML).toBe("");
  });

  it("minimalna wysokość rośnie z liczbą wierszy", () => {
    const { container } = render(
      <RichHtmlField value="" onChange={vi.fn()} rows={10} ariaLabel="x" />,
    );
    const editable = container.querySelector<HTMLElement>('[role="textbox"]');
    expect(editable?.style.minHeight).toBe("216px");
  });

  it("mniej niż trzy wiersze i tak daje wysokość trzech", () => {
    const { container } = render(
      <RichHtmlField value="" onChange={vi.fn()} rows={1} ariaLabel="x" />,
    );
    // Pole niższe niż trzy wiersze jest nieklikalne w praktyce - stąd podłoga.
    expect(container.querySelector<HTMLElement>('[role="textbox"]')?.style.minHeight).toBe("76px");
  });
});

describe("RichHtmlField - rozmiar czcionki zaznaczenia", () => {
  const sizeSelect = () => screen.getByLabelText(rf("fontSize")) as HTMLSelectElement;

  it("oferuje reset i skalę rozmiarów", () => {
    renderField();
    const values = Array.from(sizeSelect().querySelectorAll("option")).map((o) => o.value);
    expect(values[0]).toBe("");
    expect(values).toContain("16px");
    expect(values).toHaveLength(12);
  });

  it("bez zaznaczenia nic nie robi", () => {
    const { onChange } = renderField("<p>Ala ma kota</p>");
    window.getSelection()?.removeAllRanges();
    fireEvent.change(sizeSelect(), { target: { value: "24px" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zaznaczenie puste (sama karetka) nic nie zmienia", () => {
    const { onChange, editable } = renderField("<p>Ala ma kota</p>");
    const el = editable();
    const range = document.createRange();
    const text = el.textContent ?? "";
    range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(text.length).toBeGreaterThan(0);
    fireEvent.change(sizeSelect(), { target: { value: "24px" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  /** Zaznacza całą treść pola - warunek wstępny działania rozmiaru czcionki. */
  function selectAll(el: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it("owija zaznaczenie w rozmiar czcionki", async () => {
    const { onChange, editable } = renderField("<p>Ala ma kota</p>");
    selectAll(editable());
    fireEvent.change(sizeSelect(), { target: { value: "24px" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls.at(-1)?.[0]).toContain("font-size: 24px");
  });

  it.each([
    ["sam rozmiar", 'style="font-size: 24px"', false],
    ["rozmiar obok innej właściwości", 'style="font-size: 24px; color: red"', true],
  ])("reset rozmiaru zdejmuje zagnieżdżone rozmiary: %s", async (_label, style, keepsStyle) => {
    const { onChange, editable } = renderField(`<p><span ${style}>Ala ma kota</span></p>`);
    selectAll(editable());
    fireEvent.change(sizeSelect(), { target: { value: "" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const html = onChange.mock.calls.at(-1)?.[0] ?? "";
    // Reset musi ZDJĄĆ rozmiary ze środka zaznaczenia, a nie tylko przestać
    // dokładać nowy - inaczej „domyślnie” nic nie zmienia. Pozostałe
    // właściwości stylu zostają nietknięte.
    expect(html).not.toContain("font-size");
    expect(html.includes("color")).toBe(keepsStyle);
  });

  it("naciśnięcie na pasku nie zabiera fokusu polu", () => {
    renderField("<p>tekst</p>");
    const boldEvent = fireEvent.mouseDown(screen.getByLabelText(rf("bold")));
    const sizeEvent = fireEvent.mouseDown(sizeSelect());
    // `preventDefault` na `mousedown` to jedyny sposób, żeby klik w pasek nie
    // zgubił zaznaczenia w polu - bez tego pogrubienie nie miałoby na czym
    // zadziałać. `fireEvent` zwraca false, gdy zdarzenie zostało anulowane.
    expect(boldEvent).toBe(false);
    expect(sizeEvent).toBe(false);
  });

  it("po wyborze lista wraca na pozycję pierwszą", () => {
    renderField("<p>Ala ma kota</p>");
    const select = sizeSelect();
    fireEvent.change(select, { target: { value: "24px" } });
    // Lista jest przyciskiem akcji, nie stanem - musi wracać do „domyślnie”,
    // inaczej pokazuje rozmiar, którego zaznaczenie już nie ma.
    expect(select.selectedIndex).toBe(0);
  });
});
