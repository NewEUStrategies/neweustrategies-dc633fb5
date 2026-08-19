// Atomy i molekuła sekcji „Wersje" (`VersionStatusBadge`, `PreviewFrame`,
// `VersionRow` — wszystkie na 0% przed tą zmianą).
//
// Ta sekcja pokazuje historię dokumentów prawnych, bannera zgód i elementów
// buildera. Dwie rzeczy są tu warte testu:
//
//   1. STATUS WERSJI MUSI BYĆ ODRÓŻNIALNY. Opublikowana wersja regulaminu jest
//      tą, którą widzi odwiedzający i którą wiąże prawnie; szkic nie. Pomyłka
//      przy publikacji dokumentu prawnego to nie jest usterka kosmetyczna.
//   2. WIERSZ WERSJI MUSI BYĆ KLIKALNY JAKO PRZYCISK, a jego akcje nie mogą
//      wywoływać wyboru. Zagnieżdżenie przycisku akcji w klikalnym obszarze
//      wiersza dawałoby publikację przy próbie samego podglądu.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

import { VersionStatusBadge } from "@/components/admin/versions/atoms/VersionStatusBadge";
import { PreviewFrame } from "@/components/admin/versions/atoms/PreviewFrame";
import { VersionRow } from "@/components/admin/versions/molecules/VersionRow";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// VersionStatusBadge
// ---------------------------------------------------------------------------

describe("VersionStatusBadge", () => {
  it("każdy status ma WŁASNĄ etykietę po polsku", () => {
    const expected: Record<string, string> = {
      published: "Opublikowana",
      draft: "Szkic",
      archived: "Archiwum",
      baseline: "Wersja z kodu",
    };
    for (const [status, label] of Object.entries(expected)) {
      render(<VersionStatusBadge status={status as "published"} lang="pl" />);
      expect(screen.getByText(label), status).toBeInTheDocument();
      cleanup();
    }
  });

  it("każdy status ma WŁASNĄ etykietę po angielsku", () => {
    const expected: Record<string, string> = {
      published: "Published",
      draft: "Draft",
      archived: "Archived",
      baseline: "Code baseline",
    };
    for (const [status, label] of Object.entries(expected)) {
      render(<VersionStatusBadge status={status as "published"} lang="en" />);
      expect(screen.getByText(label), status).toBeInTheDocument();
      cleanup();
    }
  });

  it("etykiety są RÓŻNE między statusami (żaden nie dubluje drugiego)", () => {
    // Dwie wersje regulaminu z identyczną plakietką byłyby nierozróżnialne,
    // a tylko jedna z nich wiąże prawnie odwiedzającego.
    const labels = new Set<string>();
    for (const status of ["published", "draft", "archived", "baseline"] as const) {
      const { container } = render(<VersionStatusBadge status={status} lang="pl" />);
      labels.add(container.textContent ?? "");
      cleanup();
    }
    expect(labels.size).toBe(4);
  });

  it("wersja opublikowana ma WYRÓŻNIONY wariant plakietki", () => {
    // Wizualna różnica jest tu treścią: to jedyna wersja widoczna publicznie.
    const { container: published } = render(<VersionStatusBadge status="published" lang="pl" />);
    const publishedClass = published.firstElementChild?.className ?? "";
    cleanup();

    const { container: draft } = render(<VersionStatusBadge status="draft" lang="pl" />);
    expect(draft.firstElementChild?.className).not.toBe(publishedClass);
  });
});

// ---------------------------------------------------------------------------
// PreviewFrame
// ---------------------------------------------------------------------------

describe("PreviewFrame", () => {
  it("renderuje treść podglądu", () => {
    render(
      <PreviewFrame>
        <p>Treść wersji</p>
      </PreviewFrame>,
    );
    expect(screen.getByText("Treść wersji")).toBeInTheDocument();
  });

  it("etykieta nagłówka pojawia się tylko wtedy, gdy jest podana", () => {
    render(
      <PreviewFrame label="Podgląd">
        <p>x</p>
      </PreviewFrame>,
    );
    expect(screen.getByText("Podgląd")).toBeInTheDocument();
    cleanup();

    const { container } = render(
      <PreviewFrame>
        <p>x</p>
      </PreviewFrame>,
    );
    // Bez etykiety nie renderuje pustego paska nagłówka. Asercja idzie po
    // ELEMENCIE, nie po `textContent`: ScrollArea Radiksa wstrzykuje własny
    // `<style>`, więc tekst kontenera niesie też reguły CSS.
    expect(container.querySelector("div.border-b")).toBeNull();
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("wysokość ramki jest sterowalna i ma sensowny domyślny rozmiar", () => {
    // Długie dokumenty prawne muszą się przewijać WEWNĄTRZ ramki, a nie
    // rozpychać strony panelu.
    const { container } = render(
      <PreviewFrame height={200}>
        <p>x</p>
      </PreviewFrame>,
    );
    expect(container.innerHTML).toContain("200px");
    cleanup();

    const { container: def } = render(
      <PreviewFrame>
        <p>x</p>
      </PreviewFrame>,
    );
    expect(def.innerHTML).toContain("620px");
  });
});

// ---------------------------------------------------------------------------
// VersionRow
// ---------------------------------------------------------------------------

describe("VersionRow", () => {
  it("tytuł i metadane są widoczne, a wybór jest przyciskiem", () => {
    const onSelect = vi.fn();
    render(
      <VersionRow title="Wersja 3" meta="18.08.2026, 10:00" active={false} onSelect={onSelect} />,
    );

    const button = screen.getByRole("button");
    expect(within(button).getByText("Wersja 3")).toBeInTheDocument();
    expect(within(button).getByText("18.08.2026, 10:00")).toBeInTheDocument();

    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("wiersz aktywny jest wizualnie odróżniony od nieaktywnego", () => {
    const { container: active } = render(
      <VersionRow title="A" meta="" active onSelect={vi.fn()} />,
    );
    const activeClass = active.querySelector("li")?.className ?? "";
    cleanup();

    const { container: idle } = render(
      <VersionRow title="A" meta="" active={false} onSelect={vi.fn()} />,
    );
    expect(idle.querySelector("li")?.className).not.toBe(activeClass);
  });

  it("plakietka statusu jedzie obok tytułu", () => {
    render(
      <VersionRow
        title="Wersja 3"
        meta=""
        active={false}
        onSelect={vi.fn()}
        badge={<span>Opublikowana</span>}
      />,
    );
    expect(screen.getByText("Opublikowana")).toBeInTheDocument();
  });

  it("akcje są POZA klikalnym obszarem wyboru", () => {
    // Zagnieżdżenie przycisku akcji w obszarze wyboru dawałoby publikację
    // dokumentu przy próbie samego podejrzenia wersji.
    const onSelect = vi.fn();
    const onAction = vi.fn();
    render(
      <VersionRow
        title="Wersja 3"
        meta=""
        active={false}
        onSelect={onSelect}
        actions={<button onClick={onAction}>Publikuj</button>}
      />,
    );

    fireEvent.click(screen.getByText("Publikuj"));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("bez akcji nie renderuje pustego kontenera akcji", () => {
    const { container } = render(
      <VersionRow title="A" meta="" active={false} onSelect={vi.fn()} />,
    );
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
