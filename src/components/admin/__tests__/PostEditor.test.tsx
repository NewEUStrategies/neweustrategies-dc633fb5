// Edytor tekstowy wpisu (`PostEditor`, 0%): dwa tryby — markdown z podglądem
// obok i rich text na TipTapie.
//
// Trzy rzeczy są tu warte testu:
//
//   1. SYNCHRONIZACJA WARTOŚCI Z ZEWNĄTRZ. Cofnięcie (Ctrl+Z), porzucenie zmian
//      i przywrócenie rewizji podmieniają `value` SPOZA edytora. Bez wpisania
//      tej wartości z powrotem do TipTapa redaktor kliknąłby „cofnij" i nie
//      zobaczyłby żadnej zmiany — a formularz miałby już inną treść niż ekran.
//   2. STRAŻNIK `value !== getHTML()`. Bez niego każde naciśnięcie klawisza
//      wracałoby przez `setContent`, RESETUJĄC KURSOR na początek dokumentu.
//      To jedna z tych usterek, które czynią edytor bezużytecznym.
//   3. WYBÓR OBRAZKA IDZIE PRZEZ WSTRZYKNIĘTY CALLBACK, gdy jest. To on wgrywa
//      plik do biblioteki mediów tenanta; awaryjne pytanie o URL zostawiłoby
//      w treści adres zewnętrzny, który jutro przestanie działać.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ prompt: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-panes-misc", () => ({}));

vi.mock("@/lib/appDialogs", async () => {
  const { vi: v } = await import("vitest");
  h.prompt = v.fn(async () => "https://example.com/obrazek.png");
  return { promptDialog: h.prompt };
});

import { PostEditor } from "@/components/admin/PostEditor";

type Mock = ReturnType<typeof vi.fn>;
const promptDialog = () => h.prompt as Mock;

