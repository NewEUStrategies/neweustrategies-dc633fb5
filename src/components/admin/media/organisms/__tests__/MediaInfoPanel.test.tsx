// Panel informacji o pliku + lista jego użyć. Do 18.08.2026 oba na zerze
// (115 + 84 linii).
//
// Panel niesie JEDYNĄ w całym module ścieżkę redakcji tekstu alternatywnego -
// czyli dostępności obrazów i ich opisu dla wyszukiwarek. Trzy reguły:
// przycisk zapisu jest wyłączony bez zmiany (żeby nie generować pustych
// zapisów), licznik pilnuje limitu 500 znaków po stronie klienta, a pole
// RESETUJE SIĘ przy przełączeniu pliku - inaczej opis jednego zdjęcia zostaje
// w polu drugiego i da się go tam zapisać.
//
// Lista użyć jest bramką przed skasowaniem zasobu nadal osadzonego w treści -
// musi rozróżniać cztery stany: ładowanie, błąd, brak użyć i listę.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

// Nakładka i18n rejestruje się efektem ubocznym importu. Panel i lista same
// jej nie importują (robi to organizm nadrzędny), więc test musi ją wciągnąć -
// inaczej asercje mierzyłyby surowe klucze zamiast napisów widzianych przez
// użytkownika.
import "@/lib/i18n-admin-media";
import { MediaInfoPanel } from "../MediaInfoPanel";
import { MediaUsageList } from "../../molecules/MediaUsageList";
import type { MediaRow } from "../../types";
import type { MediaUsageItem } from "@/lib/media.functions";

function file(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    tenant_id: "t1",
    storage_path: "t1/u/a.png",
    public_url: "https://cdn.example/a.png",
    filename: "okladka.png",
    mime_type: "image/png",
    size_bytes: 2048,
    uploader_id: "u",
    created_at: "2026-01-15T10:00:00.000Z",
    folder_path: "/press/",
    alt_text: null,
    ...overrides,
  };
}

function setupPanel(
  target: MediaRow | null,
  opts: { imgSize?: { w: number; h: number } | null; onSaveAlt?: () => Promise<void> } = {},
) {
  const onSaveAlt = vi.fn(opts.onSaveAlt ?? (async () => undefined));
  const view = render(
    <MediaInfoPanel target={target} imgSize={opts.imgSize ?? null} onSaveAlt={onSaveAlt} />,
  );
  return { onSaveAlt, view };
}

