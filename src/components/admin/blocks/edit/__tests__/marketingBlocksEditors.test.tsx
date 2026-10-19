// EDYTORY SEKCJI MARKETINGOWYCH (`hero`, `cta-section`, `image-carousel`,
// `contact-form`, `map`) - CO REDAKTOR WIDZI I CO ZAPISUJE.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// `MarketingBlocks.tsx` nie miał ani jednego wykonania w testach. Redaktor
// ustawia te sekcje na podstawie tego, co pokazuje edytor, więc kontrakt jest
// dwustronny: zapis trafia pod WŁAŚCIWY klucz, a odczyt pokazuje to, co
// narysuje renderer publiczny (`components/blocks/renderer/molecules.tsx`).
//
// CO MA TU DOWÓD
//  * każde pole zapisuje się pod WŁASNYM kluczem, z resztą danych i `id`/
//    `type` bloku bez zmian; liczby i przełączniki zapisują się jako LICZBY
//    i WARTOŚCI LOGICZNE, nie napisy; sam render niczego nie zapisuje,
//  * lista wyboru z wartością spoza opcji pokazuje to, czego UŻYJE renderer
//    (`hero`: wyrównanie „center", wysokość „md"), a nie pierwszą opcję,
//  * nakładka hero pokazuje w podpisie wartość docięta do 0-90 jak strona,
//    a nie „NaN%"/„150%" przy suwaku na 90,
//  * pola liczbowe czytają dane czytnikiem renderera (`num`): śmieć w danych
//    to wartość domyślna strony, a nie puste pole; powiększenie i wysokość
//    mapy są docinane do GÓRNEJ granicy pola, tak jak docina je `MapView`,
//  * repeater slajdów karuzeli: edycja, dopisanie i usunięcie trafiają w TEN
//    slajd, a pole interwału istnieje tylko przy włączonym autoodtwarzaniu
//    i trzyma się zakresu widoku (1500-20000 ms) - wpis spoza niego nie
//    trafia do zapisu, a samo przejście przez pole niczego nie zapisuje.
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli edytorów (import
// PIERWSZY). `AdminSelect` to natywny `<select>` i zostaje prawdziwy. i18n
// PRAWDZIWE (`realT`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import {
  ContactFormBlock,
  CtaSectionBlock,
  HeroBlock,
  ImageCarouselBlock,
  MapBlock,
} from "../MarketingBlocks";

const t = realT("pl");
const mb = (key: string) => t(`blocks.editors.marketingBlocks.${key}`) as string;
const pole = (key: string) => t(`blocks.fields.${key}`) as string;

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

/** Lista wyboru, wśród której opcji jest pozycja o podanym napisie. */
function listaZOpcja(tekst: string): HTMLSelectElement {
  const lista = screen
    .getAllByRole<HTMLSelectElement>("combobox")
    .find((s) => within(s).queryByRole("option", { name: tekst }));
  if (!lista) throw new Error(`brak listy wyboru z opcją „${tekst}"`);
  return lista;
}

function liczba(nazwa: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("spinbutton", { name: nazwa });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hero - zapis pól", () => {
  const start = blok("hero", { title: "Strategie dla Europy", overlay: 40 });

  it.each([
    [pole("eyebrow"), "eyebrow", "Raport 2026"],
    [pole("title"), "title", "Nowy tytuł"],
    [pole("subtitlePh"), "subtitle", "Analizy i rekomendacje."],
    [pole("coverUrl"), "bgImage", "https://cdn.example.com/tlo.jpg"],
    [pole("ctaLabel"), "ctaLabel", "Czytaj"],
    [pole("ctaUrl"), "ctaHref", "/raport"],
    [pole("secondaryCtaLabel"), "secondaryLabel", "Kontakt"],
    [pole("secondaryCtaUrl"), "secondaryHref", "/kontakt"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(HeroBlock, start);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "hero" });
    expect(zapis.data).toEqual({ ...start.data, [klucz]: wartosc });
  });

  it("wyrównanie, wysokość i nakładka zapisują się pod własnymi kluczami, nakładka jako LICZBA", () => {
    const { changes } = renderEditor(HeroBlock, start);
    fireEvent.change(listaZOpcja(mb("alignLeft")), { target: { value: "left" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, align: "left" });
    fireEvent.change(listaZOpcja(mb("heightSm")), { target: { value: "screen" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, height: "screen" });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "70" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, overlay: 70 });
  });
});

