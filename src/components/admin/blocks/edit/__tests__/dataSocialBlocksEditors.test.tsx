// SIATKI ZESPOŁU, LOGOTYPÓW I FUNKCJI, BANER ALERTU, SEPARATOR Z TEKSTEM -
// kontrakt ZAPISU edytorów z `DataSocialBlocks.tsx`.
//
// PO CO OSOBNY PLIK. Pięć edytorów tej rodziny to formularze z powtarzalnymi
// pozycjami (osoba, logotyp, funkcja), a cała ich logika siedzi w domknięciach
// `onChange`: dopisanie pozycji, usunięcie WŁAŚCIWEJ pozycji, zapis pola pod
// SWOIM kluczem i tylko w SWOJEJ pozycji. Żaden test tego nie sprawdzał -
// plik miał pokryte 2% linii, a to właśnie tu redaktor traci osobę z siatki
// zespołu albo nadpisuje opis cudzej funkcji.
//
// CO MA TU DOWÓD
//  * każdy zapis niesie TEN SAM `id` i `type` bloku, a pozostałe klucze
//    `data` zostają nietknięte,
//  * „Dodaj" dopisuje KOMPLET pustych pól na końcu listy, „Usuń" usuwa
//    dokładnie wskazaną pozycję, pole pozycji pisze tylko w swoją pozycję,
//  * lista wyboru pokazuje to, co narysuje strona: liczba kolumn, której
//    widok nie zna, wraca do wartości domyślnej renderu (a nie do pierwszej
//    opcji listy), liczba, którą widok rysuje, a lista jej nie oferuje
//    (np. 2 kolumny logotypów), zostaje wybrana jako osobna opcja,
//    wyrównanie separatora spoza opcji - do środka,
//  * pole pozycji-OBIEKTU (treść per język po migracji) jest puste, a nie
//    „[object Object]", który pierwsza edycja utrwaliłaby w dokumencie.
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix Select/Switch, `<Link>` routera,
// klient Supabase, kontekst najemcy, `fetch`) niesie moduł wspólny tabeli,
// dlatego jego import jest PIERWSZY. i18n PRAWDZIWE - zapytania idą po
// polskich podpisach pól, więc zniknięcie klucza ze słownika oblewa test.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import {
  AlertBannerBlock,
  DividerTextBlock,
  FeatureGridBlock,
  LogoGridBlock,
  TeamGridBlock,
} from "../DataSocialBlocks";

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

/** Ostatni zapis - z dowodem, że niesie tożsamość bloku. */
function ostatni(changes: readonly Block[], wzor: Block): Block {
  const zapis = changes.at(-1);
  if (!zapis) throw new Error("edytor nie zapisał niczego");
  expect({ id: zapis.id, type: zapis.type }).toEqual({ id: wzor.id, type: wzor.type });
  return zapis;
}

/** Lista wyboru rozpoznana po jednej ze swoich opcji (pola nie mają etykiet). */
function listaZOpcja(opcja: string): HTMLSelectElement {
  const lista = screen
    .getAllByRole<HTMLSelectElement>("combobox")
    .find((el) => Array.from(el.options).some((o) => o.text === opcja));
  if (!lista) throw new Error(`brak listy wyboru z opcją „${opcja}"`);
  return lista;
}

function pola(placeholder: string): HTMLInputElement[] {
  return screen.getAllByPlaceholderText<HTMLInputElement>(placeholder);
}

const ANNA = {
  name: "Anna",
  role: "CEO",
  bio: "B1",
  avatar: "a.png",
  href: "/a",
  social: "x.com/a",
};
const JAN = { name: "Jan", role: "CTO", bio: "B2", avatar: "j.png", href: "/j", social: "x.com/j" };
const EWA = { name: "Ewa", role: "CFO", bio: "B3", avatar: "e.png", href: "/e", social: "x.com/e" };

