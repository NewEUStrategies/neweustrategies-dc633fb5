// Atomy i molekuła panelu „Wersje". Trzy najmniejsze pliki tej powierzchni
// stały na 0%, a każdy niesie warunek, który widzi wyłącznie użytkownik:
// który dokument jest AKTUALNIE opublikowany, którą wersję właśnie ogląda
// i czy ramka podglądu w ogóle ma nagłówek.
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewFrame } from "../atoms/PreviewFrame";
import { VersionStatusBadge } from "../atoms/VersionStatusBadge";
import { VersionRow } from "../molecules/VersionRow";

describe("VersionStatusBadge", () => {
  it("nazywa każdy status po polsku i po angielsku", () => {
    const cases = [
      ["published", "Opublikowana", "Published"],
      ["draft", "Szkic", "Draft"],
      ["archived", "Archiwum", "Archived"],
      ["baseline", "Wersja z kodu", "Code baseline"],
    ] as const;

    for (const [status, pl, en] of cases) {
      const { unmount } = render(<VersionStatusBadge status={status} lang="pl" />);
      expect(screen.getByText(pl), `PL dla ${status}`).toBeInTheDocument();
      unmount();

      const second = render(<VersionStatusBadge status={status} lang="en" />);
      expect(screen.getByText(en), `EN dla ${status}`).toBeInTheDocument();
      second.unmount();
    }
  });

  it("wyróżnia wersję OPUBLIKOWANĄ mocniejszym wariantem niż pozostałe", () => {
    // To jedyna wersja, którą widzi odwiedzający - lista prawnych dokumentów
    // musi ją odróżniać na pierwszy rzut oka od szkicu i archiwum.
    const published = render(<VersionStatusBadge status="published" lang="pl" />);
    const publishedClass = screen.getByText("Opublikowana").className;
    published.unmount();

    for (const status of ["draft", "archived", "baseline"] as const) {
      const other = render(<VersionStatusBadge status={status} lang="pl" />);
      const label = screen.getByText(/Szkic|Archiwum|Wersja z kodu/);
      expect(label.className, `${status} nie może wyglądać jak opublikowana`).not.toBe(
        publishedClass,
      );
      other.unmount();
    }
  });
});

describe("PreviewFrame", () => {
  it("bez etykiety nie renderuje pustego paska nagłówka", () => {
    const { container } = render(
      <PreviewFrame>
        <p>treść</p>
      </PreviewFrame>,
    );
    expect(screen.getByText("treść")).toBeInTheDocument();
    // Pasek nagłówka to jedyny element z tą klasą - bez etykiety nie powstaje
    // wcale, zamiast zostać pustą kreską nad podglądem.
    expect(container.querySelector(".uppercase")).toBeNull();
  });

  it("pokazuje etykietę, gdy została podana", () => {
    render(
      <PreviewFrame label="Podgląd wersji">
        <p>treść</p>
      </PreviewFrame>,
    );
    expect(screen.getByText("Podgląd wersji")).toBeInTheDocument();
  });

  it("respektuje wysokość z propsa zamiast rozpychać stronę", () => {
    // Panel cookies nadpisuje domyślne 620 na 420 - gdyby prop był ignorowany,
    // krótki banner dostałby ramkę wyższą niż jego własna treść.
    const { container } = render(
      <PreviewFrame height={420}>
        <p>treść</p>
      </PreviewFrame>,
    );
    const sized = container.querySelector('[style*="height"]') as HTMLElement | null;
    expect(sized?.style.height).toBe("420px");
  });

  it("domyślna wysokość to 620 px", () => {
    const { container } = render(
      <PreviewFrame>
        <p>treść</p>
      </PreviewFrame>,
    );
    const sized = container.querySelector('[style*="height"]') as HTMLElement | null;
    expect(sized?.style.height).toBe("620px");
  });
});

describe("VersionRow", () => {
  const base = { title: "Wersja 3", meta: "18 sie 2026, 10:00", active: false, onSelect: () => {} };

  it("pokazuje tytuł i metadane wersji", () => {
    render(
      <ul>
        <VersionRow {...base} />
      </ul>,
    );
    expect(screen.getByText("Wersja 3")).toBeInTheDocument();
    expect(screen.getByText("18 sie 2026, 10:00")).toBeInTheDocument();
  });

  it("kliknięcie wiersza zgłasza wybór DOKŁADNIE raz", () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <VersionRow {...base} onSelect={onSelect} />
      </ul>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Wersja 3/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("REGRESJA: wybraną wersję sygnalizuje `aria-current`, nie tylko tło", () => {
    // Podświetlenie klasą CSS jest niewidoczne dla czytnika ekranu - lista
    // wersji brzmiała jak zestaw identycznych przycisków bez wskazania,
    // którą użytkownik właśnie ogląda.
    const { rerender } = render(
      <ul>
        <VersionRow {...base} active />
      </ul>,
    );
    expect(screen.getByRole("button", { name: /Wersja 3/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    rerender(
      <ul>
        <VersionRow {...base} active={false} />
      </ul>,
    );
    expect(screen.getByRole("button", { name: /Wersja 3/ })).not.toHaveAttribute("aria-current");
  });

  it("renderuje sloty odznaki i akcji, gdy zostały podane", () => {
    render(
      <ul>
        <VersionRow
          {...base}
          badge={<span>opublikowana</span>}
          actions={<button type="button">Usuń</button>}
        />
      </ul>,
    );
    expect(screen.getByText("opublikowana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń" })).toBeInTheDocument();
  });

  it("bez akcji nie renderuje pustego kontenera akcji", () => {
    render(
      <ul>
        <VersionRow {...base} />
      </ul>,
    );
    // Jedyny przycisk to sam wiersz - żadnego pustego paska obok.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
