// EDYTORY `banner-image` I `video-hero` - CO REDAKTOR WIDZI I CO ZAPISUJE.
//
// PO CO OSOBNY PLIK. Repeatery tej rodziny (`step-list`, `comparison-table`)
// mają dowód w `blockEditConversionRepeaters.test.tsx`. Te dwa edytory nie mają
// list - mają za to SUWAK nakładki z podpisem procentowym i listy wyboru,
// których wartość domyślna NIE jest pierwszą opcją. Oba miejsca dają się
// rozjechać z rendererem publicznym (`renderBannerImage` / `renderVideoHero`
// w `components/blocks/renderer/molecules.tsx`), a redaktor ustawia blok
// właśnie na podstawie tego, co pokazuje edytor.
//
// CO MA TU DOWÓD
//  * każde pole zapisuje się pod WŁASNYM kluczem `data`, z resztą danych
//    i z `id`/`type` bloku bez zmian; suwak zapisuje LICZBĘ, nie napis,
//  * sam render niczego nie zapisuje (zapis na renderze = „brudny" dokument),
//  * nakładka spoza 0-90 albo nieczytelna (`"nic"`) pokazuje w podpisie tę
//    wartość, którą narysuje strona (renderer: `num()` + docięcie do 0-90),
//    a nie „NaN%" ani „150%" przy suwaku stojącym na 90,
//  * lista wyboru z wartością spoza swoich opcji pokazuje wartość, której
//    UŻYJE renderer (`video-hero`: wysokość „lg", wyrównanie „center"), a nie
//    pierwszą opcję - natywny `<select>` bez pasującej opcji pokazuje pierwszą,
//    więc redaktor widział „Średnia" i „Wyrównaj lewo", a strona rysowała
//    wysoką, wyśrodkowaną sekcję.
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix `Select`/`Switch`, `<Link>`
// routera, Supabase, `fetch`) niesie moduł wspólny tabeli edytorów, dlatego
// jego import jest PIERWSZY. `AdminSelect` to natywny `<select>` - zostaje
// prawdziwy. i18n PRAWDZIWE (`realT`): placeholdery i etykiety ze słownika.
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { BannerImageBlock, VideoHeroBlock } from "../ConversionBlocks";

const t = realT("pl");
const cb = (key: string) => t(`blocks.editors.conversionBlocks.${key}`) as string;
const pole = (key: string) => t(`blocks.fields.${key}`) as string;

