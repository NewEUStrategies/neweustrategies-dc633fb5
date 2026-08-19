// Powłoka podglądu pliku: popup i hook sterujący.
//
// POWŁOKA JEST LEKKA, TREŚĆ CIĘŻKA - i to jest jej jedyny powód istnienia.
// Nagłówek, akcje i klawiatura wchodzą do zwykłego chunku, a parsery formatów
// biurowych są za `lazy()`, więc samo istnienie przycisku „Podgląd" na stronie
// nic nie kosztuje. Ten test pilnuje obu połówek tego kontraktu: że powłoka
// renderuje się bez ciała i że ciało jednak dojeżdża.
//
// Tłumacz jest PRAWDZIWY (bez atrapy `react-i18next` - patrz komentarz
// w `DocumentViewerBody.test.tsx`, gdzie atrapa zawiesza przebieg).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n-file-viewer";
import { realT } from "@/test/i18nReal";

vi.mock("@/components/files/DocumentViewerBody", () => ({
  DocumentViewerBody: ({ source }: { source: { name: string } }) => (
    <div data-testid="ciało-podglądu">{source.name}</div>
  ),
}));

const { DocumentViewerDialog } = await import("@/components/files/DocumentViewerDialog");
const { useDocumentViewer } = await import("@/components/files/useDocumentViewer");

const t = realT("pl");

const FILE = {
  url: "https://kubelek.example/podpisany/raport.pdf",
  name: "raport-roczny.pdf",
  mime: "application/pdf",
  size: 2_400_000,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("DocumentViewerDialog", () => {
  it("bez pliku nie renderuje zawartości popupu", () => {
    render(<DocumentViewerDialog file={null} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByTestId("file-viewer-dialog")).not.toBeInTheDocument();
  });

  it("`open` bez pliku też nie otwiera popupu", () => {
    // Podwójny warunek `open && file !== null` chroni przed mignięciem pustego
    // okna między kliknięciem a ustawieniem pliku.
    render(<DocumentViewerDialog file={null} open onOpenChange={() => {}} />);
    expect(screen.queryByTestId("file-viewer-dialog")).not.toBeInTheDocument();
  });

  it("pokazuje nazwę pliku, etykietę typu i rozmiar", async () => {
    render(<DocumentViewerDialog file={FILE} open onOpenChange={() => {}} />);
    expect(await screen.findByRole("heading", { name: "raport-roczny.pdf" })).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("2.3 MB")).toBeInTheDocument();
  });

  it("brak rozmiaru nie zostawia napisu `null` w nagłówku", async () => {
    render(<DocumentViewerDialog file={{ ...FILE, size: null }} open onOpenChange={() => {}} />);
    expect(await screen.findByRole("heading", { name: "raport-roczny.pdf" })).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("pobranie zachowuje ORYGINALNĄ nazwę pliku", async () => {
    // Adres w kubełku jest podpisany i nieczytelny; bez `download` z nazwą
    // użytkownik zapisałby plik jako ciąg losowych znaków.
    render(<DocumentViewerDialog file={FILE} open onOpenChange={() => {}} />);
    const download = await screen.findByText(t("fileViewer.download"));
    const link = download.closest("a");
    expect(link).toHaveAttribute("download", "raport-roczny.pdf");
    expect(link).toHaveAttribute("href", FILE.url);
  });

  it("otwarcie w nowej karcie jest zabezpieczone przed przejęciem okna", async () => {
    render(<DocumentViewerDialog file={FILE} open onOpenChange={() => {}} />);
    const link = (await screen.findByText(t("fileViewer.openInTab"))).closest("a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("ciało podglądu dojeżdża i dostaje adres, nazwę oraz typ pliku", async () => {
    render(<DocumentViewerDialog file={FILE} open onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("ciało-podglądu")).toBeInTheDocument());
    expect(screen.getByTestId("ciało-podglądu")).toHaveTextContent("raport-roczny.pdf");
  });
});

describe("useDocumentViewer", () => {
  /** Minimalna lista plików - dokładnie tak używa hooka karta wpisu klubowego. */
  function Lista() {
    const { openFile, viewer } = useDocumentViewer();
    return (
      <div>
        <button type="button" onClick={() => openFile(FILE)}>
          Otwórz
        </button>
        {viewer}
      </div>
    );
  }

  it("na starcie popup jest zamknięty", () => {
    render(<Lista />);
    expect(screen.queryByTestId("file-viewer-dialog")).not.toBeInTheDocument();
  });

  it("otwarcie pliku pokazuje popup z tym plikiem", async () => {
    // Sedno hooka: kafelek pliku nie musi znać dialogu, a lista nie trzyma
    // czterech osobnych `useState`.
    render(<Lista />);
    fireEvent.click(screen.getByRole("button", { name: "Otwórz" }));
    expect(await screen.findByRole("heading", { name: "raport-roczny.pdf" })).toBeInTheDocument();
  });

  it("zamknięcie popupu czyści wybrany plik", async () => {
    render(<Lista />);
    fireEvent.click(screen.getByRole("button", { name: "Otwórz" }));
    await screen.findByRole("heading", { name: "raport-roczny.pdf" });

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "raport-roczny.pdf" })).not.toBeInTheDocument(),
    );
  });
});
