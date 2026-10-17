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
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

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

  it("podgląd renderuje listy, linki i kod jako elementy", () => {
    // Parser podglądu to `marked` (post-editor/lib/markdownPreview.ts) - ten
    // test pilnuje, że PostEditor faktycznie go używa, a nie np. surowego tekstu.
    const { container } = render(
      <PostEditor
        mode="markdown"
        value={"- jeden\n- dwa\n\n[strona](https://example.com)\n\n```\nkod()\n```"}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["jeden", "dwa"]);
    expect(screen.getByRole("link", { name: "strona" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(container.querySelector("pre > code")?.textContent).toBe("kod()\n");
  });

  it("podgląd SANITYZUJE wynik parsera: bez <script>, on* i javascript:", () => {
    // marked przepuszcza surowy HTML i `javascript:` - jedyną zaporą jest
    // `sanitizeMarkdownHtml` przy sinku. Gdyby ktoś ją zdjął, redaktor
    // otwierający cudzy szkic uruchomiłby skrypt w sesji panelu admina.
    const { container } = render(
      <PostEditor
        mode="markdown"
        value={
          'ok\n\n<img src="https://e.com/a.png" onerror="alert(1)">\n\n[zły](javascript:alert(1))'
        }
        onChange={vi.fn()}
      />,
    );
    const podglad = container.querySelector(".prose")!;
    const img = podglad.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://e.com/a.png");
    expect(img).not.toHaveAttribute("onerror");
    expect(screen.getByText("zły").closest("a")?.getAttribute("href") ?? "").not.toMatch(
      /javascript:/i,
    );

    const { container: zeSkryptem } = render(
      <PostEditor mode="markdown" value={"ok\n\n<script>alert(1)</script>"} onChange={vi.fn()} />,
    );
    expect(zeSkryptem.querySelector(".prose script")).toBeNull();
  });

  it("podgląd izoluje rysowanie (contain:paint) - `position:fixed` ze szkicu nie przykryje panelu", () => {
    // Sanitizer zostawia `style`, więc jedyną zaporą przed phishingową
    // nakładką na cały panel (działającą bez kliknięcia; popover z
    // `popovertarget` to osobna luka polityki - patrz komentarz w PostEditor)
    // jest paint containment pudełka podglądu.
    // happy-dom nie liczy layoutu - test przypina klasę, komentarz w
    // PostEditor wyjaśnia mechanizm.
    const { container } = render(
      <PostEditor
        mode="markdown"
        value={'<div style="position:fixed;inset:0;z-index:2147483647">Sesja wygasła</div>'}
        onChange={vi.fn()}
      />,
    );
    const podglad = container.querySelector(".prose")!;
    expect(podglad).toHaveClass("[contain:paint]");
    expect(podglad.querySelector("div[style]")).not.toBeNull();
  });

  it("głęboko zagnieżdżony szkic nie wywraca edytora - podgląd pokazuje źródło", () => {
    // react-markdown rzucał tu RangeError z renderu i zabierał cały edytor;
    // marked też przepełnia stos, ale markdownToUnsafeHtml łapie to i oddaje
    // źródło jako tekst.
    const value = "> ".repeat(5000) + "x";
    const { container } = render(<PostEditor mode="markdown" value={value} onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue(value);
    expect(container.querySelector(".prose pre")?.textContent).toBe(value);
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

    await act(async () => fireEvent.click(screen.getByLabelText("Image")));

    await waitFor(() => expect(onPickImage).toHaveBeenCalledTimes(1));
    // Awaryjne pytanie o URL NIE zostało użyte.
    expect(promptDialog()).not.toHaveBeenCalled();
  });

  it("BEZ callbacku obrazka pyta o adres jako ścieżkę awaryjną", async () => {
    renderRich("<p>x</p>", undefined);

    await act(async () => fireEvent.click(screen.getByLabelText("Image")));

    await waitFor(() => expect(promptDialog()).toHaveBeenCalled());
  });

  it("anulowany wybór obrazka nie wstawia pustego obrazu", async () => {
    const onPickImage = vi.fn(async () => null);
    renderRich("<p>x</p>", onPickImage);

    await act(async () => fireEvent.click(screen.getByLabelText("Image")));

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
