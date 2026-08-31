// PODGLAD PRZYPISOW ZRODLOWYCH - edytowalny panel pod kanwa bloków.
//
// DLACZEGO TO JEST POWIERZCHNIA RYZYKOWNA DLA TRESCI
// Panel edytuje przypisy NIE u siebie, a w oryginalnej tresci bloku: zapis
// idzie przez `updateFootnoteAtOrigin(doc, origin, draft)`, gdzie `origin`
// wskazuje N-TE wystapienie `[fn]…[/fn]` w KONKRETNYM polu bloku. Dwie rzeczy
// moga tu cicho zniszczyc prace autora:
//   1. przeciek edycji na inny przypis o IDENTYCZNEJ tresci (adresowanie po
//      tresci zamiast po `occurrence`),
//   2. usuniecie markera przez zapis pustej tresci, gdy autor tylko anulowal.
// Oba przypadki maja tu asercje.
//
// CO MA TU JESZCZE DOWOD
//   * panel MILCZY (nie renderuje niczego), gdy nie ma ani przypisow, ani
//     ostrzezen - inaczej pod kazdym wpisem wisialaby pusta sekcja,
//   * przypisy sa numerowane w KOLEJNOSCI DOKUMENTOWEJ, takze te z wnetrza
//     kontenerow (`columns`/`group`),
//   * ostrzezenia walidatora (niezamkniety `[fn]`, pusty marker) trafiaja do
//     `role="alert"` z przyciskiem skoku do bloku,
//   * skok do bloku dziala po `data-block-id` bloku NAJWYZSZEGO poziomu -
//     takze dla przypisu zagniezdzonego (bo tylko top-level ma ten atrybut),
//   * bez `onChange` panel jest TYLKO do czytania: nie ma przyciskow edycji
//     ani usuwania, wiec podglad w trybie odczytu nie udaje edytowalnego,
//   * Ctrl/Cmd+Enter zapisuje, Escape anuluje - skroty opisane w UI musza dzialac.
//
// CZEGO TU NIE MA
//   * asercji na algorytm numerowania i walidacji - to domena
//     `lib/blocks/footnoteOrigins` i `lib/blocks/footnoteValidation`, ktore maja
//     wlasne testy. Tutaj przedmiotem dowodu jest PANEL i jego uzycie tych
//     funkcji,
//   * ani jednego `vi.mock`. Panel dostaje prawdziwy silnik przypisow,
//     prawdziwy walidator i prawdziwy renderer HTML przypisu.
//
// I18N - GRANICA ADMINA. Napisy panelu maja dwa zrodla: `blocksUi.*` z
// `@/lib/i18n-public` (importuje je sam komponent) i `admin.autoFootnotes.*`
// z `@/lib/i18n-admin-extras`, rejestrowanego przez uklad `routes/admin.tsx`.
// Ten podzial jest CELOWY - slownik edytora nie ma wchodzic do chunku
// czytelnika - i dlatego test importuje nakladke admina jawnie, tak jak robi
// to uklad. Bez tego importu `t()` zwraca surowe klucze i asercje na napisy
// bylyby bezwartosciowe.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
// Kontener z dziecmi budujemy PRODUKCYJNYM helperem (`withChildBlocks`), a nie
// literalem z rzutowaniem: to on ustala kształt `data.children` czytany przez
// silnik przypisow i publiczny renderer.
import { withChildBlocks } from "@/lib/blocks/nested";
import { AutoFootnotesPreview } from "../AutoFootnotesPreview";
// Slownik `admin.autoFootnotes.*` zyje ZA GRANICA PANELU: rejestruje go
// `src/routes/admin.tsx` (uklad admina), a nie sam komponent - dzieki temu
// napisy edytora NIE wchodza do publicznego chunku czytelnika. Test musi wiec
// zrobic to samo, co uklad admina, inaczej `t()` zwracalby surowe klucze.
// Sam komponent importuje tylko `@/lib/i18n-public` (klucz `blocksUi.*`).
import "@/lib/i18n-admin-extras";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

function akapit(id: string, html: string): Block {
  return { id, type: "paragraph", data: { html } } as Block;
}

function doc(blocks: Block[]): BlocksDoc {
  return { version: 1, blocks } as BlocksDoc;
}

function zamontuj(d: BlocksDoc | null | undefined, edytowalny = true) {
  const onChange = vi.fn<(next: BlocksDoc) => void>();
  const view = render(
    <AutoFootnotesPreview doc={d} onChange={edytowalny ? onChange : undefined} />,
  );
  return { onChange, view };
}

/** Tekst HTML wszystkich bloków dokumentu - do asercji „gdzie wylądował zapis". */
function tresci(d: BlocksDoc): string[] {
  return d.blocks.map((b) => String(b.data.html ?? ""));
}