describe("hero - odczyt", () => {
  it("pusty blok pokazuje wartości domyślne renderera i niczego nie zapisuje", () => {
    const { changes } = renderEditor(HeroBlock, blok("hero", {}));
    expect(listaZOpcja(mb("alignLeft")).value).toBe("center");
    expect(listaZOpcja(mb("heightSm")).value).toBe("md");
    expect(screen.getByRole("slider").closest("label")?.textContent).toContain("40%");
    expect(changes).toEqual([]);
  });

  it("wyrównanie i wysokość SPOZA opcji pokazują to, czego użyje renderer", () => {
    // `renderHero`: wyrównanie inne niż „left" -> „center", wysokość spoza
    // {sm, md, lg, screen} -> „md". Pierwsze opcje list to „left" i „sm" -
    // tyle pokazywał natywny `<select>` bez pasującej opcji.
    const { changes } = renderEditor(HeroBlock, blok("hero", { align: "right", height: "xl" }));
    expect(listaZOpcja(mb("alignLeft")).value).toBe("center");
    expect(listaZOpcja(mb("heightSm")).value).toBe("md");
    expect(changes).toEqual([]);
  });

  it.each([
    ["left", "lg"],
    ["center", "screen"],
    ["left", "sm"],
  ])("POPRAWNE wyrównanie „%s” i wysokość „%s” z danych pokazują się bez zmian", (a, h) => {
    renderEditor(HeroBlock, blok("hero", { align: a, height: h }));
    expect(listaZOpcja(mb("alignLeft")).value).toBe(a);
    expect(listaZOpcja(mb("heightSm")).value).toBe(h);
  });

  it.each([
    [150, "90"],
    [-5, "0"],
    ["nic", "40"],
  ] as const)("nakładka %j pokazuje w podpisie %s - tyle, ile narysuje strona", (ov, widac) => {
    const { container } = renderEditor(HeroBlock, blok("hero", { overlay: ov as Json }));
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe(widac);
    expect(screen.getByRole("slider").closest("label")?.textContent).toContain(`${widac}%`);
    expect(container.textContent).not.toContain("NaN");
  });
});

describe("sekcja CTA", () => {
  const start = blok("cta-section", { title: "Dołącz", variant: "muted" });

  it.each([
    [pole("title"), "title", "Zapisz się"],
    [pole("description"), "description", "Raz w tygodniu."],
    [pole("ctaLabel"), "ctaLabel", "Zapisz"],
    [pole("ctaUrl"), "ctaHref", "/newsletter"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(CtaSectionBlock, start);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, [klucz]: wartosc });
  });

  it("wariant zapisuje się pod `variant`; pusty i nieznany wariant to „podstawowy” jak w rendererze", () => {
    const { changes } = renderEditor(CtaSectionBlock, start);
    const wariant = listaZOpcja(mb("variantPrimary"));
    expect(wariant.value).toBe("muted");
    fireEvent.change(wariant, { target: { value: "gradient" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, variant: "gradient" });

    for (const data of [{}, { variant: "neon" }] as Record<string, Json>[]) {
      const { unmount } = renderEditor(CtaSectionBlock, blok("cta-section", data));
      expect(
        screen
          .getAllByRole<HTMLSelectElement>("combobox")
          .map((s) => s.value)
          .at(-1),
      ).toBe("primary");
      unmount();
    }
  });
});