beforeEach(() => {
  promptDialog().mockReset();
  promptDialog().mockResolvedValue("https://example.com/obrazek.png");
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tryb markdown
// ---------------------------------------------------------------------------

describe("PostEditor - tryb markdown", () => {
  it("pokazuje pole źródła i podgląd OBOK siebie", () => {
    // Markdown bez podglądu zmusza redaktora do zapisu, żeby zobaczyć wynik.
    render(<PostEditor mode="markdown" value="# Nagłówek" onChange={vi.fn()} />);

    expect(screen.getByRole("textbox")).toHaveValue("# Nagłówek");
    // Podgląd renderuje nagłówek jako element, nie jako surowy tekst z „#".
    expect(screen.getByRole("heading", { name: "Nagłówek" })).toBeInTheDocument();
  });

  it("pisanie oddaje treść wywołującemu", () => {
    const onChange = vi.fn();
    render(<PostEditor mode="markdown" value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "## Druga" } });

    expect(onChange).toHaveBeenCalledWith("## Druga");
  });

  it("pusta treść pokazuje w podglądzie zachętę, nie pustkę", () => {
    render(<PostEditor mode="markdown" value="" onChange={vi.fn()} />);
    expect(screen.getByText("adminPanesMisc.postEditor.previewPlaceholder")).toBeInTheDocument();
  });

  it("tryb markdown NIE renderuje paska narzędzi rich text", () => {
    // Pogrubienie przyciskiem w markdownie wstawiłoby HTML do dokumentu, który
    // ma być tekstem źródłowym.
    render(<PostEditor mode="markdown" value="x" onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Bold")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tryb rich text
// ---------------------------------------------------------------------------

describe("PostEditor - tryb rich text", () => {
  const renderRich = (value = "<p>Treść</p>", onPickImage?: () => Promise<string | null>) => {
    const onChange = vi.fn();
    const view = render(
      <PostEditor mode="richtext" value={value} onChange={onChange} onPickImage={onPickImage} />,
    );
    return { ...view, onChange };
  };

  it("renderuje pełny pasek formatowania z NAZWANYMI przyciskami", () => {
    // Przyciski są ikonami - bez `aria-label` czytnik ekranu ogłosiłby dziewięć
    // nienazwanych przycisków.
    renderRich();
    for (const label of [
      "Bold",
      "Italic",
      "H2",
      "H3",
      "UL",
      "OL",
      "Quote",
      "Link",
      "Image",
      "Undo",
      "Redo",
    ]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });

  it("wczytuje wartość początkową do edytora", async () => {
    renderRich("<p>Polska treść</p>");
    await waitFor(() => expect(screen.getByText("Polska treść")).toBeInTheDocument());
  });

  it("ZEWNĘTRZNA zmiana wartości trafia do edytora (undo / przywrócenie rewizji)", async () => {
    // Bez tej synchronizacji redaktor klika „cofnij", formularz zmienia treść,
    // a ekran pokazuje starą - do najbliższego przeładowania.
    const { rerender } = render(
      <PostEditor mode="richtext" value="<p>Pierwsza</p>" onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Pierwsza")).toBeInTheDocument());

    rerender(<PostEditor mode="richtext" value="<p>Druga</p>" onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Druga")).toBeInTheDocument());
    expect(screen.queryByText("Pierwsza")).toBeNull();
  });

  it("PUSTA wartość z zewnątrz czyści edytor", async () => {
    // „Porzuć zmiany" na nowym wpisie ustawia pustą treść.
    const { rerender } = render(
      <PostEditor mode="richtext" value="<p>Coś</p>" onChange={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Coś")).toBeInTheDocument());

    rerender(<PostEditor mode="richtext" value="" onChange={vi.fn()} />);

    await waitFor(() => expect(screen.queryByText("Coś")).toBeNull());
  });

  it("wstawienie linku pyta o adres i NIE wstawia nic przy anulowaniu", async () => {
    promptDialog().mockResolvedValue(null);
    renderRich();

    fireEvent.click(screen.getByLabelText("Link"));

    await waitFor(() => expect(promptDialog()).toHaveBeenCalled());
    // Anulowanie nie może wstawić pustego linku do treści.
    expect(document.querySelector("a")).toBeNull();
  });

  it("wybór obrazka idzie przez WSTRZYKNIĘTY callback, gdy jest podany", async () => {
    // To on wgrywa plik do biblioteki mediów tenanta. Awaryjne pytanie o URL
    // zostawiłoby w treści adres zewnętrzny, który jutro przestanie działać.
    const onPickImage = vi.fn(async () => "https://cdn.tenant/obraz.png");
    renderRich("<p>x</p>", onPickImage);

    fireEvent.click(screen.getByLabelText("Image"));

    await waitFor(() => expect(onPickImage).toHaveBeenCalledTimes(1));
    // Awaryjne pytanie o URL NIE zostało użyte.
    expect(promptDialog()).not.toHaveBeenCalled();
  });

  it("BEZ callbacku obrazka pyta o adres jako ścieżkę awaryjną", async () => {
    renderRich("<p>x</p>", undefined);

    fireEvent.click(screen.getByLabelText("Image"));

    await waitFor(() => expect(promptDialog()).toHaveBeenCalled());
  });

  it("anulowany wybór obrazka nie wstawia pustego obrazu", async () => {
    const onPickImage = vi.fn(async () => null);
    renderRich("<p>x</p>", onPickImage);

    fireEvent.click(screen.getByLabelText("Image"));

    await waitFor(() => expect(onPickImage).toHaveBeenCalled());
    expect(document.querySelector("img")).toBeNull();
  });

  it("przyciski formatowania nie wysypują edytora", async () => {
    // Każdy z nich woła łańcuch komend TipTapa; brakująca rozszerzenie
    // (np. blockquote) rzuciłoby przy kliknięciu.
    const { onChange } = renderRich();

    for (const label of ["Bold", "Italic", "H2", "H3", "UL", "OL", "Quote", "Undo", "Redo"]) {
      fireEvent.click(screen.getByLabelText(label));
    }

    // Formatowanie zmienia dokument, więc wywołujący dostaje nową treść.
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