function blok(type: "banner-image" | "video-hero", data: Record<string, Json>): Block {
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

/** Podpis procentowy przy suwaku nakładki. */
function podpisNakladki(container: HTMLElement): string {
  const suwak = screen.getByRole("slider");
  return (suwak.closest("label")?.textContent ?? container.textContent ?? "").replace(
    cb("overlay"),
    "",
  );
}

describe("banner z obrazem - zapis pól", () => {
  const start = blok("banner-image", {
    image: "https://cdn.example.com/a.jpg",
    title: "Wiosenna promocja",
    overlay: 35,
  });

  it.each([
    [pole("imageUrl"), "image", "https://cdn.example.com/b.jpg"],
    [pole("alt"), "alt", "Ludzie przy stole"],
    [pole("title"), "title", "Letnia promocja"],
    [cb("shortDesc"), "description", "Do końca miesiąca."],
    [pole("ctaLabel"), "ctaLabel", "Sprawdź"],
    [pole("ctaUrl"), "ctaHref", "/oferta"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(BannerImageBlock, start);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    const zapis = ostatniZapis(changes);
    expect(changes).toHaveLength(1);
    expect(zapis.id).toBe(start.id);
    expect(zapis.type).toBe("banner-image");
    expect(zapis.data).toEqual({ ...start.data, [klucz]: wartosc });
  });

  it("listy wyboru zapisują położenie tekstu, motyw i proporcje pod własnymi kluczami", () => {
    const { changes } = renderEditor(BannerImageBlock, start);
    fireEvent.change(listaZOpcja(cb("posLeft")), { target: { value: "right" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, position: "right" });
    fireEvent.change(listaZOpcja(cb("textLight")), { target: { value: "light" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, theme: "light" });
    fireEvent.change(listaZOpcja("21:9"), { target: { value: "3:1" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, aspect: "3:1" });
  });

  it("suwak nakładki zapisuje LICZBĘ, a nie napis z pola", () => {
    const { changes } = renderEditor(BannerImageBlock, start);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "60" } });
    expect(ostatniZapis(changes).data.overlay).toBe(60);
  });
});

describe("banner z obrazem - odczyt", () => {
  it("pusty blok pokazuje wartości domyślne renderera i niczego nie zapisuje", () => {
    const { container, changes } = renderEditor(BannerImageBlock, blok("banner-image", {}));
    expect(listaZOpcja(cb("posLeft")).value).toBe("left");
    expect(listaZOpcja(cb("textLight")).value).toBe("dark");
    expect(listaZOpcja("21:9").value).toBe("21:9");
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("35");
    expect(podpisNakladki(container)).toBe("35%");
    expect(changes).toEqual([]);
  });

  it.each([
    // [nakładka w danych, co narysuje strona]
    [150, "90"],
    [-20, "0"],
    ["nic", "35"],
    ["50", "50"],
  ] as const)(
    "nakładka %j pokazuje w podpisie %s - tyle, ile narysuje renderer",
    (overlay, widac) => {
      const { container, changes } = renderEditor(
        BannerImageBlock,
        blok("banner-image", { overlay: overlay as Json }),
      );
      expect((screen.getByRole("slider") as HTMLInputElement).value).toBe(widac);
      expect(podpisNakladki(container)).toBe(`${widac}%`);
      expect(container.textContent).not.toContain("NaN");
      expect(changes).toEqual([]);
    },
  );
});

describe("hero z tłem wideo - zapis pól", () => {
  const start = blok("video-hero", { src: "https://cdn.example.com/v.mp4", overlay: 45 });

  it.each([
    [cb("videoUrl"), "src", "https://cdn.example.com/w.webm"],
    [cb("posterUrl"), "poster", "https://cdn.example.com/p.jpg"],
    [pole("title"), "title", "Konferencja 2026"],
    [pole("subtitlePh"), "subtitle", "Trzy dni rozmów o Europie."],
    [pole("ctaLabel"), "ctaLabel", "Zarejestruj się"],
    [pole("ctaUrl"), "ctaHref", "/rejestracja"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (placeholder, klucz, wartosc) => {
    const { changes } = renderEditor(VideoHeroBlock, start);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: wartosc } });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "video-hero" });
    expect(zapis.data).toEqual({ ...start.data, [klucz]: wartosc });
  });

  it("listy wyboru zapisują wysokość i wyrównanie pod własnymi kluczami", () => {
    const { changes } = renderEditor(VideoHeroBlock, start);
    fireEvent.change(listaZOpcja(cb("heightScreen")), { target: { value: "screen" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, height: "screen" });
    fireEvent.change(listaZOpcja(cb("alignLeft")), { target: { value: "left" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, align: "left" });
  });

  it("autoodtwarzanie i zapętlenie są domyślnie WŁĄCZONE, a odznaczenie zapisuje `false`", () => {
    // Renderer czyta oba jako `bool(…, true)` - brak klucza to „włączone".
    const { changes } = renderEditor(VideoHeroBlock, start);
    const autoplay = screen.getByRole("checkbox", { name: cb("autoplay") });
    const loop = screen.getByRole("checkbox", { name: cb("loop") });
    expect(autoplay).toBeChecked();
    expect(loop).toBeChecked();
    fireEvent.click(autoplay);
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, autoplay: false });
    fireEvent.click(loop);
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, loop: false });
  });

  it("jawne `false` w danych pokazuje pole odznaczone, a zaznaczenie zapisuje `true`", () => {
    const { changes } = renderEditor(
      VideoHeroBlock,
      blok("video-hero", { autoplay: false, loop: false }),
    );
    const autoplay = screen.getByRole("checkbox", { name: cb("autoplay") });
    expect(autoplay).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: cb("loop") })).not.toBeChecked();
    fireEvent.click(autoplay);
    expect(ostatniZapis(changes).data).toEqual({ autoplay: true, loop: false });
  });

  it("suwak nakładki zapisuje LICZBĘ", () => {
    const { changes } = renderEditor(VideoHeroBlock, start);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "20" } });
    expect(ostatniZapis(changes).data.overlay).toBe(20);
  });
});

describe("hero z tłem wideo - odczyt", () => {
  it("pusty blok pokazuje wartości domyślne renderera i niczego nie zapisuje", () => {
    const { container, changes } = renderEditor(VideoHeroBlock, blok("video-hero", {}));
    expect(listaZOpcja(cb("heightScreen")).value).toBe("lg");
    expect(listaZOpcja(cb("alignLeft")).value).toBe("center");
    expect(podpisNakladki(container)).toBe("45%");
    expect(changes).toEqual([]);
  });

  it("wysokość i wyrównanie SPOZA opcji pokazują to, czego użyje renderer, nie pierwszą opcję", () => {
    // Renderer: wysokość spoza {md, screen} -> „lg", wyrównanie inne niż
    // „left" -> „center". Pierwsze opcje list to „md" i „left" - tyle
    // pokazywał natywny `<select>`, gdy wartość nie pasowała do żadnej opcji.
    const { changes } = renderEditor(
      VideoHeroBlock,
      blok("video-hero", { height: "xl", align: "right" }),
    );
    expect(listaZOpcja(cb("heightScreen")).value).toBe("lg");
    expect(listaZOpcja(cb("alignLeft")).value).toBe("center");
    // Wartość w danych zostaje nietknięta do pierwszej świadomej zmiany.
    expect(changes).toEqual([]);
  });

  it.each([
    ["md", "left"],
    ["screen", "center"],
  ])("POPRAWNA wysokość „%s” i wyrównanie „%s” z danych pokazują się bez zmian", (h, a) => {
    // Druga strona normalizacji: wartości z dziedziny NIE są podmieniane
    // na domyślne renderera.
    renderEditor(VideoHeroBlock, blok("video-hero", { height: h, align: a }));
    expect(listaZOpcja(cb("heightScreen")).value).toBe(h);
    expect(listaZOpcja(cb("alignLeft")).value).toBe(a);
  });

  it.each([
    [200, "90"],
    ["nic", "45"],
  ] as const)(
    "nakładka %j pokazuje w podpisie %s - tyle, ile narysuje renderer",
    (overlay, widac) => {
      const { container } = renderEditor(
        VideoHeroBlock,
        blok("video-hero", { overlay: overlay as Json }),
      );
      expect((screen.getByRole("slider") as HTMLInputElement).value).toBe(widac);
      expect(podpisNakladki(container)).toBe(`${widac}%`);
    },
  );
});
