// SESJA EDYCJI PRZYPISU W PANELU `AutoFootnotesPreview` - co dzieje się
// z otwartym polem edycji, gdy redaktor naciska klawisze albo zmienia listę.
//
// PO CO OSOBNY PLIK. `autoFootnotesPreview.test.tsx` dowodzi pojedynczych
// akcji na NIERUCHOMYM dokumencie (atrapa `onChange`, panel nie dostaje
// nowego dokumentu). Tu panel siedzi w STEROWANYM rodzicu - tak jak w
// edytorze wpisu, gdzie każdy zapis wraca do panelu jako nowy `doc` - bo
// dopiero wtedy widać, że numery przypisów (`id`) przesuwają się po usunięciu.
//
// CO MA TU DOWÓD
//   * zwykły Enter w polu edycji NIE zapisuje (przypis może mieć kilka
//     linii), a Cmd+Enter (Mac) zapisuje tak samo jak Ctrl+Enter,
//   * usunięcie INNEGO przypisu w trakcie edycji zamyka edycję, zamiast
//     przenieść szkic na sąsiedni przypis (defekt naprawiony niżej).
//
// GRANICE. Bez atrap: prawdziwy silnik przypisów, walidator i renderer HTML
// przypisu. Słownik admina rejestrujemy tak jak układ `routes/admin.tsx`.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { AutoFootnotesPreview } from "../AutoFootnotesPreview";
import "@/lib/i18n-admin-extras";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

function dokument(html: string): BlocksDoc {
  return {
    version: 1,
    blocks: [{ id: "p1", type: "paragraph", data: { html } } as Block],
  } as BlocksDoc;
}

/** Panel w sterowanym rodzicu: każdy zapis wraca do panelu jako nowy dokument. */
function zamontujSterowany(start: BlocksDoc) {
  const zapisy: BlocksDoc[] = [];
  function Rodzic() {
    const [doc, setDoc] = useState(start);
    return (
      <AutoFootnotesPreview
        doc={doc}
        onChange={(next) => {
          zapisy.push(next);
          setDoc(next);
        }}
      />
    );
  }
  render(<Rodzic />);
  return zapisy;
}

function html(doc: BlocksDoc | undefined): string {
  return String(doc?.blocks[0]?.data.html ?? "");
}

const edytuj = (n: number) =>
  fireEvent.click(screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n }) }));
const usun = (n: number) =>
  fireEvent.click(
    screen.getByRole("button", { name: t("admin.autoFootnotes.removeLabel", { n }) }),
  );

describe("AutoFootnotesPreview - klawisze w polu edycji", () => {
  it("zwykły Enter NIE zapisuje: pole zostaje otwarte ze szkicem", () => {
    const onChange = vi.fn<(next: BlocksDoc) => void>();
    render(<AutoFootnotesPreview doc={dokument("<p>A[fn]Nota[/fn]</p>")} onChange={onChange} />);
    edytuj(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Linia 1" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Linia 1");
  });

  it("Cmd+Enter (Mac) zapisuje tak samo jak Ctrl+Enter i zamyka pole", () => {
    const zapisy = zamontujSterowany(dokument("<p>A[fn]Nota[/fn] koniec.</p>"));
    edytuj(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nota poprawiona" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
    expect(zapisy).toHaveLength(1);
    expect(html(zapisy[0])).toBe("<p>A[fn]Nota poprawiona[/fn] koniec.</p>");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("AutoFootnotesPreview - usunięcie przypisu w trakcie edycji innego", () => {
  // NAPRAWIONE 2026-10-18: panel pamiętał edytowany przypis po NUMERZE (`id`),
  // a numer to pozycja w dokumencie. Usunięcie przypisu nr 1 w trakcie edycji
  // nr 2 przenumerowywało listę (dawny nr 3 stawał się nr 2), więc otwarte
  // pole ze szkicem DRUGIEJ noty stało teraz przy TRZECIEJ, a „Zapisz" wpisywało
  // szkic w cudzy przypis - po cichu nadpisując jego treść.
  // KONTRAKT: każde usunięcie zamyka otwartą edycję; dokument po usunięciu
  // ma pozostałe przypisy bajt w bajt, a szkic nie trafia nigdzie.
  it("szkic nie przechodzi na sąsiedni przypis po przenumerowaniu listy", () => {
    const zapisy = zamontujSterowany(
      dokument("<p>A[fn]Pierwsza[/fn] B[fn]Druga[/fn] C[fn]Trzecia[/fn].</p>"),
    );
    edytuj(2);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Szkic drugiej" } });
    usun(1);

    expect(zapisy).toHaveLength(1);
    expect(html(zapisy[0])).toBe("<p>A B[fn]Druga[/fn] C[fn]Trzecia[/fn].</p>");
    // Pole edycji jest zamknięte - nie ma czym zapisać szkicu w cudzy przypis.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
