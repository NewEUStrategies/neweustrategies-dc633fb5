// Snippet trafienia z `ts_headline`. Wygląda na drobiazg, ale jest granicą
// bezpieczeństwa: serwer odsyła CZYSTY tekst wpisu z delimiterami [[[ ]]]
// wokół trafionych słów, a komponent zamienia je na <mark> PRZEZ SPLIT -
// żadnego `dangerouslySetInnerHTML`. Gdyby ktoś kiedyś „uprościł" to do
// wstrzyknięcia HTML, treść wpisu (pochodząca od autorów, a przy komentarzach
// i klubach od użytkowników) mogłaby przemycić znaczniki do wyników
// wyszukiwania. Test przypina, że znacznik w tekście zostaje TEKSTEM.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SearchSnippet } from "../SearchSnippet";

afterEach(() => cleanup());

describe("SearchSnippet", () => {
  it("tekst bez delimiterów renderuje się w całości i bez podświetleń", () => {
    const { container } = render(<SearchSnippet text="Zwykły fragment wpisu" />);
    expect(container.textContent).toBe("Zwykły fragment wpisu");
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("podświetla trafienie, zachowując tekst wokół niego", () => {
    const { container } = render(<SearchSnippet text="polityka [[[energetyczna]]] w CEE" />);
    expect(container.textContent).toBe("polityka energetyczna w CEE");
    expect(screen.getByText("energetyczna").tagName).toBe("MARK");
  });

  it("podświetla WIELE trafień w jednym fragmencie", () => {
    const { container } = render(<SearchSnippet text="[[[gaz]]] i [[[ropa]]] w regionie" />);
    expect(container.querySelectorAll("mark")).toHaveLength(2);
    expect(container.textContent).toBe("gaz i ropa w regionie");
  });

  it("trafienie na POCZĄTKU nie gubi się przy dzieleniu tekstu", () => {
    const { container } = render(<SearchSnippet text="[[[gaz]]] ziemny" />);
    expect(container.textContent).toBe("gaz ziemny");
    expect(screen.getByText("gaz").tagName).toBe("MARK");
  });

  it("trafienie na KOŃCU nie ucina ogona", () => {
    const { container } = render(<SearchSnippet text="polski [[[gaz]]]" />);
    expect(container.textContent).toBe("polski gaz");
  });

  it("NIEDOMKNIĘTY delimiter zostaje tekstem - fragment nie znika z wyników", () => {
    // Ucięty snippet z bazy nie może skasować wiersza wyniku.
    const { container } = render(<SearchSnippet text="polityka [[[energetyczna" />);
    expect(container.textContent).toBe("polityka [[[energetyczna");
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("ZNACZNIK HTML W TREŚCI ZOSTAJE TEKSTEM - snippet nie jest wektorem wstrzyknięcia", () => {
    const { container } = render(
      <SearchSnippet text='fragment <img src=x onerror="alert(1)"> i [[[gaz]]]' />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("znacznik WEWNĄTRZ podświetlenia też zostaje tekstem", () => {
    const { container } = render(<SearchSnippet text="[[[<b>gaz</b>]]]" />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("<b>gaz</b>");
  });

  it("puste podświetlenie nie wywraca renderu", () => {
    const { container } = render(<SearchSnippet text="pusty [[[]]] środek" />);
    expect(container.textContent).toBe("pusty  środek");
  });

  it("pusty tekst renderuje pusty element, a nie błąd", () => {
    const { container } = render(<SearchSnippet text="" />);
    expect(container.textContent).toBe("");
  });

  it("przekazuje klasę wywołującego (snippet dziedziczy typografię wiersza)", () => {
    const { container } = render(<SearchSnippet text="tekst" className="text-sm" />);
    expect(container.querySelector("span")).toHaveClass("text-sm");
  });
});
