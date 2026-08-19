// Powierzchnia pisania treści wpisu: przełącznik trybu + edytor Markdown.
//
// Plik stał na 0%. Reguła, którą niesie, jest jednozdaniowa, ale jej złamanie
// jest kosztowne: `mode` decyduje, KTÓRY edytor dostaje treść. Podanie HTML-a
// do edytora Markdown (albo odwrotnie) nie wywala się na typach - oba biorą
// `string` - a redaktor zobaczy swój artykuł jako surowe znaczniki.
//
// Tiptap jest tu zamockowany świadomie: to najcięższy import w repo, a bogaty
// edytor ma własną powierzchnię testową. Tutaj sprawdzamy WYBÓR i ścieżkę
// Markdown, nie wnętrze WYSIWYG-a.
import "@/lib/i18n-admin-panes-misc";
import i18n from "@/lib/i18n";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tiptap/react", () => ({
  useEditor: () => null,
  EditorContent: () => <div data-testid="tiptap" />,
}));
vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-image", () => ({ default: {} }));

import { PostEditor } from "../PostEditor";

const t = i18n.getFixedT("pl");

/** Podpowiedź podglądu jest zapisana MARKDOWNEM (`*…*`), więc w drzewie DOM
 *  pojawia się bez znaczników - podgląd renderuje ją tak samo jak treść. */
const PREVIEW_PLACEHOLDER = t("adminPanesMisc.postEditor.previewPlaceholder").replace(/[*_]/g, "");

describe("PostEditor - wybór edytora", () => {
  it("tryb markdown renderuje pole tekstowe z podglądem, nie WYSIWYG", () => {
    render(<PostEditor value="# Tytuł" onChange={() => {}} mode="markdown" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByTestId("tiptap")).not.toBeInTheDocument();
  });

  it("tryb richtext NIE renderuje pola Markdown", () => {
    // Gdyby oba tryby renderowały to samo, przełącznik trybu w edytorze byłby
    // ozdobą, a treść zapisywałaby się w formacie innym niż zadeklarowany.
    render(<PostEditor value="<p>tekst</p>" onChange={() => {}} mode="richtext" />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("PostEditor - edytor Markdown", () => {
  it("pokazuje treść źródłową w polu edycji", () => {
    render(<PostEditor value="## Nagłówek" onChange={() => {}} mode="markdown" />);
    expect(screen.getByRole("textbox")).toHaveValue("## Nagłówek");
  });

  it("zgłasza zmianę treści SUROWO, bez konwersji", () => {
    // Kolumna trzyma Markdown. Jakakolwiek transformacja przy wyjściu z pola
    // oznaczałaby, że zapisany tekst różni się od tego, co redaktor napisał.
    const onChange = vi.fn();
    render(<PostEditor value="" onChange={onChange} mode="markdown" />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "**pogrubienie**" } });
    expect(onChange).toHaveBeenCalledWith("**pogrubienie**");
  });

  it("renderuje podgląd obok pola edycji", () => {
    render(<PostEditor value="# Widoczny nagłówek" onChange={() => {}} mode="markdown" />);
    // Podgląd przetwarza Markdown na nagłówek - gdyby go nie było, redaktor
    // pisałby w ciemno.
    expect(screen.getByRole("heading", { name: "Widoczny nagłówek" })).toBeInTheDocument();
  });

  it("pusta treść pokazuje w podglądzie podpowiedź, a nie pustkę", () => {
    render(<PostEditor value="" onChange={() => {}} mode="markdown" />);
    expect(screen.getByText(PREVIEW_PLACEHOLDER)).toBeInTheDocument();
  });

  it("podpowiedź znika, gdy tylko pojawi się treść", () => {
    render(<PostEditor value="cokolwiek" onChange={() => {}} mode="markdown" />);
    expect(screen.queryByText(PREVIEW_PLACEHOLDER)).not.toBeInTheDocument();
  });
});
