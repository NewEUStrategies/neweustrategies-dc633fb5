// PODGLĄD PRZYPISÓW NA DOKUMENCIE Z BLOKIEM SPOZA SCHEMATU.
//
// SKĄD TAKI DOKUMENT. `safeParseBlocks` świadomie NIE wygasza całego wpisu,
// gdy jeden blok nie przechodzi schematu (typ z nowszego wdrożenia po
// rollbacku, blok z obcym kluczem) - wyrzuca tylko ten blok. Panel liczy
// przypisy i ostrzeżenia na tym OCZYSZCZONYM dokumencie, ale zapis edycji
// musi iść do dokumentu REDAKTORA - inaczej zgubiłby obcy blok, który
// po ponownym wdrożeniu znów byłby poprawny.
//
// CO MA TU DOWÓD
//   * edycja i usunięcie przypisu trafiają w TEN blok, z którego przypis
//     pochodzi, mimo że oczyszczony dokument ma inne indeksy niż dokument
//     redaktora; obcy blok zostaje bajt w bajt,
//   * skok z listy przypisów i z ostrzeżenia prowadzi do wiersza bloku, którego
//     dotyczy, a nie do bloku stojącego pod tym samym indeksem w dokumencie
//     redaktora,
//   * dokument, którego ŻADEN blok nie przechodzi schematu, nie daje panelu.
//
// GRANICE: `scrollIntoView` (happy-dom nie przewija). Silnik przypisów,
// walidator i schemat są prawdziwe; słownik admina rejestrujemy jak układ
// `routes/admin.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { AutoFootnotesPreview } from "../AutoFootnotesPreview";
import "@/lib/i18n-admin-extras";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

/** Blok z typem, którego to wdrożenie nie zna - schemat go odrzuci. */
const OBCY = {
  id: "obcy",
  type: "blok-z-nowszego-wdrozenia",
  data: { html: "<p>Obcy[fn]Nota obca[/fn]</p>" },
};

function akapit(id: string, html: string): Block {
  return { id, type: "paragraph", data: { html } } as Block;
}

function dokument(): BlocksDoc {
  return {
    version: 1,
    blocks: [OBCY, akapit("p1", "<p>Traktat[fn]Nota B[/fn] wszedł w życie.</p>")],
  } as unknown as BlocksDoc;
}

function zamontuj(d: BlocksDoc) {
  const onChange = vi.fn<(next: BlocksDoc) => void>();
  const view = render(<AutoFootnotesPreview doc={d} onChange={onChange} />);
  return { ...view, onChange };
}

function htmle(d: BlocksDoc): string[] {
  return d.blocks.map((b) => String((b.data as Record<string, unknown>).html ?? ""));
}

const wiersze: HTMLElement[] = [];
function wierszKanwy(id: string) {
  const wiersz = document.createElement("div");
  wiersz.setAttribute("data-block-id", id);
  const scroll = vi.fn();
  wiersz.scrollIntoView = scroll;
  document.body.appendChild(wiersz);
  wiersze.push(wiersz);
  return scroll;
}

afterEach(() => {
  for (const w of wiersze.splice(0)) w.remove();
});

describe("AutoFootnotesPreview - zapis trafia w blok, z którego pochodzi przypis", () => {
  it("lista pokazuje wyłącznie przypisy bloków, które przeszły schemat", () => {
    zamontuj(dokument());
    expect(screen.getByText("Nota B")).toBeInTheDocument();
    expect(screen.queryByText("Nota obca")).toBeNull();
  });

  it("edycja przypisu zmienia TEN akapit, a obcy blok zostaje nietknięty", () => {
    const d = dokument();
    const { onChange } = zamontuj(d);
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 1 }) }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nota poprawiona" } });
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(htmle(next)).toEqual([
      "<p>Obcy[fn]Nota obca[/fn]</p>",
      "<p>Traktat[fn]Nota poprawiona[/fn] wszedł w życie.</p>",
    ]);
    // Obcy blok dalej jest w dokumencie redaktora - zapis go nie wyrzucił.
    expect(next.blocks[0]).toBe(d.blocks[0]);
  });

  it("usunięcie przypisu zdejmuje marker z TEGO akapitu, a nie z obcego bloku", () => {
    const { onChange } = zamontuj(dokument());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.removeLabel", { n: 1 }) }),
    );
    expect(htmle(onChange.mock.calls[0][0])).toEqual([
      "<p>Obcy[fn]Nota obca[/fn]</p>",
      "<p>Traktat wszedł w życie.</p>",
    ]);
  });
});

describe("AutoFootnotesPreview - skok prowadzi do bloku, którego dotyczy", () => {
  it("skok z listy przypisów przewija wiersz akapitu, nie obcego bloku", () => {
    const obcy = wierszKanwy("obcy");
    const p1 = wierszKanwy("p1");
    zamontuj(dokument());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.jumpAria", { n: 1 }) }),
    );
    expect(p1).toHaveBeenCalledTimes(1);
    expect(obcy).not.toHaveBeenCalled();
  });

  it("skok z ostrzeżenia walidatora przewija wiersz bloku z błędem", () => {
    const obcy = wierszKanwy("obcy");
    const p2 = wierszKanwy("p2");
    zamontuj({
      version: 1,
      blocks: [OBCY, akapit("p2", "<p>Traktat[fn]Nota bez zamknięcia</p>")],
    } as unknown as BlocksDoc);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("admin.autoFootnotes.blockLabel", { n: 1, type: "paragraph" }),
      }),
    );
    expect(p2).toHaveBeenCalledTimes(1);
    expect(obcy).not.toHaveBeenCalled();
  });
});

describe("AutoFootnotesPreview - dokument bez ani jednego poprawnego bloku", () => {
  it("nie daje panelu - ani pustej sekcji, ani fałszywych ostrzeżeń", () => {
    const { container } = zamontuj({ version: 1, blocks: [OBCY] } as unknown as BlocksDoc);
    expect(container).toBeEmptyDOMElement();
  });
});
