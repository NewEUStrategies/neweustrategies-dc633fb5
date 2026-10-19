// EDYTORY LINKÓW I KART: `buttons`, `social-icons`, `affiliate` - CO REDAKTOR
// WIDZI I CO ZAPISUJE.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// te trzy edytory nie miały ani jednego wykonania. Dwa pierwsze to repeatery
// linków czytane przez renderer czytnikiem `objList` (pozycje-nieobiekty są
// pomijane), trzeci to karta produktu z oznaczeniem „sponsorowane" - polem,
// którego zgodność panel ↔ strona ma znaczenie prawne (oznaczanie reklamy).
//
// CO MA TU DOWÓD
//  * każde pole zapisuje się pod WŁASNYM kluczem, w TEJ pozycji, z resztą
//    pól pozycji i `id`/`type` bloku bez zmian; render niczego nie zapisuje,
//  * pozycja `null` lub napis w liście NIE wywraca edytora (renderer ją
//    pomija), a obiekt w polu tekstowym nie wycieka jako „[object Object]”,
//  * listy wyboru z wartością spoza opcji pokazują to, czego użyje renderer
//    (wyrównanie „left”, rozmiar „md”, wariant „solid”, ikona zastępcza „rss”),
//    a lista platform obejmuje każdą ikonę, którą renderer umie narysować,
//  * kosze mają nazwę dostępną - czytnik ekranu nie trafia na „przycisk”,
//  * „sponsorowane” bez zapisanej wartości jest ZAZNACZONE, bo tak oznacza je
//    strona (`bool(…, true)`); ocena trzyma się zakresu pola 0-5.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów (import
// PIERWSZY). `AdminSelect` to natywny `<select>` i zostaje prawdziwy. i18n
// PRAWDZIWE (`realT`).
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { AffiliateBlock } from "../Affiliate";
import { ButtonsBlock } from "../Buttons";
import { SocialIconsBlock } from "../SocialIcons";

const t = realT("pl");
const ed = (group: string, key: string) => t(`blocks.editors.${group}.${key}`) as string;
const pole = (key: string) => t(`blocks.fields.${key}`) as string;
const USUN = ed("common", "remove");

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

/** Listy wyboru, wśród których opcji jest pozycja o podanym napisie. */
function listyZOpcja(tekst: string): HTMLSelectElement[] {
  return screen
    .getAllByRole<HTMLSelectElement>("combobox")
    .filter((s) => within(s).queryByRole("option", { name: tekst }));
}

// ---------------------------------------------------------------------------
// Grupa przycisków
// ---------------------------------------------------------------------------

