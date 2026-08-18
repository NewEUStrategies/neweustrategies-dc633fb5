// Ciało podglądu dokumentu - wybór czytnika i ścieżki błędu.
//
// Reguła stanu ma własne, wyczerpujące testy w `lib/files/viewerState`. Tutaj
// sprawdzamy to, czego czysta warstwa nie widzi: czy MIME prowadzi do
// właściwego czytnika, czy komunikat naprawdę pochodzi ze słownika i czy
// ciężkie parsery są wołane dopiero wtedy, kiedy trzeba.
//
// TŁUMACZ JEST PRAWDZIWY i NIEZAATRAPOWANY. Atrapa echująca klucz przechodzi
// także wtedy, gdy klucz zniknie ze słownika, a tu asercje dotyczą komunikatów,
// które użytkownik naprawdę przeczyta.
//
// UWAGA NA PUŁAPKĘ: `vi.mock("react-i18next", ...)` z fabryką sięgającą po
// `@/test/i18nReal` ZAWIESZA przebieg bez żadnego komunikatu - ten helper
// importuje `@/lib/i18n`, a ten importuje `initReactI18next` z... `react-i18next`,
// czyli z modułu, który właśnie zastępujemy. Docstring `i18nReal.ts` ostrzega
// przed tym wprost. Dlatego tu NIE MA atrapy `react-i18next`: komponent dostaje
// prawdziwy `useTranslation()` z prawdziwej instancji i18next, a import
// `@/test/i18nReal` służy wyłącznie do dociągnięcia obu rdzeni językowych
// i do zbudowania `t` po stronie asercji.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n-file-viewer";
import { realT } from "@/test/i18nReal";

interface SlideStub {
  index: number;
  title: string | null;
  paragraphs: string[];
  notes: string | null;
  images: string[];
}

// Wyniki parserów są FABRYKAMI, nie gotowymi obietnicami. Gdyby test
// przypisywał `Promise.reject(...)` wprost, odrzucenie powstawałoby zanim
// komponent zdąży podpiąć `.catch` - i vitest raportowałby „Unhandled
// Rejection" mimo poprawnie działającego kodu.
const h = vi.hoisted(() => ({
  docx: (() =>
    Promise.resolve({ html: "<p>Treść raportu</p>", warnings: [] as string[] })) as () => Promise<{
    html: string;
    warnings: string[];
  }>,
  sheets: (() =>
    Promise.resolve([{ name: "Arkusz1", html: "<table></table>", rows: 3 }])) as () => Promise<
    Array<{ name: string; html: string; rows: number }>
  >,
  slides: (() => Promise.resolve([])) as () => Promise<SlideStub[]>,
  docxCalls: 0,
}));

vi.mock("@/lib/files/officeParse", () => ({
  parseDocx: () => {
    h.docxCalls += 1;
    return h.docx();
  },
  parseSpreadsheet: () => h.sheets(),
  parsePptx: () => h.slides(),
}));

const { DocumentViewerBody } = await import("@/components/files/DocumentViewerBody");

const t = realT("pl");

