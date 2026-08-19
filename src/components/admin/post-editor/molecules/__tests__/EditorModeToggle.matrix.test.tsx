// Przełącznik silnika edytora wizualnego (Gutenberg = bloki, Elementor = builder).
//
// CO TU DOWODZIMY: że stan aktywnego silnika jest podany PROGRAMOWO
// (`aria-pressed`), że klik w każdy z żetonów zgłasza właściwy silnik i że
// wartości edytora spoza tej pary (starsze wpisy: richtext / markdown) nie są
// pokazywane jako aktywne.
//
// DLACZEGO TO WAŻNE: silnik decyduje, KTÓRA treść wpisu jest źródłem prawdy przy
// zapisie (bloki vs dokument buildera). Przełącznik pokazujący zły stan prowadzi
// redakcję do edycji nieaktywnego dokumentu - praca wygląda na zapisaną, a
// czytelnik dalej widzi starą wersję. `aria-pressed` jest tu jedynym sygnałem dla
// czytnika ekranu, bo poza nim aktywność niesie tylko kolor tła.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EditorType } from "@/components/admin/post-editor/types";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

import { EditorModeToggle } from "../EditorModeToggle";

function renderToggle(editor: EditorType) {
  const onEditorChange = vi.fn<(editor: EditorType) => void>();
  const view = render(<EditorModeToggle editor={editor} onEditorChange={onEditorChange} />);
  return { ...view, onEditorChange };
}

const gutenberg = () => screen.getByRole("button", { name: "Gutenberg" });
const elementor = () => screen.getByRole("button", { name: "Elementor" });

describe("EditorModeToggle - etykieta i stan", () => {
  it("opisuje kontrolkę kluczem i18n (nazwy silników są markami, nie tłumaczymy ich)", () => {
    renderToggle("blocks");

    expect(screen.getByText("adminPostPanes.editor.editorMode")).toBeInTheDocument();
  });

  it("dla trybu blokowego wciśnięty jest Gutenberg, a Elementor nie", () => {
    renderToggle("blocks");

    expect(gutenberg()).toHaveAttribute("aria-pressed", "true");
    expect(elementor()).toHaveAttribute("aria-pressed", "false");
  });

  it("dla trybu buildera wciśnięty jest Elementor, a Gutenberg nie", () => {
    renderToggle("builder");

    expect(elementor()).toHaveAttribute("aria-pressed", "true");
    expect(gutenberg()).toHaveAttribute("aria-pressed", "false");
  });

  it.each<EditorType>(["richtext", "markdown"])(
    "dla starszego trybu %s ŻADEN żeton nie jest wciśnięty (para nie kłamie o stanie)",
    (editor) => {
      renderToggle(editor);

      expect(gutenberg()).toHaveAttribute("aria-pressed", "false");
      expect(elementor()).toHaveAttribute("aria-pressed", "false");
    },
  );
});

describe("EditorModeToggle - przełączanie", () => {
  it("klik w Elementor zgłasza silnik buildera", () => {
    const { onEditorChange } = renderToggle("blocks");

    fireEvent.click(elementor());

    expect(onEditorChange).toHaveBeenCalledWith("builder");
  });

  it("klik w Gutenberg zgłasza silnik bloków", () => {
    const { onEditorChange } = renderToggle("builder");

    fireEvent.click(gutenberg());

    expect(onEditorChange).toHaveBeenCalledWith("blocks");
  });

  it("klik w już aktywny żeton zgłasza ten sam silnik (przełącznik nie ma stanu u siebie)", () => {
    const { onEditorChange } = renderToggle("blocks");

    fireEvent.click(gutenberg());

    expect(onEditorChange).toHaveBeenCalledTimes(1);
    expect(onEditorChange).toHaveBeenCalledWith("blocks");
  });

  it("z trybu starszego można wyjść w dowolną stronę bez utraty wyboru", () => {
    const { onEditorChange } = renderToggle("markdown");

    fireEvent.click(elementor());
    fireEvent.click(gutenberg());

    expect(onEditorChange.mock.calls.map(([e]) => e)).toEqual(["builder", "blocks"]);
  });

  it("oba żetony są przyciskami typu button - klik nie wysyła formularza edytora", () => {
    renderToggle("blocks");

    expect(gutenberg()).toHaveAttribute("type", "button");
    expect(elementor()).toHaveAttribute("type", "button");
  });
});