describe("karuzela obrazów", () => {
  const slajdy: Json = [
    { url: "https://cdn.example.com/1.jpg", alt: "Sala", caption: "Otwarcie", href: "" },
    { url: "https://cdn.example.com/2.jpg", alt: "Panel", caption: "", href: "/panel" },
  ];

  it.each([
    [pole("imageUrl"), "url", "https://cdn.example.com/3.jpg"],
    [pole("alt"), "alt", "Goście"],
    [pole("href"), "href", "/galeria"],
    [pole("captionPh"), "caption", "Zamknięcie"],
  ])("pole „%s” drugiego slajdu zapisuje `%s` TYLKO w nim", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(ImageCarouselBlock, blok("image-carousel", { items: slajdy }));
    fireEvent.change(screen.getAllByPlaceholderText(placeholder)[1], {
      target: { value: wartosc },
    });
    const items = ostatniZapis(changes).data.items as Json[];
    expect(items[0]).toEqual((slajdy as Json[])[0]);
    expect(items[1]).toEqual({ ...((slajdy as Json[])[1] as object), [klucz]: wartosc });
  });

  it("dopisanie dokłada pusty slajd, usunięcie zabiera TEN slajd", () => {
    const { changes } = renderEditor(ImageCarouselBlock, blok("image-carousel", { items: slajdy }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(mb("addSlide")) }));
    expect(ostatniZapis(changes).data.items).toEqual([
      ...(slajdy as Json[]),
      { url: "", alt: "", caption: "", href: "" },
    ]);
    fireEvent.click(screen.getAllByRole("button", { name: mb("removeSlide") })[0]);
    expect(ostatniZapis(changes).data.items).toEqual([(slajdy as Json[])[1]]);
  });

  it("proporcje zapisują się pod `aspect`; pusty blok to 16:9 bez autoodtwarzania", () => {
    const { changes } = renderEditor(ImageCarouselBlock, blok("image-carousel", {}));
    const proporcje = listaZOpcja("16:9");
    expect(proporcje.value).toBe("16:9");
    expect(screen.getByRole("checkbox", { name: mb("autoplay") })).not.toBeChecked();
    expect(changes).toEqual([]);
    fireEvent.change(proporcje, { target: { value: "21:9" } });
    expect(ostatniZapis(changes).data).toEqual({ aspect: "21:9" });
  });

  /** Pole interwału - po etykiecie, niezależnie od rodzaju kontrolki. */
  const poleInterwalu = () => screen.getByLabelText<HTMLInputElement>(mb("interval"));

  it("pole interwału jest TYLKO przy włączonym autoodtwarzaniu", () => {
    // Renderer czyta `autoplay === true` - napis „true" z importu to NIE
    // autoodtwarzanie, więc edytor też nie pokazuje interwału.
    const { changes, unmount } = renderEditor(
      ImageCarouselBlock,
      blok("image-carousel", { autoplay: "true" }),
    );
    expect(screen.queryByLabelText(mb("interval"))).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: mb("autoplay") }));
    expect(ostatniZapis(changes).data).toEqual({ autoplay: true });
    unmount();

    renderEditor(ImageCarouselBlock, blok("image-carousel", { autoplay: true }));
    expect(poleInterwalu().value).toBe("5000");
  });

  it("interwał zapisuje LICZBĘ, a śmieć w danych pokazuje 5000 ms jak renderer", () => {
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    const { changes } = renderEditor(
      ImageCarouselBlock,
      blok("image-carousel", { autoplay: true, interval: "szybko" }),
    );
    const interwal = poleInterwalu();
    expect(interwal.value).toBe("5000");
    expect(blad.mock.calls.flat().join(" ")).not.toContain("NaN");
    fireEvent.change(interwal, { target: { value: "8000" } });
    expect(ostatniZapis(changes).data).toEqual({ autoplay: true, interval: 8000 });
  });

  // NAPRAWIONE 2026-10-19: pole miało `min`/`max` tylko jako atrybuty HTML -
  // `Number(e.target.value)` zapisywało każdą wpisaną liczbę (99999, 100),
  // a interwał 2^31 z importu pole pokazywało dosłownie, choć strona przewija
  // najwyżej co 20 s. Zakres pola i widoku to teraz JEDNA stała.
  it("interwał spoza zakresu 1500-20000 ms nie trafia do zapisu", () => {
    const zImportu = renderEditor(
      ImageCarouselBlock,
      blok("image-carousel", { autoplay: true, interval: 2 ** 31 }),
    );
    expect(poleInterwalu().value).toBe("20000");
    fireEvent.focus(poleInterwalu());
    fireEvent.blur(poleInterwalu());
    expect(zImportu.changes).toEqual([]);
    zImportu.unmount();

    for (const [wpis, zapis] of [
      ["99999", 20000],
      ["100", 1500],
    ] as const) {
      const { changes, unmount } = renderEditor(
        ImageCarouselBlock,
        blok("image-carousel", { autoplay: true }),
      );
      const pole = poleInterwalu();
      fireEvent.focus(pole);
      fireEvent.change(pole, { target: { value: wpis } });
      fireEvent.blur(pole);
      const interwaly = changes.map((c) => c.data.interval as number);
      expect(
        interwaly.every((ms) => ms >= 1500 && ms <= 20000),
        `wpis ${wpis}: ${interwaly}`,
      ).toBe(true);
      expect(ostatniZapis(changes).data).toEqual({ autoplay: true, interval: zapis });
      expect(pole.value).toBe(String(zapis));
      unmount();
    }
  });

  it("slajd `null` z importu daje puste pola, nie „null”", () => {
    const { container } = renderEditor(
      ImageCarouselBlock,
      blok("image-carousel", { items: [null] as unknown as Json }),
    );
    expect(screen.getByPlaceholderText<HTMLInputElement>(pole("imageUrl")).value).toBe("");
    expect(container.textContent).not.toContain("null");
  });
});

