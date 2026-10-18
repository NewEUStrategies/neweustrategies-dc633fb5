// PODGLĄD PRZYPISÓW - SKOK Z OSTRZEŻENIA DO BLOKU I CHWILOWE PODŚWIETLENIE.
//
// Plik `autoFootnotesPreview.test.tsx` obok dowodzi edycji przypisów i skoku
// z POZYCJI listy przypisów. Tu zostaje to, czego tamten nie dotyka:
//   * przycisk przy OSTRZEŻENIU walidatora (niezamknięty `[fn]`) prowadzi
//     do wiersza bloku NAJWYŻSZEGO poziomu, także gdy błąd siedzi
//     w dziecku kontenera - to jedyny poziom z `data-block-id` w kanwie,
//   * podświetlenie wiersza jest CHWILOWE: po 1,4 s wiersz wraca do wyglądu
//     sprzed skoku, z własnymi klasami nietkniętymi (kanwa nie zostaje
//     z obwódką na stałe, a wiersz nie gubi własnego stylu).
//
// GRANICE: `scrollIntoView` (happy-dom nie przewija) i zegar - fałszywe
// timery, bo podświetlenie gaśnie po `setTimeout`. Silnik przypisów
// i walidator są prawdziwe; słownik admina rejestrujemy tak jak układ
// `routes/admin.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { withChildBlocks } from "@/lib/blocks/nested";
import { AutoFootnotesPreview } from "../AutoFootnotesPreview";
import "@/lib/i18n-admin-extras";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

function akapit(id: string, html: string): Block {
  return { id, type: "paragraph", data: { html } } as Block;
}

function doc(blocks: Block[]): BlocksDoc {
  return { version: 1, blocks } as BlocksDoc;
}

/** Wiersz kanwy tak, jak renderuje go `SortableBlockItem` (z własnymi klasami). */
function wierszKanwy(id: string) {
  const wiersz = document.createElement("div");
  wiersz.setAttribute("data-block-id", id);
  wiersz.className = "group relative pl-8 pr-3 pt-2 pb-2 scroll-mt-24 rounded-sm";
  const scroll = vi.fn();
  wiersz.scrollIntoView = scroll;
  document.body.appendChild(wiersz);
  return { wiersz, scroll };
}

let sprzatanie: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  sprzatanie = [];
});

afterEach(() => {
  for (const f of sprzatanie) f();
  vi.useRealTimers();
});

describe("AutoFootnotesPreview - skok z ostrzeżenia walidatora", () => {
  it("przycisk ostrzeżenia przewija do wiersza bloku najwyższego poziomu", () => {
    const kontener = withChildBlocks({ id: "g1", type: "group", data: {} } as Block, "children", [
      akapit("c1", "<p>W środku[fn]Nota bez zamknięcia</p>"),
    ]);
    const { wiersz, scroll } = wierszKanwy("g1");
    sprzatanie.push(() => wiersz.remove());

    render(<AutoFootnotesPreview doc={doc([akapit("p0", "<p>Wstęp.</p>"), kontener])} />);
    const ostrzezenie = screen.getByRole("alert");
    // Etykieta liczy bloki od jedynki i nazywa typ bloku najwyższego poziomu.
    fireEvent.click(
      screen.getByRole("button", {
        name: t("admin.autoFootnotes.blockLabel", { n: 2, type: "group" }),
      }),
    );
    expect(ostrzezenie).toBeInTheDocument();
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });
});

describe("AutoFootnotesPreview - podświetlenie po skoku jest chwilowe", () => {
  it("po 1,4 s wiersz wraca DOKŁADNIE do wyglądu sprzed skoku", () => {
    const { wiersz } = wierszKanwy("p1");
    sprzatanie.push(() => wiersz.remove());
    const przed = wiersz.className;

    render(<AutoFootnotesPreview doc={doc([akapit("p1", "<p>Traktat[fn]Nota[/fn].</p>")])} />);
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.jumpAria", { n: 1 }) }),
    );
    expect(wiersz.className).not.toBe(przed);

    act(() => vi.advanceTimersByTime(1399));
    expect(wiersz.className).not.toBe(przed);

    act(() => vi.advanceTimersByTime(1));
    expect(wiersz.className).toBe(przed);
  });
});