/** Odpowiedź sieci dla pobrań podglądu. */
function stubFetch(options: { ok?: boolean; text?: string } = {}) {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: options.ok ?? true,
      status: options.ok === false ? 404 : 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      text: () => Promise.resolve(options.text ?? ""),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  h.docx = () => Promise.resolve({ html: "<p>Treść raportu</p>", warnings: [] });
  h.sheets = () => Promise.resolve([{ name: "Arkusz1", html: "<table></table>", rows: 3 }]);
  h.slides = () => Promise.resolve([]);
  h.docxCalls = 0;
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("wybór czytnika po typie pliku", () => {
  it("PDF renderuje się natywnym osadzeniem", () => {
    render(
      <DocumentViewerBody
        source={{ url: "/x.pdf", name: "raport.pdf", mime: "application/pdf" }}
      />,
    );
    expect(screen.getByTestId("file-viewer-pdf")).toBeInTheDocument();
  });

  it("obraz dostaje tekst alternatywny z nazwy pliku", () => {
    // Nazwa pliku to jedyny opis, jaki mamy - bez niej czytnik ekranu ogłasza
    // „obraz" i nic więcej.
    render(
      <DocumentViewerBody source={{ url: "/a.png", name: "wykres.png", mime: "image/png" }} />,
    );
    expect(screen.getByTestId("file-viewer-image")).toHaveAttribute("alt", "wykres.png");
  });

  it("wideo i audio dostają sterowanie odtwarzaniem", () => {
    const { container, rerender } = render(
      <DocumentViewerBody source={{ url: "/a.mp4", name: "a.mp4", mime: "video/mp4" }} />,
    );
    expect(container.querySelector("video")).toHaveAttribute("controls");
    rerender(<DocumentViewerBody source={{ url: "/a.mp3", name: "a.mp3", mime: "audio/mpeg" }} />);
    expect(container.querySelector("audio")).toHaveAttribute("controls");
  });

  it("nieobsługiwany format kieruje do pobrania pliku", () => {
    render(
      <DocumentViewerBody
        source={{ url: "/a.bin", name: "a.bin", mime: "application/octet-stream" }}
      />,
    );
    expect(screen.getByText(t("fileViewer.unsupported"))).toBeInTheDocument();
  });

  it("archiwum też trafia na komunikat o braku podglądu", () => {
    render(<DocumentViewerBody source={{ url: "/a.zip", name: "a.zip", mime: "" }} />);
    expect(screen.getByText(t("fileViewer.unsupported"))).toBeInTheDocument();
  });
});

describe("czytnik dokumentów Worda", () => {
  const docxSource = { url: "/a.docx", name: "raport.docx", mime: "" };

  it("pokazuje przetworzony dokument", async () => {
    render(<DocumentViewerBody source={docxSource} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-docx")).toBeInTheDocument());
    expect(screen.getByTestId("file-viewer-docx").innerHTML).toContain("Treść raportu");
  });

  it("stary format .doc NIE POBIERA pliku - decyzja zapada z nazwy", async () => {
    // Cała oszczędność tej reguły: kilkanaście megabajtów transferu, którego
    // nie ma powodu wydawać, żeby powiedzieć „pobierz plik".
    const fetchMock = stubFetch();
    render(<DocumentViewerBody source={{ url: "/a.doc", name: "umowa.doc", mime: "" }} />);
    expect(screen.getByText(t("fileViewer.legacyFormat"))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.docxCalls).toBe(0);
  });

  it("nieudane pobranie pokazuje błąd wraz z podpowiedzią", async () => {
    stubFetch({ ok: false });
    render(<DocumentViewerBody source={docxSource} />);
    await waitFor(() => expect(screen.getByText(t("fileViewer.error"))).toBeInTheDocument());
    expect(screen.getByText(t("fileViewer.protectedHint"))).toBeInTheDocument();
  });

  it("odrzucenie przez parser pokazuje błąd", async () => {
    h.docx = () => Promise.reject(new Error("zepsuty"));
    render(<DocumentViewerBody source={docxSource} />);
    await waitFor(() => expect(screen.getByText(t("fileViewer.error"))).toBeInTheDocument());
  });

  it("dokument bez treści dostaje własny komunikat, nie błąd", async () => {
    h.docx = () => Promise.resolve({ html: "   ", warnings: [] });
    render(<DocumentViewerBody source={docxSource} />);
    await waitFor(() =>
      expect(screen.getByText(t("fileViewer.emptyDocument"))).toBeInTheDocument(),
    );
    expect(screen.queryByText(t("fileViewer.error"))).not.toBeInTheDocument();
  });
});

describe("czytnik arkuszy", () => {
  const xlsxSource = { url: "/a.xlsx", name: "budzet.xlsx", mime: "" };

  it("pokazuje arkusz i liczbę wierszy", async () => {
    render(<DocumentViewerBody source={xlsxSource} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-sheet")).toBeInTheDocument());
    expect(screen.getByText(t("fileViewer.rows", { count: 3 }))).toBeInTheDocument();
  });

  it("jeden arkusz NIE dostaje paska zakładek", async () => {
    render(<DocumentViewerBody source={xlsxSource} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-sheet")).toBeInTheDocument());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("wiele arkuszy dostaje zakładki i można je przełączać", async () => {
    h.sheets = () =>
      Promise.resolve([
        { name: "Styczeń", html: "<table>A</table>", rows: 2 },
        { name: "Luty", html: "<table>B</table>", rows: 5 },
      ]);
    render(<DocumentViewerBody source={xlsxSource} />);
    await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument());

    const luty = screen.getByRole("tab", { name: "Luty" });
    expect(screen.getByRole("tab", { name: "Styczeń" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(luty);
    expect(luty).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(t("fileViewer.rows", { count: 5 }))).toBeInTheDocument();
  });

  it("stary format .xls nie jest pobierany", () => {
    const fetchMock = stubFetch();
    render(<DocumentViewerBody source={{ url: "/a.xls", name: "budzet.xls", mime: "" }} />);
    expect(screen.getByText(t("fileViewer.legacyFormat"))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pusty skoroszyt dostaje komunikat o braku treści", async () => {
    h.sheets = () => Promise.resolve([]);
    render(<DocumentViewerBody source={xlsxSource} />);
    await waitFor(() =>
      expect(screen.getByText(t("fileViewer.emptyDocument"))).toBeInTheDocument(),
    );
  });

  it("odrzucenie przez parser arkusza pokazuje błąd BEZ podpowiedzi o szyfrowaniu", async () => {
    // Podpowiedź „plik może być zaszyfrowany" ma tylko czytnik Worda -
    // dla arkusza byłaby zgadywaniem.
    h.sheets = () => Promise.reject(new Error("zepsuty"));
    render(<DocumentViewerBody source={xlsxSource} />);
    await waitFor(() => expect(screen.getByText(t("fileViewer.error"))).toBeInTheDocument());
    expect(screen.queryByText(t("fileViewer.protectedHint"))).not.toBeInTheDocument();
  });
});

describe("czytnik prezentacji", () => {
  const pptxSource = { url: "/a.pptx", name: "deck.pptx", mime: "" };

  it("pokazuje slajdy z tytułem, punktami i notatkami", async () => {
    h.slides = () =>
      Promise.resolve([
        {
          index: 1,
          title: "Cele na 2026",
          paragraphs: ["Punkt pierwszy", "Punkt drugi"],
          notes: "Powiedzieć o budżecie",
          images: [],
        },
      ]);
    render(<DocumentViewerBody source={pptxSource} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-slides")).toBeInTheDocument());
    expect(screen.getByText("Cele na 2026")).toBeInTheDocument();
    expect(screen.getByText("Punkt pierwszy")).toBeInTheDocument();
    expect(screen.getByText("Powiedzieć o budżecie")).toBeInTheDocument();
    expect(screen.getByText(t("fileViewer.slide", { index: 1 }))).toBeInTheDocument();
  });

  it("slajd bez tytułu, punktów i notatek renderuje samą ramkę", async () => {
    h.slides = () =>
      Promise.resolve([{ index: 1, title: null, paragraphs: [], notes: null, images: [] }]);
    render(<DocumentViewerBody source={pptxSource} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-slides")).toBeInTheDocument());
    expect(screen.getByText(t("fileViewer.slide", { index: 1 }))).toBeInTheDocument();
  });

  it("obrazy slajdu mają PUSTY tekst alternatywny - są dekoracją treści tekstowej", async () => {
    h.slides = () =>
      Promise.resolve([
        {
          index: 1,
          title: "Slajd",
          paragraphs: [],
          notes: null,
          images: ["blob:jeden", "blob:dwa"],
        },
      ]);
    const { container } = render(<DocumentViewerBody source={pptxSource} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-slides")).toBeInTheDocument());
    const images = container.querySelectorAll("#root img, img");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("alt", "");
  });

  it("pusta prezentacja dostaje komunikat o braku treści", async () => {
    render(<DocumentViewerBody source={pptxSource} />);
    await waitFor(() =>
      expect(screen.getByText(t("fileViewer.emptyDocument"))).toBeInTheDocument(),
    );
  });

  it("stary format .ppt nie jest pobierany", () => {
    const fetchMock = stubFetch();
    render(<DocumentViewerBody source={{ url: "/a.ppt", name: "deck.ppt", mime: "" }} />);
    expect(screen.getByText(t("fileViewer.legacyFormat"))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("czytnik tekstu i CSV", () => {
  it("zwykły tekst renderuje się w bloku preformatowanym", async () => {
    stubFetch({ text: "linia pierwsza\nlinia druga" });
    render(<DocumentViewerBody source={{ url: "/a.txt", name: "log.txt", mime: "" }} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-text")).toBeInTheDocument());
    expect(screen.getByTestId("file-viewer-text")).toHaveTextContent("linia pierwsza");
  });

  it("CSV renderuje się jako tabela, a nie jako tekst", async () => {
    stubFetch({ text: "imie,nazwisko\nAnna,Kowalska" });
    render(<DocumentViewerBody source={{ url: "/a.csv", name: "dane.csv", mime: "" }} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-csv")).toBeInTheDocument());
    expect(screen.getByText("Kowalska")).toBeInTheDocument();
    expect(screen.queryByTestId("file-viewer-text")).not.toBeInTheDocument();
  });

  it("CSV rozdzielony ŚREDNIKIEM też rozpada się na komórki", async () => {
    // Polski eksport z Excela używa średnika; bez tego cały wiersz byłby
    // jedną komórką i tabela wyglądałaby na uszkodzoną.
    stubFetch({ text: "imie;nazwisko\nAnna;Kowalska" });
    render(<DocumentViewerBody source={{ url: "/a.csv", name: "dane.csv", mime: "" }} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-csv")).toBeInTheDocument());
    expect(screen.getByText("Kowalska")).toBeInTheDocument();
  });

  it("markdown idzie do czytnika tekstu, nie do tabeli", async () => {
    stubFetch({ text: "# Nagłówek" });
    render(<DocumentViewerBody source={{ url: "/a.md", name: "notatka.md", mime: "" }} />);
    await waitFor(() => expect(screen.getByTestId("file-viewer-text")).toBeInTheDocument());
  });

  it("nieudane pobranie tekstu pokazuje błąd", async () => {
    stubFetch({ ok: false });
    render(<DocumentViewerBody source={{ url: "/a.txt", name: "log.txt", mime: "" }} />);
    await waitFor(() => expect(screen.getByText(t("fileViewer.error"))).toBeInTheDocument());
  });
});