describe("AutoFootnotesPreview - kiedy panel sie pokazuje", () => {
  it("dokument bez przypisów i bez ostrzeżeń nie renderuje NICZEGO", () => {
    const { view } = zamontuj(doc([akapit("p1", "<p>Bez przypisów.</p>")]));
    expect(view.container).toBeEmptyDOMElement();
  });

  it("brak dokumentu nie renderuje niczego", () => {
    const { view } = zamontuj(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("pusta lista bloków nie renderuje niczego", () => {
    const { view } = zamontuj(doc([]));
    expect(view.container).toBeEmptyDOMElement();
  });

  it("jeden przypis pokazuje sekcję z tytułem, plakietką i licznikiem", () => {
    zamontuj(doc([akapit("p1", "<p>Traktat[fn]Dz.U. 2026 poz. 1[/fn] wszedł w życie.</p>")]));
    expect(screen.getByRole("region", { name: t("blocksUi.footnotesTitle") })).toBeInTheDocument();
    expect(screen.getByText(t("admin.autoFootnotes.badge"))).toBeInTheDocument();
    expect(screen.getByText(t("admin.autoFootnotes.count", { count: 1 }))).toBeInTheDocument();
  });
});

describe("AutoFootnotesPreview - numeracja i zasieg", () => {
  it("numeruje przypisy w KOLEJNOŚCI DOKUMENTOWEJ, nie w kolejności dodania", () => {
    zamontuj(
      doc([
        akapit("p1", "<p>Pierwszy[fn]Nota A[/fn].</p>"),
        akapit("p2", "<p>Drugi[fn]Nota B[/fn] i trzeci[fn]Nota C[/fn].</p>"),
      ]),
    );
    const pozycje = screen.getAllByRole("listitem");
    expect(pozycje).toHaveLength(3);
    expect(pozycje[0].textContent).toContain("Nota A");
    expect(pozycje[1].textContent).toContain("Nota B");
    expect(pozycje[2].textContent).toContain("Nota C");
  });

  it("widzi przypisy WEWNĄTRZ kontenera (group), nie tylko na najwyższym poziomie", () => {
    const kontener = withChildBlocks({ id: "g1", type: "group", data: {} } as Block, "children", [
      akapit("c1", "<p>W kontenerze[fn]Nota zagnieżdżona[/fn].</p>"),
    ]);
    zamontuj(doc([kontener]));
    expect(screen.getByText(/Nota zagnieżdżona/)).toBeInTheDocument();
  });

  it("pomija markery PUSTE w liście przypisów (silnik je dropuje)", () => {
    zamontuj(doc([akapit("p1", "<p>Tekst[fn][/fn] dalej[fn]Realna nota[/fn].</p>")]));
    const pozycje = screen.getAllByRole("listitem");
    // Pusty marker nie jest przypisem - ale JEST ostrzeżeniem (niżej).
    expect(pozycje.filter((li) => li.textContent?.includes("Realna nota"))).toHaveLength(1);
  });
});

describe("AutoFootnotesPreview - edycja przypisu w tresci bloku", () => {
  const zPrzypisem = () =>
    doc([akapit("p1", "<p>Traktat[fn]Dz.U. 2026 poz. 1[/fn] wszedł w życie.</p>")]);

  it("przycisk edycji pokazuje pole z BIEŻĄCĄ treścią przypisu", () => {
    zamontuj(zPrzypisem());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 1 }) }),
    );
    expect(screen.getByRole("textbox")).toHaveValue("Dz.U. 2026 poz. 1");
  });

  it("zapis podmienia WNĘTRZE markera w treści bloku i nie rusza reszty akapitu", () => {
    const { onChange } = zamontuj(zPrzypisem());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 1 }) }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Dz.U. 2026 poz. 2" } });
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tresci(onChange.mock.calls[0][0])[0]).toBe(
      "<p>Traktat[fn]Dz.U. 2026 poz. 2[/fn] wszedł w życie.</p>",
    );
  });

  it("Ctrl+Enter w polu edycji zapisuje", () => {
    const { onChange } = zamontuj(zPrzypisem());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 1 }) }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nowa nota" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(tresci(onChange.mock.calls[0][0])[0]).toContain("[fn]Nowa nota[/fn]");
  });

  it("Escape w polu edycji ANULUJE i nie zapisuje niczego", () => {
    const { onChange } = zamontuj(zPrzypisem());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 1 }) }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Zmiana do wyrzucenia" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("przycisk anulowania zamyka edycję bez zapisu", () => {
    const { onChange } = zamontuj(zPrzypisem());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 1 }) }),
    );
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("usunięcie przypisu zdejmuje marker z treści, zostawiając zdanie", () => {
    const { onChange } = zamontuj(zPrzypisem());
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.removeLabel", { n: 1 }) }),
    );
    const wynik = tresci(onChange.mock.calls[0][0])[0];
    expect(wynik).not.toContain("[fn]");
    expect(wynik).toContain("Traktat");
    expect(wynik).toContain("wszedł w życie");
  });

  it("edycja DRUGIEGO przypisu o IDENTYCZNEJ treści nie przecieka na pierwszy", () => {
    // Adresowanie po `occurrence`, nie po treści - to jest cały sens `origin`.
    const { onChange } = zamontuj(
      doc([akapit("p1", "<p>A[fn]Ta sama nota[/fn] i B[fn]Ta sama nota[/fn].</p>")]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.editLabel", { n: 2 }) }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Zmieniona druga" } });
    fireEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(tresci(onChange.mock.calls[0][0])[0]).toBe(
      "<p>A[fn]Ta sama nota[/fn] i B[fn]Zmieniona druga[/fn].</p>",
    );
  });

  it("bez onChange panel jest TYLKO do czytania", () => {
    zamontuj(zPrzypisem(), false);
    expect(screen.queryByRole("button", { name: t("common.edit") })).toBeNull();
    expect(
      screen.queryByRole("button", { name: t("admin.autoFootnotes.removeLabel", { n: 1 }) }),
    ).toBeNull();
    expect(screen.queryByText(t("admin.autoFootnotes.editableHint"))).toBeNull();
    // Treść przypisu nadal widoczna - to jest podgląd, nie pustka.
    expect(screen.getByText(/Dz\.U\. 2026 poz\. 1/)).toBeInTheDocument();
  });
});