describe("buttons", () => {
  const start = blok("buttons", {
    align: "center",
    items: [
      { label: "Raport", href: "/raport", variant: "default" },
      { label: "Kontakt", href: "/kontakt", variant: "outline", target: "_blank" },
    ],
  });

  it("pusty blok: wyrównanie „left”, brak pozycji; „Dodaj” dokłada przycisk-szablon", () => {
    const { changes } = renderEditor(ButtonsBlock, blok("buttons", {}));
    expect(listyZOpcja("center")[0].value).toBe("left");
    expect(screen.queryAllByPlaceholderText(pole("label"))).toHaveLength(0);
    expect(changes).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: ed("buttons", "add") }));
    // Etykieta powstaje w języku DOKUMENTU; bez `BlockEditorProvider` kontekst
    // edytora to dokument polski (krzyżówkę panel × dokument przypina
    // `blockEditorsPanelCopyI18n.test.tsx`).
    expect(ostatniZapis(changes).data).toEqual({
      items: [{ label: "Przycisk", href: "#", variant: "default" }],
    });
  });

  it("wyrównanie zapisuje się pod `align`; wartość spoza opcji pokazuje „left” jak renderer", () => {
    const { changes } = renderEditor(ButtonsBlock, start);
    const wyrownanie = listyZOpcja("center")[0];
    expect(wyrownanie.value).toBe("center");
    fireEvent.change(wyrownanie, { target: { value: "right" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, align: "right" });

    const inny = renderEditor(ButtonsBlock, blok("buttons", { align: "gdzieś-indziej" }));
    expect(within(inny.container).getByRole<HTMLSelectElement>("combobox").value).toBe("left");
  });

  it("etykieta, adres i wariant DRUGIEGO przycisku zapisują się tylko w nim, z resztą jego pól", () => {
    const { changes } = renderEditor(ButtonsBlock, start);
    const [pierwszy] = (start.data.items as Json[]).slice(0, 1);

    fireEvent.change(screen.getAllByPlaceholderText(pole("label"))[1], {
      target: { value: "Napisz do nas" },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      pierwszy,
      { label: "Napisz do nas", href: "/kontakt", variant: "outline", target: "_blank" },
    ]);

    fireEvent.change(screen.getAllByPlaceholderText(pole("urlPh"))[1], {
      target: { value: "/zespol" },
    });
    expect((ostatniZapis(changes).data.items as Json[])[1]).toEqual({
      label: "Kontakt",
      href: "/zespol",
      variant: "outline",
      target: "_blank",
    });

    fireEvent.change(listyZOpcja("ghost")[1], { target: { value: "ghost" } });
    expect((ostatniZapis(changes).data.items as Json[])[1]).toMatchObject({ variant: "ghost" });
  });

  it("kosz ma nazwę dostępną „Usuń” i zabiera TEN przycisk", () => {
    // NAPRAWIONE 2026-10-18: kosz był samą ikoną bez `aria-label` - czytnik
    // ekranu ogłaszał go jako bezimienny „przycisk”.
    const { changes } = renderEditor(ButtonsBlock, start);
    const kosze = screen.getAllByRole("button", { name: USUN });
    expect(kosze).toHaveLength(2);
    fireEvent.click(kosze[0]);
    expect(ostatniZapis(changes).data).toEqual({
      ...start.data,
      items: [(start.data.items as Json[])[1]],
    });
  });

  it("`null` i napis w liście nie wywracają edytora; obiekt i wariant spoza opcji nie wyciekają", () => {
    // NAPRAWIONE 2026-10-18: `items` rzutowane wprost na `Item[]` - `null.label`
    // rzucał `TypeError` i wywracał CAŁĄ kanwę. `renderButtons` (czytnik
    // `objList`) takie pozycje po prostu pomija; wariant spoza opcji rysuje
    // jako „solid” (default).
    const { container, changes } = renderEditor(
      ButtonsBlock,
      blok("buttons", {
        items: [null, "luźny napis", { label: { pl: "Raport" }, href: "/r", variant: "link" }],
      }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    const etykiety = screen.getAllByPlaceholderText<HTMLInputElement>(pole("label"));
    expect(etykiety.map((p) => p.value)).toEqual([""]);
    expect(listyZOpcja("ghost")[0].value).toBe("default");

    fireEvent.change(etykiety[0], { target: { value: "Raport" } });
    expect(ostatniZapis(changes).data.items).toEqual([
      { label: "Raport", href: "/r", variant: "link" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ikony społecznościowe
// ---------------------------------------------------------------------------

describe("social-icons", () => {
  const start = blok("social-icons", {
    size: "lg",
    align: "right",
    items: [
      { platform: "linkedin", url: "https://linkedin.com/company/nes" },
      { platform: "youtube", url: "https://youtube.com/@nes" },
    ],
  });

  it("„Dodaj” dokłada ikonę facebook z pustym URL-em; render niczego nie zapisuje", () => {
    const { changes } = renderEditor(SocialIconsBlock, blok("social-icons", {}));
    expect(changes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: ed("socialIcons", "add") }));
    expect(ostatniZapis(changes).data).toEqual({ items: [{ platform: "facebook", url: "" }] });
  });

  it("rozmiar i wyrównanie zapisują się pod własnymi kluczami; spoza opcji - „md” i „left”", () => {
    const { changes } = renderEditor(SocialIconsBlock, start);
    fireEvent.change(listyZOpcja("small")[0], { target: { value: "sm" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, size: "sm" });
    fireEvent.change(listyZOpcja("center")[0], { target: { value: "center" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, align: "center" });

    const inny = renderEditor(
      SocialIconsBlock,
      blok("social-icons", { size: { px: 9 }, align: "gdzieś" }),
    );
    const [rozmiar, wyrownanie] = within(inny.container).getAllByRole<HTMLSelectElement>(
      "combobox",
    );
    expect(rozmiar.value).toBe("md");
    expect(wyrownanie.value).toBe("left");
  });

  it("platforma i URL DRUGIEJ ikony zapisują się tylko w niej", () => {
    const { changes } = renderEditor(SocialIconsBlock, start);
    const [pierwsza] = start.data.items as Json[];
    fireEvent.change(listyZOpcja("github")[1], { target: { value: "github" } });
    expect(ostatniZapis(changes).data.items).toEqual([
      pierwsza,
      { platform: "github", url: "https://youtube.com/@nes" },
    ]);
    fireEvent.change(screen.getAllByPlaceholderText(pole("urlPh"))[1], {
      target: { value: "https://youtube.com/@nes-pl" },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      pierwsza,
      { platform: "youtube", url: "https://youtube.com/@nes-pl" },
    ]);
  });

  it("lista platform obejmuje każdą ikonę renderera - także spotify", () => {
    // NAPRAWIONE 2026-10-18: renderer ma ikonę Spotify, a lista w panelu jej
    // nie miała - podcastu nie dało się podpiąć z edytora.
    renderEditor(SocialIconsBlock, start);
    const platforma = listyZOpcja("github")[0];
    expect(Array.from(platforma.options).map((o) => o.value)).toEqual(
      expect.arrayContaining(["facebook", "x", "linkedin", "youtube", "spotify", "rss"]),
    );
  });

  it("platforma z importu pokazuje ikonę, którą narysuje renderer, a zapis jej nie zmienia", () => {
    // NAPRAWIONE 2026-10-18: „Twitter” (wielka litera, stary alias) i nieznane
    // „mastodon” nie miały opcji - natywna lista pokazywała pustkę. Renderer
    // rysuje dla nich odpowiednio ikonę X i zastępczą RSS.
    const { changes } = renderEditor(
      SocialIconsBlock,
      blok("social-icons", {
        items: [
          { platform: "Twitter", url: "https://x.com/nes" },
          { platform: "mastodon", url: "https://eupolicy.social/@nes" },
        ],
      }),
    );
    const platformy = listyZOpcja("github");
    expect(platformy.map((s) => s.value)).toEqual(["x", "rss"]);

    fireEvent.change(screen.getAllByPlaceholderText(pole("urlPh"))[1], {
      target: { value: "https://eupolicy.social/@nes-eu" },
    });
    expect((ostatniZapis(changes).data.items as Json[])[1]).toEqual({
      platform: "mastodon",
      url: "https://eupolicy.social/@nes-eu",
    });
  });

  it("kosz ma nazwę dostępną i zabiera TĘ ikonę; `null` w liście nie wywraca edytora", () => {
    // NAPRAWIONE 2026-10-18: jak w grupie przycisków - kosz bez nazwy, a
    // `null.platform` wywracał kanwę.
    const { changes } = renderEditor(
      SocialIconsBlock,
      blok("social-icons", { items: [null, ...(start.data.items as Json[])] }),
    );
    const kosze = screen.getAllByRole("button", { name: USUN });
    expect(kosze).toHaveLength(2);
    fireEvent.click(kosze[1]);
    expect(ostatniZapis(changes).data.items).toEqual([(start.data.items as Json[])[0]]);
  });
});

// ---------------------------------------------------------------------------
// Produkt afiliacyjny
// ---------------------------------------------------------------------------

describe("affiliate", () => {
  const start = blok("affiliate", {
    title: "Raport roczny",
    store: "Księgarnia",
    currency: "PLN",
    rating: 4,
    sponsored: true,
  });

  it.each([
    ["title", "title", "Raport 2026"],
    ["store", "store", "Empik"],
    ["imageUrl", "image", "https://cdn.example.com/okladka.jpg"],
    ["description", "description", "Analiza polityki energetycznej."],
    ["price", "price", "49,90"],
    ["currency", "currency", "EUR"],
    ["ctaLabel", "ctaLabel", "Kup teraz"],
    ["ctaHref", "ctaHref", "https://example.org/p?ref=nes"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (klucz, pole, wartosc) => {
    const { changes } = renderEditor(AffiliateBlock, start);
    fireEvent.change(screen.getByPlaceholderText(ed("affiliate", klucz)), {
      target: { value: wartosc },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "affiliate" });
    expect(zapis.data).toEqual({ ...start.data, [pole]: wartosc });
  });

  it("„sponsorowane” bez zapisanej wartości jest ZAZNACZONE - tak oznacza je strona", () => {
    // NAPRAWIONE 2026-10-18: `Boolean(undefined)` pokazywało pole odznaczone,
    // a `renderAffiliate` czyta `bool(…, true)` i dokłada etykietę
    // „Sponsorowane” oraz `rel="sponsored"`. Redaktor widział produkt jako
    // NIEsponsorowany, czytelnik - jako reklamę.
    const { changes } = renderEditor(AffiliateBlock, blok("affiliate", { title: "Produkt" }));
    const pole = screen.getByRole<HTMLInputElement>("checkbox", {
      name: ed("affiliate", "sponsored"),
    });
    expect(pole.checked).toBe(true);
    expect(changes).toEqual([]);
    fireEvent.click(pole);
    expect(ostatniZapis(changes).data).toEqual({ title: "Produkt", sponsored: false });

    const wylaczone = renderEditor(AffiliateBlock, blok("affiliate", { sponsored: false }));
    expect(within(wylaczone.container).getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  });

  it.each([
    [4.5, "4.5"],
    [9, "5"],
    [-2, "0"],
    ["pięć", "0"],
  ] as const)("ocena %j pokazuje się jako %s - w zakresie pola 0-5", (ocena, widac) => {
    // NAPRAWIONE 2026-10-18: pole pokazywało surową wartość (9 przy `max=5`).
    renderEditor(AffiliateBlock, blok("affiliate", { rating: ocena }));
    expect(screen.getByPlaceholderText<HTMLInputElement>(ed("affiliate", "rating")).value).toBe(
      widac,
    );
  });

  it.each([
    ["3.5", 3.5],
    ["7", 5],
    ["", 0],
  ])("wpis oceny „%s” zapisuje się jako LICZBA %s", (wpis, zapisane) => {
    const { changes } = renderEditor(AffiliateBlock, blok("affiliate", { rating: 1 }));
    fireEvent.change(screen.getByPlaceholderText(ed("affiliate", "rating")), {
      target: { value: wpis },
    });
    expect(ostatniZapis(changes).data).toEqual({ rating: zapisane });
  });

  it("obiekt w polu tekstowym nie wycieka jako „[object Object]”", () => {
    // NAPRAWIONE 2026-10-18: `String({ pl: … })` lądowało w polu tytułu;
    // `renderAffiliate` czyta pola czytnikiem `str` - obiekt to pusty napis.
    const { container } = renderEditor(
      AffiliateBlock,
      blok("affiliate", { title: { pl: "Raport" }, price: 49, store: null }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    for (const klucz of ["title", "price", "store"]) {
      expect(screen.getByPlaceholderText<HTMLInputElement>(ed("affiliate", klucz)).value).toBe("");
    }
  });
});