describe("formularz kontaktowy", () => {
  it.each([
    [mb("contactTitle"), "title", "Napisz do nas"],
    [mb("contactDesc"), "description", "Odpowiadamy w 24 h."],
    [mb("submitLabel"), "submitLabel", "Wyślij"],
    [mb("successMessage"), "successMessage", "Dziękujemy!"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(ContactFormBlock, blok("contact-form", {}));
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    expect(ostatniZapis(changes).data).toEqual({ [klucz]: wartosc });
  });

  it("domyślnie: bez telefonu, z tematem i z wymaganą zgodą RODO - jak renderer", () => {
    const { changes } = renderEditor(ContactFormBlock, blok("contact-form", {}));
    expect(screen.getByRole("checkbox", { name: mb("fieldPhone") })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: mb("fieldSubject") })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: mb("requireConsent") })).toBeChecked();
    expect(changes).toEqual([]);
  });

  it("przełączniki zapisują WARTOŚCI LOGICZNE pod własnymi kluczami", () => {
    const { changes } = renderEditor(ContactFormBlock, blok("contact-form", {}));
    fireEvent.click(screen.getByRole("checkbox", { name: mb("fieldPhone") }));
    expect(ostatniZapis(changes).data).toEqual({ showPhone: true });
    fireEvent.click(screen.getByRole("checkbox", { name: mb("fieldSubject") }));
    expect(ostatniZapis(changes).data).toEqual({ showSubject: false });
    fireEvent.click(screen.getByRole("checkbox", { name: mb("requireConsent") }));
    expect(ostatniZapis(changes).data).toEqual({ requireConsent: false });
  });

  it("jawne `false` dla tematu i zgody pokazuje pola ODZNACZONE", () => {
    renderEditor(
      ContactFormBlock,
      blok("contact-form", { showSubject: false, requireConsent: false }),
    );
    expect(screen.getByRole("checkbox", { name: mb("fieldSubject") })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: mb("requireConsent") })).not.toBeChecked();
  });
});