describe("AutoFootnotesPreview - ostrzezenia walidatora", () => {
  it("niezamknięty marker daje komunikat w roli alert", () => {
    zamontuj(doc([akapit("p1", "<p>Traktat[fn]Nota bez zamknięcia</p>")]));
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain(t("admin.autoFootnotes.warningsTitle", { count: 1 }));
  });

  it("ostrzeżenie ma przycisk skoku do bloku z ludzką etykietą", () => {
    zamontuj(doc([akapit("p1", "<p>Traktat[fn]Nota bez zamknięcia</p>")]));
    const skok = screen.getByRole("button", {
      name: t("admin.autoFootnotes.blockLabel", { n: 1, type: "paragraph" }),
    });
    expect(skok).toBeInTheDocument();
  });

  it("skok do bloku przewija i podświetla blok NAJWYŻSZEGO poziomu", () => {
    // `data-block-id` nosi tylko wiersz top-level (`SortableBlockItem`), więc
    // panel musi trafić w niego, a nie w blok zagnieżdżony.
    const kontener = withChildBlocks({ id: "g1", type: "group", data: {} } as Block, "children", [
      akapit("c1", "<p>W środku[fn]Nota[/fn].</p>"),
    ]);
    const wiersz = document.createElement("div");
    wiersz.setAttribute("data-block-id", "g1");
    const scroll = vi.fn();
    wiersz.scrollIntoView = scroll;
    document.body.appendChild(wiersz);

    zamontuj(doc([kontener]));
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.jumpAria", { n: 1 }) }),
    );
    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(wiersz.className).toContain("ring-2");
    wiersz.remove();
  });

  it("skok bez odpowiadającego wiersza w DOM nie wysadza panelu", () => {
    zamontuj(doc([akapit("p1", "<p>Traktat[fn]Nota[/fn].</p>")]));
    // Brak elementu `[data-block-id="p1"]` - klik musi być bezpieczny.
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.autoFootnotes.jumpAria", { n: 1 }) }),
    );
    expect(screen.getByRole("region", { name: t("blocksUi.footnotesTitle") })).toBeInTheDocument();
  });

  it("pusty marker jest ostrzeżeniem, choć nie jest przypisem", () => {
    zamontuj(doc([akapit("p1", "<p>Tekst[fn][/fn] dalej.</p>")]));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // Sama lista przypisów w takim dokumencie jest pusta.
    expect(
      screen.queryAllByRole("listitem").filter((li) => li.id.startsWith("fn-preview-")),
    ).toHaveLength(0);
  });
});

describe("AutoFootnotesPreview - i18n PL/EN", () => {
  it("wszystkie napisy panelu istnieją w OBU językach", () => {
    const pl = realT("pl");
    const en = realT("en");
    const klucze = [
      "blocksUi.footnotesTitle",
      "admin.autoFootnotes.badge",
      "admin.autoFootnotes.hint",
      "admin.autoFootnotes.editableHint",
      "admin.autoFootnotes.jumpHint",
      "admin.autoFootnotes.jumpToBlock",
      "admin.autoFootnotes.hotkey",
      "common.save",
      "common.cancel",
      "common.edit",
      "common.delete",
    ];
    for (const klucz of klucze) {
      expect(pl(klucz)).not.toBe(klucz);
      expect(en(klucz)).not.toBe(klucz);
    }
    expect(klucze.filter((k) => pl(k) !== en(k)).length).toBeGreaterThan(klucze.length / 2);
  });
});