describe("siatka zespołu", () => {
  it("sam render nie zapisuje niczego, a puste dane dają zero osób i domyślne 3 kolumny", () => {
    const { changes } = renderEditor(TeamGridBlock, blok("team-grid", {}));
    expect(changes).toEqual([]);
    expect(screen.queryAllByPlaceholderText("Imię i nazwisko")).toHaveLength(0);
    expect(listaZOpcja("3 kolumny").value).toBe("3");
    expect(listaZOpcja("Awatary okrągłe").value).toBe("circle");
  });

  it("„Dodaj osobę” dopisuje komplet pustych pól NA KOŃCU, nie ruszając istniejących", () => {
    const b = blok("team-grid", { title: "Zespół", items: [ANNA] });
    const { changes } = renderEditor(TeamGridBlock, b);
    fireEvent.click(screen.getByRole("button", { name: "Dodaj osobę" }));
    const zapis = ostatni(changes, b);
    expect(zapis.data.title).toBe("Zespół");
    expect(zapis.data.items).toEqual([
      ANNA,
      { name: "", role: "", bio: "", avatar: "", href: "", social: "" },
    ]);
  });

  it("„Usuń osobę” usuwa WSKAZANĄ osobę, a nie ostatnią", () => {
    const b = blok("team-grid", { items: [ANNA, JAN, EWA] });
    const { changes } = renderEditor(TeamGridBlock, b);
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń osobę" })[1]);
    expect(ostatni(changes, b).data.items).toEqual([ANNA, EWA]);
  });

  it.each([
    ["Imię i nazwisko", "name"],
    ["Stanowisko", "role"],
    ["URL profilu (opcjonalnie)", "href"],
    ["URL awatara", "avatar"],
    ["Krótki opis / bio", "bio"],
    ["LinkedIn / X / strona (URL)", "social"],
  ])("pole „%s” pisze pod kluczem `%s` i TYLKO w swojej osobie", (placeholder, klucz) => {
    const b = blok("team-grid", { items: [ANNA, JAN] });
    const { changes } = renderEditor(TeamGridBlock, b);
    fireEvent.change(pola(placeholder)[1], { target: { value: "nowa wartość" } });
    expect(changes).toHaveLength(1);
    expect(ostatni(changes, b).data.items).toEqual([ANNA, { ...JAN, [klucz]: "nowa wartość" }]);
  });

  it("tytuł sekcji zapisuje się pod `title`, bez ruszania osób", () => {
    const b = blok("team-grid", { items: [ANNA] });
    const { changes } = renderEditor(TeamGridBlock, b);
    fireEvent.change(screen.getByPlaceholderText("Tytuł sekcji (opcjonalnie)"), {
      target: { value: "Ludzie" },
    });
    expect(ostatni(changes, b).data).toEqual({ items: [ANNA], title: "Ludzie" });
  });

  it("kolumny zapisują się LICZBĄ, a kształt awatara - napisem", () => {
    const b = blok("team-grid", { columns: 3, shape: "circle" });
    const { changes } = renderEditor(TeamGridBlock, b);
    fireEvent.change(listaZOpcja("3 kolumny"), { target: { value: "4" } });
    expect(ostatni(changes, b).data.columns).toBe(4);
    fireEvent.change(listaZOpcja("Awatary okrągłe"), { target: { value: "square" } });
    expect(ostatni(changes, b).data.shape).toBe("square");
  });

  it.each([
    ["trzy", "3"],
    [7, "3"],
    [null, "3"],
    ["4", "4"],
    // `num` renderu czyta napis przez `Number()`, więc przecinek to NIE liczba.
    ["4,0", "3"],
  ] as const)(
    "kolumny %j pokazują się jako %s - tyle narysuje strona, a nie pierwsza opcja",
    (columns, widac) => {
      // Natywna lista z wartością spoza opcji pokazuje PIERWSZĄ opcję
      // („2 kolumny"), a strona rysuje domyślne 3 (`num(..., 3)`).
      renderEditor(TeamGridBlock, blok("team-grid", { columns }));
      expect(listaZOpcja("3 kolumny").value).toBe(widac);
    },
  );

  it("5 kolumn (strona je rysuje, lista ich nie oferuje) ZOSTAJE wybrane jako osobna opcja", () => {
    // `COLS_CLS` widoku zna 2-6 kolumn. Zamiana na domyślne 3 pokazywałaby
    // redaktorowi inną siatkę niż ta na stronie; zwykłe opcje listy zostają.
    const b = blok("team-grid", { columns: 5 });
    const { changes } = renderEditor(TeamGridBlock, b);
    const lista = listaZOpcja("3 kolumny");
    expect(lista.value).toBe("5");
    expect(Array.from(lista.options, (o) => o.text)).toEqual([
      "2 kolumny",
      "3 kolumny",
      "4 kolumny",
      "5 kol.",
    ]);
    expect(changes).toEqual([]);
    fireEvent.change(lista, { target: { value: "2" } });
    expect(ostatni(changes, b).data.columns).toBe(2);
  });

  it("osoba zapisana jako OBIEKTY per język ma puste pola, a nie „[object Object]”", () => {
    renderEditor(TeamGridBlock, blok("team-grid", { items: [{ name: { pl: "Anna" }, role: 7 }] }));
    expect(pola("Imię i nazwisko")[0].value).toBe("");
    // Liczba to nadal czytelna treść pola - zostaje jako tekst.
    expect(pola("Stanowisko")[0].value).toBe("7");
    const wszystkie = screen.getAllByRole<HTMLInputElement>("textbox").map((el) => el.value);
    expect(wszystkie.join("|")).not.toContain("[object Object]");
  });
});