describe("mapa", () => {
  const start = blok("map", { lat: 50.0614, lng: 19.9366, zoom: 12, height: 400, label: "" });

  it("pusty blok pokazuje Warszawę, powiększenie 13 i 360 px - wartości renderera", () => {
    const { changes } = renderEditor(MapBlock, blok("map", {}));
    expect(liczba(mb("latitude")).value).toBe("52.2297");
    expect(liczba(mb("longitude")).value).toBe("21.0122");
    expect(liczba(mb("zoom")).value).toBe("13");
    expect(liczba(mb("heightPx")).value).toBe("360");
    expect(changes).toEqual([]);
  });

  it.each([
    [mb("latitude"), "lat", "48.8566", 48.8566],
    [mb("longitude"), "lng", "-0.1276", -0.1276],
    [mb("zoom"), "zoom", "15", 15],
    [mb("heightPx"), "height", "480", 480],
  ])("pole „%s” zapisuje LICZBĘ pod `%s`", (nazwa, klucz, wpis, oczekiwana) => {
    const { changes } = renderEditor(MapBlock, start);
    fireEvent.change(liczba(nazwa), { target: { value: wpis } });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "map" });
    expect(zapis.data).toEqual({ ...start.data, [klucz]: oczekiwana });
  });

  it("etykieta markera zapisuje się pod `label`", () => {
    const { changes } = renderEditor(MapBlock, start);
    fireEvent.change(screen.getByPlaceholderText(mb("markerLabel")), {
      target: { value: "Nasza siedziba" },
    });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, label: "Nasza siedziba" });
  });

  it("współrzędne i wysokość nieczytelne w danych pokazują wartości, których użyje renderer", () => {
    // Renderer czyta `num(…)` z wartością domyślną; edytor robił `Number(…)`,
    // czyli `NaN` - puste pole i ostrzeżenie Reacta o `NaN` w atrybucie `value`.
    const blad = vi.spyOn(console, "error").mockImplementation(() => {});
    const { changes } = renderEditor(
      MapBlock,
      blok("map", { lat: "północ", lng: null, height: "wysoko", zoom: "blisko" }),
    );
    expect(liczba(mb("latitude")).value).toBe("52.2297");
    expect(liczba(mb("longitude")).value).toBe("21.0122");
    expect(liczba(mb("heightPx")).value).toBe("360");
    expect(liczba(mb("zoom")).value).toBe("13");
    expect(blad.mock.calls.flat().join(" ")).not.toContain("NaN");
    expect(changes).toEqual([]);
  });

  it("powiększenie i wysokość ponad górną granicę pola pokazują granicę - jak `MapView`", () => {
    renderEditor(MapBlock, blok("map", { zoom: 99, height: 5000 }));
    const zoom = liczba(mb("zoom"));
    const wysokosc = liczba(mb("heightPx"));
    expect(zoom.value).toBe(zoom.max);
    expect(wysokosc.value).toBe(wysokosc.max);
  });

  it("wpis ponad górną granicę zapisuje się DOCIĘTY, a liczby z napisów są przyjmowane", () => {
    const { changes } = renderEditor(MapBlock, start);
    fireEvent.change(liczba(mb("zoom")), { target: { value: "25" } });
    expect(ostatniZapis(changes).data.zoom).toBe(18);
    fireEvent.change(liczba(mb("heightPx")), { target: { value: "1200" } });
    expect(ostatniZapis(changes).data.height).toBe(800);

    // Import zapisuje część liczb jako napisy - „50.5" to nadal 50.5.
    renderEditor(MapBlock, blok("map", { lat: "50.5" }));
    expect(
      screen.getAllByRole<HTMLInputElement>("spinbutton", { name: mb("latitude") })[1].value,
    ).toBe("50.5");
  });
});