describe("MediaInfoPanel - bez zaznaczenia", () => {
  it("prosi o wybranie jednego pliku", () => {
    // Panel jest sensowny tylko dla jednego pliku; przy zaznaczeniu wielokrotnym
    // orkiestrator podaje `null`.
    setupPanel(null);
    expect(screen.getByText(/Zaznacz jeden plik/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("MediaInfoPanel - metadane", () => {
  it("pokazuje typ, rozmiar, folder i identyfikator", () => {
    setupPanel(file());
    expect(screen.getByText("image/png")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("/press/")).toBeInTheDocument();
    expect(screen.getByText("m1")).toBeInTheDocument();
  });

  it("plik BEZ typu pokazuje myślnik zamiast pustki", () => {
    setupPanel(file({ mime_type: null }));
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("wymiary pojawiają się DOPIERO po zmierzeniu obrazu", () => {
    const { view } = setupPanel(file());
    expect(screen.queryByText(/× 600 px/)).toBeNull();
    view.unmount();

    setupPanel(file(), { imgSize: { w: 800, h: 600 } });
    expect(screen.getByText("800 × 600 px")).toBeInTheDocument();
  });

  it("pełna nazwa jest w podpowiedzi, bo tekst bywa ucięty", () => {
    setupPanel(file());
    expect(screen.getByTitle("okladka.png")).toBeInTheDocument();
  });

  it("OBRAZ dostaje podgląd, inny plik - zastępczą ikonę", () => {
    const { view } = setupPanel(file());
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/a.png");
    view.unmount();

    setupPanel(file({ mime_type: "application/pdf", filename: "raport.pdf" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("📄")).toBeInTheDocument();
  });

  it("podgląd używa alt-tekstu, a bez niego - nazwy pliku", () => {
    const { view } = setupPanel(file({ alt_text: "Wykres inflacji" }));
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Wykres inflacji");
    view.unmount();

    setupPanel(file({ alt_text: null }));
    expect(screen.getByRole("img")).toHaveAttribute("alt", "okladka.png");
  });

  it("odnośnik do pliku otwiera się w nowej karcie bezpiecznie", () => {
    // `rel="noreferrer"` przy `target="_blank"` - bez tego nowa karta dostaje
    // referencję do okna panelu administracyjnego.
    setupPanel(file());
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });
});

describe("MediaInfoPanel - tekst alternatywny", () => {
  it("pole pojawia się TYLKO dla obrazów", () => {
    const { view } = setupPanel(file({ mime_type: "application/pdf" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    view.unmount();

    setupPanel(file());
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("pole ma etykietę powiązaną przez htmlFor", () => {
    // Bez powiązania czytnik ekranu czyta nienazwane pole tekstowe.
    setupPanel(file());
    const textarea = screen.getByRole("textbox");
    expect(textarea.id).toBeTruthy();
    expect(document.querySelector(`label[for="${textarea.id}"]`)).toBeTruthy();
  });

  it("startuje z zapisanym opisem", () => {
    setupPanel(file({ alt_text: "Wykres inflacji" }));
    expect(screen.getByRole("textbox")).toHaveValue("Wykres inflacji");
  });

  it("zapis jest WYŁĄCZONY, dopóki nic się nie zmieniło", () => {
    setupPanel(file({ alt_text: "Opis" }));
    expect(screen.getByRole("button", { name: /zapisz|save/i })).toBeDisabled();
  });

  it("zapis włącza się po zmianie i wysyła opis PRZYCIĘTY z białych znaków", () => {
    const { onSaveAlt } = setupPanel(file());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Nowy opis  " } });

    const save = screen.getByRole("button", { name: /zapisz|save/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSaveAlt).toHaveBeenCalledWith("m1", "Nowy opis");
  });

  it("potwierdza zapis komunikatem", async () => {
    toastSuccess.mockClear();
    setupPanel(file());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Opis" } });
    fireEvent.click(screen.getByRole("button", { name: /zapisz|save/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("PRZYCINA wpis do 500 znaków po stronie klienta", () => {
    // Serwerowy schemat też ma ten limit; obcięcie tutaj oszczędza użytkownikowi
    // odrzuconego zapisu po napisaniu długiego opisu.
    setupPanel(file());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x".repeat(600) } });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toHaveLength(500);
  });

  it("licznik pokazuje wykorzystanie limitu", () => {
    setupPanel(file());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc" } });
    expect(screen.getByText("3/500")).toBeInTheDocument();
  });

  it("RESETUJE pole przy przełączeniu na inny plik", () => {
    // Bez resetu opis jednego zdjęcia zostaje w polu drugiego - i da się go
    // tam zapisać, przypisując obcy opis do obcego obrazu.
    const { view } = setupPanel(file({ alt_text: "Pierwszy" }));
    view.unmount();

    setupPanel(file({ id: "m2", alt_text: "Drugi" }));
    expect(screen.getByRole("textbox")).toHaveValue("Drugi");
  });

  it("zdejmuje blokadę przycisku także po porażce zapisu", async () => {
    // Bez `finally` jeden błąd blokuje zapis opisu do końca sesji.
    setupPanel(file(), {
      onSaveAlt: async () => {
        throw new Error("odmowa");
      },
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Opis" } });
    fireEvent.click(screen.getByRole("button", { name: /zapisz|save/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /zapisz|save/i })).toBeEnabled());
  });
});

describe("MediaUsageList - cztery stany", () => {
  function usage(overrides: Partial<MediaUsageItem> = {}): MediaUsageItem {
    return { kind: "post", id: "p1", slug: "wpis", title: "Wpis", where: ["cover"], ...overrides };
  }

  it("stan ŁADOWANIA nie udaje braku użyć", () => {
    // „Nieużywany" pokazany w trakcie ładowania to zaproszenie do skasowania
    // zasobu, który jest w użyciu.
    render(<MediaUsageList isLoading error={null} items={undefined} />);
    expect(screen.queryByText(/nie jest jeszcze używany/i)).toBeNull();
  });

  it("stan BŁĘDU pokazuje komunikat, nie pustkę", () => {
    render(
      <MediaUsageList isLoading={false} error={new Error("odmowa skanu")} items={undefined} />,
    );
    expect(screen.getByText("odmowa skanu")).toBeInTheDocument();
    expect(screen.queryByText(/nie jest jeszcze używany/i)).toBeNull();
  });

  it("błąd, który nie jest wyjątkiem, też jest pokazany", () => {
    render(<MediaUsageList isLoading={false} error="awaria" items={undefined} />);
    expect(screen.getByText("awaria")).toBeInTheDocument();
  });

  it("stan PUSTY mówi wprost, że plik nie jest używany", () => {
    render(<MediaUsageList isLoading={false} error={null} items={[]} />);
    expect(screen.getByText(/nie jest jeszcze używany/i)).toBeInTheDocument();
  });

  it("brak danych bez błędu i bez ładowania też jest stanem pustym", () => {
    render(<MediaUsageList isLoading={false} error={null} items={undefined} />);
    expect(screen.getByText(/nie jest jeszcze używany/i)).toBeInTheDocument();
  });
});

describe("MediaUsageList - lista użyć", () => {
  function usage(overrides: Partial<MediaUsageItem> = {}): MediaUsageItem {
    return { kind: "post", id: "p1", slug: "wpis", title: "Wpis", where: ["cover"], ...overrides };
  }

  it("pokazuje tytuł, slug i rodzaj treści", () => {
    render(<MediaUsageList isLoading={false} error={null} items={[usage()]} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Wpis")).toBeInTheDocument();
    expect(within(item).getByText("/wpis")).toBeInTheDocument();
  });

  it("kieruje do WŁAŚCIWEGO edytora dla wpisu i dla strony", () => {
    const { unmount } = render(
      <MediaUsageList isLoading={false} error={null} items={[usage({ kind: "post" })]} />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("posts"));
    unmount();

    render(
      <MediaUsageList
        isLoading={false}
        error={null}
        items={[usage({ kind: "page", slug: "o-nas" })]}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("pages"));
  });

  it("tłumaczy KAŻDY obszar użycia - serwer oddaje je neutralnie językowo", () => {
    // `where` przychodzi z serwera jako stabilne klucze; brak tłumaczenia
    // pokazałby użytkownikowi „builder" i „blocks" w polskim panelu.
    const areas = ["cover", "excerpt", "content", "builder", "blocks", "layout"] as const;
    render(
      <MediaUsageList isLoading={false} error={null} items={[usage({ where: [...areas] })]} />,
    );

    const badges = screen.getByRole("listitem").querySelectorAll("span.uppercase");
    const labels = Array.from(badges).map((b) => b.textContent);
    for (const label of labels) {
      expect(label).toBeTruthy();
      expect(areas).not.toContain(label);
    }
  });

  it("renderuje wiele użyć naraz", () => {
    render(
      <MediaUsageList
        isLoading={false}
        error={null}
        items={[usage(), usage({ id: "g1", kind: "page", slug: "o-nas", title: "O nas" })]}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("pełny tytuł jest w podpowiedzi, bo bywa ucięty", () => {
    render(
      <MediaUsageList
        isLoading={false}
        error={null}
        items={[usage({ title: "Bardzo długi tytuł wpisu" })]}
      />,
    );
    expect(screen.getByTitle("Bardzo długi tytuł wpisu")).toBeInTheDocument();
  });
});
