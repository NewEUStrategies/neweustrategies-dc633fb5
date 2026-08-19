// Kafel podglądu i komunikat pustego folderu. Do 18.08.2026 oba na zerze.
//
// `MediaThumbnail` niesie jedną, niewidoczną w danych regułę: RENDEROWANY jest
// wyłącznie obraz, który przeglądarka naprawdę wyświetli. Reszta - PDF, wideo,
// audio, a także animowany GIF - dostaje ikonę typu. GIF jest tu świadomym
// wyjątkiem: siatka stu animacji odtwarzanych naraz zabija panel.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/lib/i18n-admin-media";
import { MediaThumbnail } from "../MediaThumbnail";
import { MediaEmptyState } from "../MediaEmptyState";
import type { MediaRow } from "../../types";

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
    folder_path: "/",
    alt_text: null,
    ...overrides,
  };
}

describe("MediaThumbnail - obrazy", () => {
  it("renderuje bitmapę dla prawdziwego obrazu", () => {
    render(<MediaThumbnail file={file()} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/a.png");
  });

  it("używa opisu alternatywnego, a bez niego nazwy pliku", () => {
    const { unmount } = render(<MediaThumbnail file={file({ alt_text: "Wykres" })} />);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Wykres");
    unmount();

    render(<MediaThumbnail file={file({ alt_text: null })} />);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "okladka.png");
  });

  it("miniatura jest ładowana LENIWIE", () => {
    // Folder z setką zdjęć pobierałby setkę plików naraz przy wejściu.
    render(<MediaThumbnail file={file()} />);
    expect(screen.getByRole("img")).toHaveAttribute("loading", "lazy");
  });

  it("miniatura NIE jest przeciągalna sama z siebie", () => {
    // Przeciąganie obsługuje kafel nadrzędny (ładunek z identyfikatorami);
    // natywne przeciąganie obrazka podmieniłoby ładunek na adres URL.
    render(<MediaThumbnail file={file()} />);
    expect(screen.getByRole("img")).toHaveAttribute("draggable", "false");
  });
});

describe("MediaThumbnail - pliki nierenderowalne", () => {
  it.each([
    ["application/pdf", "raport.pdf", "PDF"],
    ["video/mp4", "klip.mp4", "MP4"],
    ["audio/mpeg", "odcinek.mp3", "MP3"],
  ])("dla %s pokazuje ikonę typu i rozszerzenie", (mime, filename, label) => {
    render(<MediaThumbnail file={file({ mime_type: mime, filename })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("animowany GIF świadomie NIE jest odtwarzany w siatce", () => {
    // Sto animacji naraz to zamrożony panel; ikona plus etykieta mówią, co to
    // za plik, bez kosztu dekodowania.
    render(<MediaThumbnail file={file({ mime_type: "image/gif", filename: "animacja.gif" })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("GIF")).toBeInTheDocument();
  });

  it("plik BEZ typu jest traktowany jako nierenderowalny", () => {
    render(<MediaThumbnail file={file({ mime_type: null, filename: "dane.bin" })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("BIN")).toBeInTheDocument();
  });
});

describe("MediaThumbnail - nakładka", () => {
  it("renderuje przekazaną nakładkę nad kafelkiem obrazu", () => {
    render(<MediaThumbnail file={file()} overlay={<span data-testid="znacznik" />} />);
    expect(screen.getByTestId("znacznik")).toBeInTheDocument();
  });

  it("renderuje nakładkę także nad ikoną typu", () => {
    // Zaznaczenie musi być widoczne również na plikach nieobrazowych.
    render(
      <MediaThumbnail
        file={file({ mime_type: "application/pdf", filename: "a.pdf" })}
        overlay={<span data-testid="znacznik" />}
      />,
    );
    expect(screen.getByTestId("znacznik")).toBeInTheDocument();
  });

  it("bez nakładki nie renderuje pustego węzła", () => {
    const { container } = render(<MediaThumbnail file={file()} />);
    expect(container.querySelector("[data-testid]")).toBeNull();
  });

  it("przyjmuje dodatkowe klasy od wywołującego", () => {
    const { container } = render(<MediaThumbnail file={file()} className="rounded-t-md" />);
    expect(container.firstElementChild?.className).toContain("rounded-t-md");
  });
});

describe("MediaEmptyState", () => {
  it("zachęca do przeciągnięcia plików zamiast pokazywać pustkę", () => {
    // Pusty obszar bez komunikatu wygląda jak błąd ładowania.
    render(<MediaEmptyState />);
    expect(screen.getByText(/Przeciągnij|Drop/i)).toBeInTheDocument();
  });

  it("niesie ikonę wgrywania jako wskazówkę wizualną", () => {
    const { container } = render(<MediaEmptyState />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