describe("siatka logotypów", () => {
  const LOGO = { url: "l1.svg", alt: "Firma 1", href: "https://f1.example" };
  const LOGO2 = { url: "l2.svg", alt: "Firma 2", href: "https://f2.example" };

  it("domyślnie: 5 kolumn, czarno-białe WŁĄCZONE, ramki WYŁĄCZONE", () => {
    // Te same domyślne, co w renderze publicznym (`num(..., 5)`,
    // `bool(grayscale, true)`, `bordered === true`).
    renderEditor(LogoGridBlock, blok("logo-grid", {}));
    expect(listaZOpcja("5 kol.").value).toBe("5");
    expect(screen.getByRole("checkbox", { name: "Czarno-białe" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Ramki" })).not.toBeChecked();
  });

  it("2 kolumny (strona je rysuje, lista ich nie oferuje) pokazują się jako 2, a nie domyślne 5", () => {
    // Siatka logotypów rysuje `COLS_CLS[2]`, czyli DWIE kolumny - pokazanie
    // tu „5 kol." mówiłoby redaktorowi nieprawdę o stronie.
    const b = blok("logo-grid", { columns: 2 });
    const { changes } = renderEditor(LogoGridBlock, b);
    const lista = listaZOpcja("5 kol.");
    expect(lista.value).toBe("2");
    expect(lista.selectedOptions[0]?.text).toBe("2 kolumny");
    fireEvent.change(lista, { target: { value: "6" } });
    expect(ostatni(changes, b).data.columns).toBe(6);
  });

  it("kolumny, których strona NIE rysuje (9), pokazują domyślne 5", () => {
    renderEditor(LogoGridBlock, blok("logo-grid", { columns: 9 }));
    const lista = listaZOpcja("5 kol.");
    expect(lista.value).toBe("5");
    expect(lista.options).toHaveLength(4);
  });

  it("przełączniki zapisują `grayscale` i `bordered` jako wartości logiczne", () => {
    const b = blok("logo-grid", { grayscale: true, bordered: false });
    const { changes } = renderEditor(LogoGridBlock, b);
    fireEvent.click(screen.getByRole("checkbox", { name: "Czarno-białe" }));
    expect(ostatni(changes, b).data.grayscale).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Ramki" }));
    expect(ostatni(changes, b).data.bordered).toBe(true);
  });

  it("dodanie, edycja i usunięcie logotypu - każde jednym zapisem pod właściwym indeksem", () => {
    const b = blok("logo-grid", { items: [LOGO, LOGO2] });
    const { changes } = renderEditor(LogoGridBlock, b);

    fireEvent.click(screen.getByRole("button", { name: "Dodaj logotyp" }));
    expect(ostatni(changes, b).data.items).toEqual([LOGO, LOGO2, { url: "", alt: "", href: "" }]);

    fireEvent.change(pola("URL logotypu")[1], { target: { value: "nowe.svg" } });
    expect(ostatni(changes, b).data.items).toEqual([LOGO, { ...LOGO2, url: "nowe.svg" }]);
    fireEvent.change(pola("Nazwa (alt)")[0], { target: { value: "Alt" } });
    expect(ostatni(changes, b).data.items).toEqual([{ ...LOGO, alt: "Alt" }, LOGO2]);
    fireEvent.change(pola("Link (href)")[1], { target: { value: "/p" } });
    expect(ostatni(changes, b).data.items).toEqual([LOGO, { ...LOGO2, href: "/p" }]);

    fireEvent.click(screen.getAllByRole("button", { name: "Usuń logotyp" })[0]);
    expect(ostatni(changes, b).data.items).toEqual([LOGO2]);
    expect(changes).toHaveLength(5);
  });

  it("tytuł sekcji zapisuje się pod `title`", () => {
    const b = blok("logo-grid", {});
    const { changes } = renderEditor(LogoGridBlock, b);
    fireEvent.change(screen.getByPlaceholderText("Tytuł sekcji (opcjonalnie)"), {
      target: { value: "Zaufali nam" },
    });
    expect(ostatni(changes, b).data).toEqual({ title: "Zaufali nam" });
  });
});

describe("siatka funkcji", () => {
  const F1 = { icon: "zap", title: "Szybko", description: "Opis 1", href: "/1" };
  const F2 = { icon: "shield", title: "Bezpiecznie", description: "Opis 2", href: "/2" };

  it("nowa funkcja dostaje ikonę gwiazdki i puste pola, na końcu listy", () => {
    const b = blok("feature-grid", { items: [F1] });
    const { changes } = renderEditor(FeatureGridBlock, b);
    fireEvent.click(screen.getByRole("button", { name: "Dodaj funkcję" }));
    expect(ostatni(changes, b).data.items).toEqual([
      F1,
      { icon: "star", title: "", description: "", href: "" },
    ]);
  });

  it("ikona, tytuł, opis i link piszą tylko w swoją funkcję", () => {
    const b = blok("feature-grid", { items: [F1, F2] });
    const { changes } = renderEditor(FeatureGridBlock, b);
    const ikony = screen
      .getAllByRole<HTMLSelectElement>("combobox")
      .filter((el) => Array.from(el.options).some((o) => o.value === "gauge"));
    expect(ikony.map((el) => el.value)).toEqual(["zap", "shield"]);

    fireEvent.change(ikony[1], { target: { value: "gauge" } });
    expect(ostatni(changes, b).data.items).toEqual([F1, { ...F2, icon: "gauge" }]);
    fireEvent.change(pola("Tytuł funkcji")[0], { target: { value: "T" } });
    expect(ostatni(changes, b).data.items).toEqual([{ ...F1, title: "T" }, F2]);
    fireEvent.change(pola("Opis funkcji")[1], { target: { value: "D" } });
    expect(ostatni(changes, b).data.items).toEqual([F1, { ...F2, description: "D" }]);
    fireEvent.change(pola("Link (href)")[0], { target: { value: "/x" } });
    expect(ostatni(changes, b).data.items).toEqual([{ ...F1, href: "/x" }, F2]);
  });

  it.each([["unicorn"], [""], [null]] as const)(
    "ikona %j pokazuje gwiazdkę - tę samą, którą narysuje strona",
    (icon) => {
      renderEditor(FeatureGridBlock, blok("feature-grid", { items: [{ ...F1, icon }] }));
      const ikona = screen
        .getAllByRole<HTMLSelectElement>("combobox")
        .find((el) => Array.from(el.options).some((o) => o.value === "gauge"));
      expect(ikona?.value).toBe("star");
    },
  );

  it("tytuł sekcji zapisuje się pod `title`, bez ruszania funkcji", () => {
    const b = blok("feature-grid", { items: [F1] });
    const { changes } = renderEditor(FeatureGridBlock, b);
    fireEvent.change(screen.getByPlaceholderText("Tytuł sekcji (opcjonalnie)"), {
      target: { value: "Dlaczego warto" },
    });
    expect(ostatni(changes, b).data).toEqual({ items: [F1], title: "Dlaczego warto" });
  });

  it("usunięcie funkcji usuwa wskazaną pozycję", () => {
    const b = blok("feature-grid", { items: [F1, F2] });
    const { changes } = renderEditor(FeatureGridBlock, b);
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń funkcję" })[0]);
    expect(ostatni(changes, b).data.items).toEqual([F2]);
  });

  it("podtytuł, kolumny i styl karty zapisują się pod swoimi kluczami", () => {
    const b = blok("feature-grid", { title: "Cechy", columns: "dużo" });
    const { changes } = renderEditor(FeatureGridBlock, b);
    // „dużo" spoza opcji pokazuje domyślne 3 (render: `num(..., 3)`).
    expect(listaZOpcja("3 kolumny").value).toBe("3");
    expect(listaZOpcja("Styl: karta").value).toBe("card");

    fireEvent.change(screen.getByPlaceholderText("Podtytuł sekcji (opcjonalnie)"), {
      target: { value: "Dlaczego my" },
    });
    expect(ostatni(changes, b).data).toEqual({
      title: "Cechy",
      columns: "dużo",
      subtitle: "Dlaczego my",
    });
    fireEvent.change(listaZOpcja("3 kolumny"), { target: { value: "2" } });
    expect(ostatni(changes, b).data.columns).toBe(2);
    fireEvent.change(listaZOpcja("Styl: karta"), { target: { value: "bordered" } });
    expect(ostatni(changes, b).data.style).toBe("bordered");
  });
});

describe("baner alertu", () => {
  it("domyślnie: wariant informacyjny, bez zamykania, z ikoną", () => {
    const { changes } = renderEditor(AlertBannerBlock, blok("alert-banner", {}));
    expect(changes).toEqual([]);
    expect(listaZOpcja("Informacja (niebieski)").value).toBe("info");
    expect(screen.getByRole("checkbox", { name: "Można zamknąć" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pokaż ikonę" })).toBeChecked();
  });

  it.each([
    ["Tytuł (opcjonalnie)", "title"],
    ["Treść komunikatu", "message"],
    ["CTA: etykieta (opcjonalnie)", "ctaLabel"],
    ["CTA - URL", "ctaHref"],
  ])("pole „%s” zapisuje się pod `%s`, zachowując wariant", (placeholder, klucz) => {
    const b = blok("alert-banner", { variant: "warning" });
    const { changes } = renderEditor(AlertBannerBlock, b);
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: "wpis" } });
    expect(ostatni(changes, b).data).toEqual({ variant: "warning", [klucz]: "wpis" });
  });

  it("wariant i oba przełączniki zapisują się jednym zapisem na zmianę", () => {
    const b = blok("alert-banner", { variant: "info" });
    const { changes } = renderEditor(AlertBannerBlock, b);
    fireEvent.change(listaZOpcja("Informacja (niebieski)"), { target: { value: "danger" } });
    expect(ostatni(changes, b).data.variant).toBe("danger");
    fireEvent.click(screen.getByRole("checkbox", { name: "Można zamknąć" }));
    expect(ostatni(changes, b).data.dismissible).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pokaż ikonę" }));
    expect(ostatni(changes, b).data.showIcon).toBe(false);
    expect(changes).toHaveLength(3);
  });
});

describe("separator z tekstem", () => {
  it("wyrównanie spoza opcji pokazuje ŚRODEK - jak strona - a nie pierwszą opcję „po lewej”", () => {
    renderEditor(DividerTextBlock, blok("divider-text", { align: "gdzieś-indziej" }));
    expect(listaZOpcja("Tekst pośrodku").value).toBe("center");
  });

  it("tekst, wyrównanie i styl linii zapisują się pod swoimi kluczami", () => {
    const b = blok("divider-text", { text: "lub", align: "center", lineStyle: "solid" });
    const { changes } = renderEditor(DividerTextBlock, b);
    fireEvent.change(screen.getByPlaceholderText("Tekst środkowy (np. lub, sekcja)"), {
      target: { value: "albo" },
    });
    expect(ostatni(changes, b).data).toEqual({ text: "albo", align: "center", lineStyle: "solid" });
    fireEvent.change(listaZOpcja("Tekst pośrodku"), { target: { value: "right" } });
    expect(ostatni(changes, b).data.align).toBe("right");
    fireEvent.change(listaZOpcja("Linia ciągła"), { target: { value: "dotted" } });
    expect(ostatni(changes, b).data.lineStyle).toBe("dotted");
  });
});
